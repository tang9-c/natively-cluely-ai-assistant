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

test('windows package config ships x64 native dependencies outside asar', () => {
  const pkg = readJson('package.json');
  const winTargets = pkg.build.win.target;
  const arches = new Set(winTargets.flatMap((target) => target.arch));

  assert.ok(arches.has('x64'), 'Windows release must include x64');
  assert.equal(arches.has('ia32'), false, 'Windows ia32 must stay disabled until native ia32 artifacts are built');
  assert.ok(pkg.build.files.includes('native-module'), 'native-module must be packaged');
  assert.ok(pkg.build.files.includes('node_modules'), 'node_modules must be packaged for native deps');
  assert.ok(pkg.build.asarUnpack.includes('**/*.node'), '.node files must be unpacked outside app.asar');
  assert.ok(pkg.build.asarUnpack.includes('**/*.dll'), '.dll files must be unpacked outside app.asar on Windows');
});

test('windows package dependencies do not include stale aliases that electron-builder cannot stat', () => {
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');

  assert.equal(pkg.dependencies['@tanstack/react-query'], '^5.100.10');
  assert.equal(pkg.dependencies['react-query'], undefined);
  assert.equal(lock.packages['@tanstack/react-query@^5.100.10'], undefined);
  assert.equal(lock.packages[''].dependencies['react-query'], undefined);
  assert.equal(lock.packages['node_modules/react-query'], undefined);
});

test('sqlite-vec package names include the real Windows x64 package', () => {
  const pkg = readJson('package.json');
  const ensureScript = read('scripts/ensure-sqlite-vec.js');

  assert.equal(pkg.optionalDependencies['sqlite-vec-darwin-x64'], '^0.1.7-alpha.2');
  assert.equal(pkg.optionalDependencies['sqlite-vec-darwin-arm64'], '^0.1.7-alpha.2');
  assert.equal(pkg.optionalDependencies['sqlite-vec-windows-x64'], '^0.1.7-alpha.2');
  assert.equal(pkg.optionalDependencies['sqlite-vec-win32-x64-msvc'], undefined);

  assert.match(ensureScript, /sqlite-vec-darwin-x64/);
  assert.match(ensureScript, /sqlite-vec-darwin-arm64/);
  assert.match(ensureScript, /sqlite-vec-windows-x64/);
  assert.doesNotMatch(ensureScript, /sqlite-vec-win32-x64-msvc/);
  assert.match(ensureScript, /os\.tmpdir\(\)/);
  assert.doesNotMatch(ensureScript, /--pack-destination \/tmp/);
});

test('postinstall is platform-aware and keeps darwin-only work out of the npm script line', () => {
  const pkg = readJson('package.json');
  const postinstall = read('scripts/postinstall.js');

  assert.equal(pkg.scripts.postinstall, 'node scripts/postinstall.js');
  assert.match(postinstall, /process\.platform === 'darwin'/);
  assert.match(postinstall, /ensure-sherpa-onnx-darwin\.js/);
  assert.match(postinstall, /patch-electron-plist\.js/);
  assert.match(postinstall, /electron-rebuild/);
  assert.match(postinstall, /better-sqlite3,keytar,sherpa-onnx-node/);
});

test('windows native build path explicitly targets x64 msvc', () => {
  const buildNative = read('scripts/build-native.js');

  assert.match(buildNative, /x86_64-pc-windows-msvc/);
  assert.match(buildNative, /index\.win32-x64-msvc\.node/);
  assert.doesNotMatch(buildNative, /index\.win32-ia32-msvc\.node'[\s\S]*verifyArtifacts/);
});

test('windows CI workflow makes toolchain and shell assumptions explicit', () => {
  const workflow = read('.github/workflows/build-windows-x64.yml');

  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.match(workflow, /npm run build:native/);
  assert.match(workflow, /shell: bash/);
  assert.match(workflow, /npm run typecheck:electron/);
  assert.match(workflow, /WindowsPackagingSmoke\.test\.mjs/);
});
