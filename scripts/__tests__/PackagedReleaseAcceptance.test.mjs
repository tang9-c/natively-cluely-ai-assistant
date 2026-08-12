import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
  assert.deepEqual(inspectNativeBinary(littleEndianFatMacho([0x0100000c, 0x01000007])), {
    format: 'macho',
    arches: ['arm64', 'x64'],
  });
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

test('all release workflows execute the final packaged runtime smoke suite', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const expectations = [
    ['.github/workflows/build-arm64-mac.yml', 'release/mac-arm64/CueUp.app'],
    ['.github/workflows/build-intel-mac.yml', 'release/mac/CueUp.app'],
    ['.github/workflows/build-windows-x64.yml', 'release/win-unpacked'],
  ];
  for (const [relativePath, appPath] of expectations) {
    const workflow = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(workflow, /smoke-packaged-runtime\.mjs/);
    assert.match(workflow, new RegExp(`--app ${appPath.replaceAll('.', '\\.')}`));
    assert.match(workflow, /--sensevoice-model-dir/);
    assert.match(workflow, /--audio tests\/fixtures\/dynamic-actions\/replay\/audio\/sales-pricing-objection-zh-001\.wav/);
  }
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
});

test('packaged release verifier requires the PPTX child dependency', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../verify-packaged-release.mjs'),
    'utf8',
  );
  assert.match(source, /createPptxFontMapping\.js/);
});
