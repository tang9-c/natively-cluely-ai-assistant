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

test('dev Electron startup preflights the native audio artifact before launching', () => {
  const pkg = readJson('package.json');
  const preflight = read('scripts/ensure-native-artifact.js');

  assert.match(pkg.scripts['ensure:native'], /node scripts\/ensure-native-artifact\.js/);
  assert.match(pkg.scripts['electron:dev'], /npm run ensure:native && npm run build:electron/);
  assert.match(pkg.scripts['electron:build'], /npm run ensure:native && npm run build:electron/);
  assert.match(preflight, /index\.darwin-arm64\.node/);
  assert.match(preflight, /index\.darwin-x64\.node/);
  assert.match(preflight, /NATIVELY_SKIP_NATIVE_CHECK/);
  assert.match(preflight, /Full Xcode is required/);
  assert.match(preflight, /sudo xcode-select -s \/Applications\/Xcode\.app\/Contents\/Developer/);
  assert.match(preflight, /npm run build:native/);
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

  // Only the dylib matching the current host architecture is installed locally
  // (npm pulls the optionalDependency that matches process.arch). Both arch
  // declarations in package.json + ensure-sqlite-vec.js still guarantee the
  // packaged app supports both architectures — that's what the assertion above
  // checks. The local-dylib existence check is per-arch so CI runners and
  // dev laptops see a meaningful test instead of a false negative on the
  // dylib for the arch they're not running.
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const localDylib = path.join(root, `node_modules/sqlite-vec-darwin-${arch}/vec0.dylib`);
  if (fs.existsSync(path.join(root, 'node_modules'))) {
    assert.ok(
      fs.existsSync(localDylib),
      `local node_modules should contain sqlite-vec darwin ${arch} dylib (host arch=${process.arch})`,
    );
  }
});

test('postinstall rebuilds Electron ABI native dependencies that affect Intel meeting persistence and Chinese STT', () => {
  const pkg = readJson('package.json');
  const postinstall = read('scripts/postinstall.js');

  assert.equal(pkg.scripts.postinstall, 'node scripts/postinstall.js');
  assert.match(postinstall, /electron-rebuild/);
  assert.match(postinstall, /better-sqlite3,keytar,sherpa-onnx-node/);
  assert.match(postinstall, /ensure-sherpa-onnx-darwin\.js/);
  assert.match(postinstall, /process\.platform === 'darwin'/);
  assert.match(pkg.scripts['rebuild:native'], /electron-rebuild -f -w better-sqlite3,keytar,sherpa-onnx-node/);
  assert.match(pkg.scripts['rebuild:native'], /node scripts\/ensure-sqlite-vec\.js/);
  assert.equal(pkg.dependencies['better-sqlite3'], '12.6.2');
  assert.equal(pkg.dependencies['sherpa-onnx-node'], '^1.13.2');
  assert.equal(pkg.dependencies['onnxruntime-node'], '1.22.0');
  assert.equal(pkg.overrides['onnxruntime-node'], '1.22.0');

  const worker = read('electron/audio/sensevoice/senseVoiceWorker.ts');
  assert.match(worker, /require\('sherpa-onnx-node'\)/);

  const ensureSherpa = read('scripts/ensure-sherpa-onnx-darwin.js');
  assert.match(ensureSherpa, /sherpa-onnx-darwin-x64/);
  assert.match(ensureSherpa, /sherpa-onnx-darwin-arm64/);
  assert.match(ensureSherpa, /sherpa-onnx\.node/);
});
