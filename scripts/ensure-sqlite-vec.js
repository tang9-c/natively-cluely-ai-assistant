/**
 * Ensures sqlite-vec platform packages needed for release packaging are present
 * in node_modules, even when npm skipped optional deps for the current host.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SQLITE_VEC_VERSION = '0.1.7-alpha.2';
const root = path.join(__dirname, '..');
const nodeModules = path.join(root, 'node_modules');

const packages = [
  'sqlite-vec-darwin-arm64',
  'sqlite-vec-darwin-x64',
  'sqlite-vec-windows-x64',
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
}

function ensurePackage(pkg) {
  const pkgDir = path.join(nodeModules, pkg);
  if (fs.existsSync(pkgDir)) {
    console.log(`[ensure-sqlite-vec] ${pkg} already present, skipping.`);
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-sqlite-vec-'));
  try {
    console.log(`[ensure-sqlite-vec] ${pkg} missing; fetching...`);
    const tarball = run('npm', ['pack', `${pkg}@${SQLITE_VEC_VERSION}`, '--pack-destination', tmpDir]).trim();
    const tarPath = path.join(tmpDir, tarball);

    fs.mkdirSync(pkgDir, { recursive: true });
    run('tar', ['xzf', tarPath, '--strip-components=1', '-C', pkgDir], { stdio: 'inherit' });
    console.log(`[ensure-sqlite-vec] ${pkg} installed successfully.`);
  } catch (e) {
    console.warn(`[ensure-sqlite-vec] Warning: could not install ${pkg}:`, e.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

for (const pkg of packages) {
  ensurePackage(pkg);
}
