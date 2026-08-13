import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');

test('packaging keeps only supported English and Simplified Chinese Electron locales', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.build.electronLanguages, ['en', 'en-US', 'zh_CN', 'zh-CN']);
});

test('arm64 packaging selects target native payloads through static macro filters', async () => {
  const beforePackPath = path.join(root, 'scripts/before-pack.js');
  const beforePack = require(beforePackPath);
  const files = ['dist', 'node_modules'];

  await beforePack({
    arch: 'arm64',
    electronPlatformName: 'darwin',
    packager: { config: { files } },
  });

  assert.deepEqual(files, ['dist', 'node_modules'], 'beforePack must not mutate file matchers');
  assert.equal(process.env.NATIVELY_PACKAGE_PLATFORM, 'darwin');
  assert.equal(process.env.NATIVELY_SHERPA_PLATFORM, 'darwin');
  assert.equal(process.env.NATIVELY_SQLITE_VEC_PLATFORM, 'darwin');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('!node_modules/onnxruntime-node/bin/napi-v6/**'));
  assert.ok(pkg.build.files.includes('node_modules/onnxruntime-node/bin/napi-v6/${env.NATIVELY_PACKAGE_PLATFORM}/${arch}/**'));
  assert.equal(pkg.build.files.includes('!node_modules/sherpa-onnx-*/**'), false);
  assert.ok(pkg.build.files.includes('!node_modules/sherpa-onnx-{darwin,linux,win}-*/**'));
  assert.ok(pkg.build.files.includes('node_modules/sherpa-onnx-${env.NATIVELY_SHERPA_PLATFORM}-${arch}/**'));
  assert.ok(
    pkg.build.files.includes('node_modules/@napi-rs/*-${env.NATIVELY_PACKAGE_PLATFORM}-${arch}*/**'),
    'Windows @napi-rs packages append an -msvc suffix after the architecture',
  );
});

test('native pruning rejects unsupported platform and architecture pairs', async () => {
  const beforePack = require(path.join(root, 'scripts/before-pack.js'));
  await assert.rejects(
    () => beforePack({
      arch: 'riscv64',
      electronPlatformName: 'linux',
      packager: { config: { files: [] } },
    }),
    /Unsupported package target/,
  );
});

test('production dependency metadata excludes development-only packages', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.files.includes('node_modules'), false, 'production packaging must use the dependency graph');
  for (const packageName of ['@types/keytar', '@types/marked', '@types/qrcode', '@types/three', 'tap']) {
    assert.equal(pkg.dependencies?.[packageName], undefined, `${packageName} must not be a production dependency`);
    assert.ok(pkg.devDependencies?.[packageName], `${packageName} should remain available for development`);
  }
  assert.equal(pkg.dependencies?.sqlite3, undefined, 'unused sqlite3 must not be packaged');
  assert.equal(pkg.dependencies?.['@elevenlabs/client'], undefined, 'unused ElevenLabs client must not be packaged');
  assert.equal(pkg.dependencies?.['@elevenlabs/elevenlabs-js'], undefined, 'unused ElevenLabs SDK must not be packaged');
});

test('renderer dependencies are build-time inputs rather than packaged runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const rendererOnlyPackages = [
    '@radix-ui/react-dialog',
    '@radix-ui/react-toast',
    '@tanstack/react-query',
    'class-variance-authority',
    'clsx',
    'framer-motion',
    'jspdf',
    'katex',
    'liquid-glass-react',
    'lucide-react',
    'react',
    'react-code-blocks',
    'react-dom',
    'react-icons',
    'react-markdown',
    'react-syntax-highlighter',
    'rehype-katex',
    'remark-gfm',
    'remark-math',
    'tailwind-merge',
    'three',
  ];

  for (const packageName of rendererOnlyPackages) {
    assert.equal(pkg.dependencies?.[packageName], undefined, `${packageName} must not be packaged at runtime`);
    assert.ok(pkg.devDependencies?.[packageName], `${packageName} must remain available to Vite`);
  }
});

test('packaging excludes the unreferenced 67 MB demo GIF', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const assetsRule = pkg.build.extraResources.find((entry) => entry?.from === 'assets/');
  assert.ok(assetsRule, 'assets extraResources rule must exist');
  assert.ok(
    assetsRule.filter?.includes('!natively-ai-meeting-assistant-demo.gif'),
    'assets rule must exclude the unreferenced demo GIF',
  );
});

