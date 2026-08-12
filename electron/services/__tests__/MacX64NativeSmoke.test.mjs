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

test('electron-builder mac release targets are architecture-neutral so workflows can package one arch', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const macTargets = pkg.build.mac.target;

  assert.equal(pkg.name, 'cueup');
  assert.equal(lock.name, 'cueup');
  assert.equal(lock.packages[''].name, 'cueup');
  assert.equal(pkg.build.appId, 'com.electron.meeting-notes', 'appId must stay unchanged for this branding pass');
  assert.equal(pkg.build.productName, 'CueUp');
  assert.equal(pkg.build.mac.icon, 'assets/cueup.icns');
  assert.ok(
    pkg.build.extraResources.some((entry) => entry.from === 'assets/cueup.icns' && entry.to === 'cueup.icns'),
    'CueUp mac icon must be copied into app resources for runtime windows',
  );
  const mainSource = read('electron/main.ts');
  const legacyUserDataIndex = mainSource.indexOf('migrateLegacyUserDataForCueUpBranding()');
  const managersIndex = mainSource.indexOf('// 3. Initialize Managers');
  assert.ok(legacyUserDataIndex >= 0, 'CueUp branding must migrate legacy Natively userData before startup services read it');
  assert.ok(
    legacyUserDataIndex < managersIndex,
    'legacy userData migration must run before managers read app.getPath("userData")',
  );
  assert.match(mainSource, /LEGACY_USER_DATA_DIR_NAME\s*=\s*'Natively'/);
  assert.match(mainSource, /app\.getPath\('userData'\)/);
  assert.match(mainSource, /fs\.cpSync\(legacyUserDataPath,\s*cueUpUserDataPath/);
  assert.match(
    mainSource,
    /if \(sttQualityAcceptanceContext\.enabled && sttQualityAcceptanceContext\.userDataDir\) \{\s*app\.setPath\('userData', sttQualityAcceptanceContext\.userDataDir\);\s*\}/,
    'STT quality acceptance may override userData only inside its isolated acceptance-context guard',
  );
  assert.deepEqual(macTargets.map((target) => target.target), ['zip', 'dmg']);
  for (const target of macTargets) {
    assert.equal(target.arch, undefined, 'mac target arch must be controlled by workflow CLI flags');
  }

  assert.ok(pkg.build.files.includes('native-module'), 'native-module must be packaged');
  assert.equal(
    pkg.build.files.includes('node_modules'),
    false,
    'electron-builder must resolve production dependencies instead of copying every installed package',
  );
  assert.equal(pkg.dependencies['better-sqlite3'], '12.11.1');
  assert.equal(pkg.dependencies['sherpa-onnx-node'], '^1.13.2');
  assert.ok(pkg.build.files.includes('!**/*.map'), 'source maps must be excluded from release packages');
  assert.ok(pkg.build.files.includes('!dist-electron/electron/test/**'), 'compiled Electron test fixtures must not be packaged');
  assert.ok(pkg.build.files.includes('!node_modules/electron/**'), 'Electron runtime package must not be bundled in app resources');
  assert.ok(pkg.build.files.includes('!node_modules/app-builder-bin/**'), 'electron-builder helper binaries must not be bundled in app resources');
  assert.ok(pkg.build.asarUnpack.includes('**/*.node'), '.node files must be unpacked outside app.asar');
  assert.ok(pkg.build.asarUnpack.includes('**/*.dylib'), '.dylib files must be unpacked outside app.asar');
  assert.ok(pkg.build.asarUnpack.includes('node_modules/bindings/**'));
  assert.ok(pkg.build.asarUnpack.includes('node_modules/file-uri-to-path/**'));
  assert.ok(
    pkg.build.asarUnpack.includes('dist-electron/electron/rag/vectorSearchWorker.js'),
    'RAG worker thread entrypoint must be unpacked outside app.asar so worker_threads can load it',
  );
});

test('CueUp branding uses non-Natively logo assets for release surfaces', () => {
  const sourceFiles = [
    'src/components/SettingsOverlay.tsx',
    'src/components/settings/Sidebar.tsx',
    'src/components/settings/NativelyApiSettings.tsx',
  ].map(read).join('\n');

  assert.doesNotMatch(sourceFiles, /NativelyLogoMark/);
  assert.doesNotMatch(sourceFiles, /Natively logomark/);
  assert.match(read('src/components/CueUpLogoMark.tsx'), /C-shaped sound wave/);

  const requiredAssets = [
    'assets/cueup-logo.svg',
    'assets/cueup.icns',
    'assets/icon.png',
    'assets/iconTemplate.png',
    'assets/icons/win/icon.ico',
    'assets/icons/png/icon_16x16.png',
    'assets/icons/png/icon_512x512.png',
    'src/assets/logo.webp',
    'src/components/icon.png',
    'src/icons/cueup.iconset/icon_512x512@2x.png',
  ];

  for (const asset of requiredAssets) {
    assert.ok(fs.existsSync(path.join(root, asset)), `${asset} should exist`);
  }

  assert.equal(fs.existsSync(path.join(root, 'src/icons/natively.iconset')), false);
});

