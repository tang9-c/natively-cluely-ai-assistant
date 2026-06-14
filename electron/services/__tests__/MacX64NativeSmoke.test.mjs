import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

test('electron-builder mac release targets include Intel x64 and unpack native binaries', () => {
  const pkg = readJson('package.json');
  const macTargets = pkg.build.mac.target;
  const arches = new Set(macTargets.flatMap((target) => target.arch));

  assert.ok(arches.has('x64'), 'mac release must include Intel x64');
  assert.ok(arches.has('arm64'), 'mac release must include Apple Silicon arm64');
  assert.ok(pkg.build.files.includes('native-module'), 'native-module must be packaged');
  assert.ok(pkg.build.files.includes('node_modules'), 'native dependencies must be packaged');
  assert.ok(pkg.build.asarUnpack.includes('**/*.node'), '.node files must be unpacked outside app.asar');
  assert.ok(pkg.build.asarUnpack.includes('**/*.dylib'), '.dylib files must be unpacked outside app.asar');
});

test('native build script produces both macOS native-module artifacts when release build flag is set', () => {
  const src = read('scripts/build-native.js');
  assert.match(src, /NATIVELY_BUILD_ALL_MAC_ARCHES/);
  assert.match(src, /x86_64-apple-darwin/);
  assert.match(src, /aarch64-apple-darwin/);
  assert.match(src, /index\.darwin-x64\.node/);
  assert.match(src, /index\.darwin-arm64\.node/);
  assert.match(src, /verifyArtifacts\(macTargets\.map/);
});

test('native module loader knows the macOS Intel binary name and uses app.asar.unpacked first in packaged app', () => {
  const src = read('electron/audio/nativeModuleLoader.ts');
  assert.match(src, /darwin: \{ x64: 'index\.darwin-x64\.node', arm64: 'index\.darwin-arm64\.node' \}/);
  assert.match(src, /app\.asar\.unpacked/);
  assert.match(src, /validateNativeModule\(mod\)/);
});

test('sqlite-vec ships both macOS arch packages for packaged vector search', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.optionalDependencies['sqlite-vec-darwin-x64'], '^0.1.7-alpha.2');
  assert.equal(pkg.optionalDependencies['sqlite-vec-darwin-arm64'], '^0.1.7-alpha.2');

  const ensureScript = read('scripts/ensure-sqlite-vec.js');
  assert.match(ensureScript, /sqlite-vec-darwin-x64/);
  assert.match(ensureScript, /sqlite-vec-darwin-arm64/);

  const x64Dylib = path.join(root, 'node_modules/sqlite-vec-darwin-x64/vec0.dylib');
  const arm64Dylib = path.join(root, 'node_modules/sqlite-vec-darwin-arm64/vec0.dylib');
  if (fs.existsSync(path.join(root, 'node_modules'))) {
    assert.ok(fs.existsSync(x64Dylib), 'local node_modules should contain sqlite-vec darwin x64 dylib');
    assert.ok(fs.existsSync(arm64Dylib), 'local node_modules should contain sqlite-vec darwin arm64 dylib');
  }
});

test('postinstall rebuilds Electron ABI native dependencies that affect Intel meeting persistence', () => {
  const pkg = readJson('package.json');
  assert.match(pkg.scripts.postinstall, /electron-rebuild -f -w better-sqlite3,keytar/);
  assert.equal(pkg.dependencies['better-sqlite3'], '12.6.2');
  assert.equal(pkg.dependencies['onnxruntime-node'], '1.22.0');
  assert.equal(pkg.overrides['onnxruntime-node'], '1.22.0');
});
