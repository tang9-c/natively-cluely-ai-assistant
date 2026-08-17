import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as releaseVerifier from '../verify-packaged-release.mjs';
import {
  inspectNativeBinary,
  validatePackagedRelease,
} from '../verify-packaged-release.mjs';

function macho(cpuType) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(0xfeedfacf, 0);
  buffer.writeUInt32BE(cpuType, 4);
  return buffer;
}

function pe(machine = 0x8664) {
  const buffer = Buffer.alloc(256);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(128, 0x3c);
  buffer.write('PE\0\0', 128, 'binary');
  buffer.writeUInt16LE(machine, 132);
  return buffer;
}

function littleEndianFatMacho(cpuTypes) {
  const buffer = Buffer.alloc(8 + cpuTypes.length * 20);
  buffer.writeUInt32BE(0xbebafeca, 0);
  buffer.writeUInt32LE(cpuTypes.length, 4);
  cpuTypes.forEach((cpuType, index) => {
    buffer.writeUInt32LE(cpuType, 8 + index * 20);
  });
  return buffer;
}

test('native binary inspection distinguishes macOS arm64/x64 and Windows x64', () => {
  assert.deepEqual(inspectNativeBinary(macho(0x0100000c)), { format: 'macho', arches: ['arm64'] });
  assert.deepEqual(inspectNativeBinary(macho(0x01000007)), { format: 'macho', arches: ['x64'] });
  assert.deepEqual(inspectNativeBinary(pe()), { format: 'pe', arches: ['x64'] });
  assert.deepEqual(inspectNativeBinary(pe(0x014c)), { format: 'pe', arches: ['x86'] });
  assert.deepEqual(inspectNativeBinary(littleEndianFatMacho([0x0100000c, 0x01000007])), {
    format: 'macho',
    arches: ['arm64', 'x64'],
  });
});

test('packaged release verifier normalizes Windows ASAR entry separators', () => {
  assert.equal(typeof releaseVerifier.normalizeAsarEntry, 'function');
  assert.equal(
    releaseVerifier.normalizeAsarEntry('\\dist-electron\\electron\\main.js'),
    '/dist-electron/electron/main.js',
  );
});

test('Windows x64 validation permits only the electron-builder x86 elevate helper', () => {
  assert.equal(typeof releaseVerifier.isAllowedCompatibilityBinary, 'function');
  const appPath = path.join('C:', 'release', 'win-unpacked');
  const x86Pe = { format: 'pe', arches: ['x86'] };
  assert.equal(
    releaseVerifier.isAllowedCompatibilityBinary({
      appPath,
      filePath: path.join(appPath, 'resources', 'elevate.exe'),
      platform: 'win32',
      inspection: x86Pe,
    }),
    true,
  );
  assert.equal(
    releaseVerifier.isAllowedCompatibilityBinary({
      appPath,
      filePath: path.join(appPath, 'resources', 'other.exe'),
      platform: 'win32',
      inspection: x86Pe,
    }),
    false,
  );
  assert.equal(
    releaseVerifier.isAllowedCompatibilityBinary({
      appPath,
      filePath: path.join(appPath, 'resources', 'app.asar.unpacked', 'native-module', 'wrong.node'),
      platform: 'win32',
      inspection: x86Pe,
    }),
    false,
  );
});

test('Windows update feed references the signed NSIS installer with matching size and SHA-512', () => {
  assert.equal(typeof releaseVerifier.validateWindowsUpdateArtifacts, 'function');
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-windows-update-'));
  const version = '2.7.1';
  const installerName = `CueUp-Setup-${version}.exe`;
  const installer = pe();
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
  fs.writeFileSync(path.join(releaseDir, installerName), installer);
  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), [
    `version: ${version}`,
    'files:',
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-08-16T16:01:53.132Z'",
    '',
  ].join('\n'));

  try {
    const result = releaseVerifier.validateWindowsUpdateArtifacts({ releaseDir, expectedVersion: version });
    assert.deepEqual(result, {
      ok: true,
      version,
      installer: installerName,
      size: installer.length,
      errors: [],
    });
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
});