test('packaging keeps the Node Transformers runtime but excludes browser and source payloads', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('!node_modules/@huggingface/transformers/src/**'));
  assert.ok(pkg.build.files.includes('!node_modules/@huggingface/transformers/types/**'));
  assert.ok(pkg.build.files.includes('!node_modules/@huggingface/transformers/dist/ort-wasm*'));
  assert.ok(pkg.build.files.includes('!node_modules/@huggingface/transformers/dist/transformers.web*'));
  assert.equal(
    pkg.build.files.includes('!node_modules/@huggingface/transformers/dist/transformers.node.mjs'),
    false,
  );
  assert.ok(pkg.build.files.includes('!node_modules/**/.cache/**'));
});

test('packaging keeps the better-sqlite3 runtime binary but excludes build inputs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const pattern of [
    '!node_modules/better-sqlite3/bin/**',
    '!node_modules/better-sqlite3/deps/**',
    '!node_modules/better-sqlite3/src/**',
    '!node_modules/better-sqlite3/build/Release/obj/**',
    '!node_modules/better-sqlite3/build/Release/test_extension.node',
  ]) {
    assert.ok(pkg.build.files.includes(pattern), pattern);
  }
  assert.equal(
    pkg.build.files.includes('!node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    false,
  );
});

test('packaging filters native dependencies before ASAR and signs only after packing', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.build.beforePack, './scripts/before-pack.js');
  assert.equal(pkg.build.afterPack, './scripts/ad-hoc-sign.js');
});

test('production electron build only emits runtime process entrypoints', () => {
  const { getElectronEntryPoints } = require(path.join(root, 'scripts/electron-build-entrypoints.js'));
  assert.deepEqual(getElectronEntryPoints(root, 'package').sort(), [
    'electron/audio/sensevoice/senseVoiceWorker.ts',
    'electron/audio/whisper/whisperWorker.ts',
    'electron/llm/intentClassifierWorkerProcess.ts',
    'electron/main.ts',
    'electron/preload.ts',
    'electron/rag/vectorSearchWorker.ts',
    'electron/services/knowledge/pptx/createPptxFontMapping.ts',
    'electron/services/speaker/SpeakerEmbeddingExtractorWorker.ts',
  ]);

  const developmentEntries = getElectronEntryPoints(root, 'development');
  assert.ok(developmentEntries.includes('electron/LLMHelper.ts'));
  assert.ok(developmentEntries.length > 7);
});

test('production electron build removes stale development outputs', () => {
  const { prepareElectronOutDir } = require(path.join(root, 'scripts/electron-build-entrypoints.js'));
  const tempDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'cueup-electron-out-'));
  const staleFile = path.join(tempDir, 'electron/LLMHelper.js');
  fs.mkdirSync(path.dirname(staleFile), { recursive: true });
  fs.writeFileSync(staleFile, 'stale');

  try {
    prepareElectronOutDir(tempDir, 'package');
    assert.equal(fs.existsSync(staleFile), false);
    assert.equal(fs.existsSync(tempDir), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('release size audit emits JSON and enforces a byte budget', () => {
  const tempDir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'cueup-size-audit-'));
  const fixtures = {
    'Contents/Frameworks/Electron Framework.framework/Electron Framework': '1',
    'Contents/Resources/app.asar': '22',
    'Contents/Resources/app.asar.unpacked/node_modules/native.node': '333',
    'Contents/Resources/models/model.bin': '4444',
    'Contents/Resources/assets/preview.webp': '55555',
    'Contents/Resources/fonts/ui.woff2': '666666',
    'Contents/Resources/other.bin': '7777777',
  };
  for (const [relativePath, content] of Object.entries(fixtures)) {
    const fixturePath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, content);
  }
  const script = path.join(root, 'scripts/audit-release-size.js');

  try {
    const report = spawnSync(process.execPath, [script, '--path', tempDir, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(report.status, 0, report.stderr);
    const parsed = JSON.parse(report.stdout);
    assert.equal(parsed.totalBytes, 28);
    assert.equal(parsed.withinBudget, true);
    assert.deepEqual(parsed.categories, {
      framework: 1,
      asar: 2,
      unpackedNative: 3,
      models: 4,
      assets: 5,
      fonts: 6,
      other: 7,
    });

    const overBudget = spawnSync(
      process.execPath,
      [script, '--path', tempDir, '--json', '--max-bytes', '27'],
      { encoding: 'utf8' },
    );
    assert.equal(overBudget.status, 2);
    assert.match(overBudget.stderr, /exceeds budget/i);

    const underBudget = spawnSync(
      process.execPath,
      [script, '--path', tempDir, '--json', '--min-bytes', '29'],
      { encoding: 'utf8' },
    );
    assert.equal(underBudget.status, 2);
    assert.match(underBudget.stderr, /below budget/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