test('native build script accepts explicit macOS release targets so CI can build one architecture per workflow', () => {
  const src = read('scripts/build-native.js');
  assert.match(src, /NATIVELY_NATIVE_TARGETS/);
  assert.match(src, /NATIVELY_BUILD_ALL_MAC_ARCHES/);
  assert.match(src, /x86_64-apple-darwin/);
  assert.match(src, /aarch64-apple-darwin/);
  assert.match(src, /index\.darwin-x64\.node/);
  assert.match(src, /index\.darwin-arm64\.node/);
  assert.match(src, /verifyArtifacts\(macTargets\.map/);
});

test('mac release workflows build one architecture each and upload size audit reports', () => {
  const intelWorkflow = read('.github/workflows/build-intel-mac.yml');
  const armWorkflow = read('.github/workflows/build-arm64-mac.yml');

  assert.match(intelWorkflow, /verify-rag-release-assets\.js --platform=darwin --arch=x64/);
  assert.match(armWorkflow, /verify-rag-release-assets\.js --platform=darwin --arch=arm64/);
  assert.match(intelWorkflow, /^name:\s*Build Intel Mac$/m);
  assert.match(intelWorkflow, /Install Rosetta for x64 native build scripts/);
  assert.match(intelWorkflow, /softwareupdate --install-rosetta --agree-to-license/);
  assert.match(intelWorkflow, /NATIVELY_NATIVE_TARGETS:\s*"x86_64-apple-darwin"/);
  assert.match(intelWorkflow, /npx electron-builder --mac --x64 --publish never/);
  assert.doesNotMatch(intelWorkflow, /NATIVELY_BUILD_ALL_MAC_ARCHES:\s*"1"/);
  assert.match(intelWorkflow, /rm -rf release/);
  assert.match(intelWorkflow, /Validate Intel artifact set/);
  assert.match(intelWorkflow, /Unexpected arm64 artifact in Intel workflow/);
  assert.match(intelWorkflow, /node scripts\/audit-release-size\.js --path release\/mac\/CueUp\.app --json --max-bytes 891289600 > release\/size-report\.json/);
  assert.match(intelWorkflow, /release\/size-report\.json/);

  assert.match(armWorkflow, /^name:\s*Build ARM64 Mac$/m);
  assert.match(armWorkflow, /runs-on:\s*macos-latest/);
  assert.match(armWorkflow, /NATIVELY_NATIVE_TARGETS:\s*"aarch64-apple-darwin"/);
  assert.match(armWorkflow, /npx electron-builder --mac --arm64 --publish never/);
  assert.match(armWorkflow, /rm -rf release/);
  assert.match(armWorkflow, /Validate ARM64 artifact set/);
  assert.match(armWorkflow, /Unexpected non-arm64 artifact in ARM64 workflow/);
  assert.match(armWorkflow, /node scripts\/audit-release-size\.js --path release\/mac-arm64\/CueUp\.app --json --max-bytes 891289600 > release\/size-report\.json/);
  assert.match(armWorkflow, /cueup-arm64-mac-/);
  assert.match(intelWorkflow, /cueup-intel-mac-/);
  assert.match(intelWorkflow, /release\/OPEN-UNSIGNED-CUEUP-MAC\.sh/);
  assert.match(armWorkflow, /release\/OPEN-UNSIGNED-CUEUP-MAC\.sh/);
  assert.match(armWorkflow, /release\/\*arm64\*\.dmg/);
  assert.match(armWorkflow, /release\/\*arm64\*\.zip/);

  const pkg = readJson('package.json');
  for (const target of pkg.build.mac.target) {
    assert.equal(target.arch, undefined, 'workflow arch flags must not be widened by package.json mac target arch arrays');
  }
});

test('mac release builds install PDF canvas native bindings for both architectures', () => {
  const pkg = readJson('package.json');
  const ensureCanvas = read('scripts/ensure-canvas-mac-deps.js');
  const intelWorkflow = read('.github/workflows/build-intel-mac.yml');

  assert.match(ensureCanvas, /@napi-rs\/canvas-darwin-arm64/);
  assert.match(ensureCanvas, /@napi-rs\/canvas-darwin-x64/);
  assert.match(ensureCanvas, /node_modules\/@napi-rs\/canvas/);
  assert.match(intelWorkflow, /node scripts\/ensure-canvas-mac-deps\.js/);
  assert.match(pkg.scripts['app:build'], /node scripts\/ensure-canvas-mac-deps\.js/);
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
  assert.equal(pkg.devDependencies.electron, '^42.6.0');
  assert.equal(pkg.dependencies['better-sqlite3'], '12.11.1');
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