test('Windows update feed rejects a stale installer hash', () => {
  assert.equal(typeof releaseVerifier.validateWindowsUpdateArtifacts, 'function');
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-windows-update-'));
  const version = '2.7.1';
  const installerName = `CueUp-Setup-${version}.exe`;
  const installer = pe();
  fs.writeFileSync(path.join(releaseDir, installerName), installer);
  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), [
    `version: ${version}`,
    'files:',
    `  - url: ${installerName}`,
    '    sha512: stale-hash',
    `    size: ${installer.length}`,
    `path: ${installerName}`,
    'sha512: stale-hash',
    '',
  ].join('\n'));

  try {
    const result = releaseVerifier.validateWindowsUpdateArtifacts({ releaseDir, expectedVersion: version });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes('SHA-512')));
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
});

test('macOS release artifacts expose the exact DMG name used by each architecture', () => {
  assert.equal(typeof releaseVerifier.validateMacUpdateArtifacts, 'function');
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-mac-update-'));
  fs.writeFileSync(path.join(releaseDir, 'CueUp-2.7.1-arm64.dmg'), 'arm64-dmg');
  fs.writeFileSync(path.join(releaseDir, 'CueUp-2.7.1-arm64-mac.zip'), 'arm64-zip');

  try {
    assert.deepEqual(
      releaseVerifier.validateMacUpdateArtifacts({ releaseDir, expectedVersion: '2.7.1', arch: 'arm64' }),
      {
        ok: true,
        version: '2.7.1',
        arch: 'arm64',
        dmg: 'CueUp-2.7.1-arm64.dmg',
        zip: 'CueUp-2.7.1-arm64-mac.zip',
        errors: [],
      },
    );
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
});

test('packaged release validation rejects a missing Rust audio module and wrong-arch native library', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-release-acceptance-'));
  const resources = path.join(appPath, 'Contents/Resources');
  fs.mkdirSync(path.join(resources, 'app.asar.unpacked/node_modules/example'), { recursive: true });
  fs.writeFileSync(
    path.join(resources, 'app.asar.unpacked/node_modules/example/wrong.node'),
    macho(0x01000007),
  );

  try {
    const result = validatePackagedRelease({ appPath, platform: 'darwin', arch: 'arm64' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes('index.darwin-arm64.node')));
    assert.ok(result.errors.some(error => error.includes('wrong.node') && error.includes('x64')));
  } finally {
    fs.rmSync(appPath, { recursive: true, force: true });
  }
});

test('packaged release validation rejects an unreadable native-format payload', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-release-acceptance-'));
  const resources = path.join(appPath, 'Contents/Resources');
  const invalidNative = path.join(resources, 'app.asar.unpacked/node_modules/example/invalid.node');
  fs.mkdirSync(path.dirname(invalidNative), { recursive: true });
  fs.writeFileSync(invalidNative, 'not-a-native-binary');

  try {
    const result = validatePackagedRelease({ appPath, platform: 'darwin', arch: 'arm64' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes('invalid.node') && error.includes('unknown')));
  } finally {
    fs.rmSync(appPath, { recursive: true, force: true });
  }
});

test('packaged release validation checks extensionless native executables', () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-release-acceptance-'));
  const executable = path.join(appPath, 'Contents/MacOS/CueUp');
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, macho(0x01000007));

  try {
    const result = validatePackagedRelease({ appPath, platform: 'darwin', arch: 'arm64' });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes('Contents/MacOS/CueUp') && error.includes('x64')));
  } finally {
    fs.rmSync(appPath, { recursive: true, force: true });
  }
});

test('all release workflows run packaged release acceptance before upload', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const expectations = [
    ['.github/workflows/build-arm64-mac.yml', 'release/mac-arm64/CueUp.app --platform darwin --arch arm64'],
    ['.github/workflows/build-intel-mac.yml', 'release/mac/CueUp.app --platform darwin --arch x64'],
    ['.github/workflows/build-windows-x64.yml', 'release/win-unpacked --platform win32 --arch x64'],
  ];
  for (const [relativePath, args] of expectations) {
    const workflow = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(workflow, new RegExp(`verify-packaged-release\\.mjs --path ${args}`));
  }
});

test('Windows workflow validates updater metadata before uploading installers', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-windows-x64.yml'), 'utf8');
  assert.match(
    workflow,
    /verify-packaged-release\.mjs --windows-update-dir release --version \$\{\{ steps\.package-version\.outputs\.version \}\}/,
  );
});

test('both macOS workflows validate architecture-specific manual update assets', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const intel = fs.readFileSync(path.join(root, '.github/workflows/build-intel-mac.yml'), 'utf8');
  const arm = fs.readFileSync(path.join(root, '.github/workflows/build-arm64-mac.yml'), 'utf8');

  assert.match(intel, /verify-packaged-release\.mjs --mac-update-dir release --version \$\{\{ steps\.package-version\.outputs\.version \}\} --arch x64/);
  assert.match(arm, /verify-packaged-release\.mjs --mac-update-dir release --version \$\{\{ steps\.package-version\.outputs\.version \}\} --arch arm64/);
});

test('release workflows can write the package version to GITHUB_OUTPUT with bash', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const workflowPaths = [
    '.github/workflows/build-arm64-mac.yml',
    '.github/workflows/build-intel-mac.yml',
    '.github/workflows/build-windows-x64.yml',
  ];

  for (const relativePath of workflowPaths) {
    const workflow = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const command = workflow.match(/^\s*run:\s*(.*GITHUB_OUTPUT.*)$/m)?.[1];
    assert.ok(command, `${relativePath} must define the package-version output command`);
    assert.doesNotMatch(command, /\$\(/, `${relativePath} must not hide version-read failures inside command substitution`);

    const outputPath = path.join(os.tmpdir(), `cueup-package-version-${process.pid}.txt`);
    fs.rmSync(outputPath, { force: true });
    const result = spawnSync('bash', ['-c', command], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      encoding: 'utf8',
    });

    try {
      assert.equal(result.status, 0, `${relativePath}: ${result.stderr}`);
      assert.equal(fs.readFileSync(outputPath, 'utf8'), `version=${expectedVersion}\n`);
    } finally {
      fs.rmSync(outputPath, { force: true });
    }
  }
});

test('all release workflows execute the final packaged runtime smoke suite', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const expectations = [
    ['.github/workflows/build-arm64-mac.yml', 'release/mac-arm64/CueUp.app'],
    ['.github/workflows/build-intel-mac.yml', 'release/mac/CueUp.app'],
    ['.github/workflows/build-windows-x64.yml', 'release/win-unpacked'],
  ];
  for (const [relativePath, appPath] of expectations) {
    const workflow = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const pipefailCount = workflow.match(/set -o pipefail/g)?.length ?? 0;
    assert.ok(pipefailCount >= 2, `${relativePath} must preserve verifier and smoke exit codes through tee`);
    assert.match(workflow, /smoke-packaged-runtime\.mjs/);
    assert.match(workflow, new RegExp(`--app ${appPath.replaceAll('.', '\\.')}`));
    assert.match(workflow, /--sensevoice-model-dir/);
    assert.match(workflow, /--audio tests\/fixtures\/dynamic-actions\/replay\/audio\/sales-pricing-objection-zh-001\.wav/);
  }
});

test('packaged PPTX smoke keeps a bounded timeout suitable for Intel Rosetta cold start', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../smoke-packaged-runtime.mjs'),
    'utf8',
  );
  assert.match(source, /pptx-render-child\.mjs[\s\S]{0,500}timeout:\s*180_000/);
});

test('packaged runtime smoke covers every required functional subsystem', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../smoke-packaged-runtime.mjs'),
    'utf8',
  );
  for (const subsystem of ['pdf', 'pptx', 'embedding', 'database', 'rag', 'sensevoice']) {
    assert.match(source, new RegExp(`results\\.${subsystem}\\s*=`), `missing ${subsystem} smoke result`);
  }
  assert.match(source, /requestedProviders: \['cueup-invalid-gpu'\]/);
  assert.match(source, /fallbackProvider: 'cpu'/);
  assert.match(source, /fallbackVerified/);
  assert.match(source, /ready\.providerActual !== 'cpu'/);
  assert.match(source, /ready\.fallbackReason !== 'candidate_initialization_failed'/);
  const embeddingAt = source.indexOf("pipeline('feature-extraction'");
  const isolatedSenseVoiceAt = source.indexOf('createSenseVoiceWorker(path.join', embeddingAt);
  assert.match(source, /fork\(workerPath/);
  assert.ok(isolatedSenseVoiceAt > embeddingAt, 'Windows smoke must prove SenseVoice works in an isolated process after Embedding');
  assert.match(source, /ELECTRON_RUN_AS_NODE:\s*'1'/);
});

test('packaged release verifier requires the PPTX child dependency', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../verify-packaged-release.mjs'),
    'utf8',
  );
  assert.match(source, /createPptxFontMapping\.js/);
});
