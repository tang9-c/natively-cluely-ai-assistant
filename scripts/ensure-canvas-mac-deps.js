#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const lockfile = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
const canvasOptionalDeps = lockfile.packages?.['node_modules/@napi-rs/canvas']?.optionalDependencies;

if (process.platform !== 'darwin') {
  console.log('[ensure-canvas-mac-deps] Skipping; macOS packages are only needed on darwin builds.');
  process.exit(0);
}

if (!canvasOptionalDeps) {
  throw new Error('Could not find @napi-rs/canvas optionalDependencies in package-lock.json.');
}

const nodeModulesDir = path.join(rootDir, 'node_modules');
const requiredPackages = [
  '@napi-rs/canvas-darwin-arm64',
  '@napi-rs/canvas-darwin-x64',
];

function packageDir(packageName) {
  return path.join(nodeModulesDir, ...packageName.split('/'));
}

function isInstalled(packageName) {
  return fs.existsSync(path.join(packageDir(packageName), 'package.json'));
}

function installPackage(packageName) {
  const version = canvasOptionalDeps[packageName];
  if (!version) {
    throw new Error(`Missing ${packageName} in @napi-rs/canvas optionalDependencies.`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-darwin-dep-'));
  try {
    const tarball = execFileSync('npm', ['pack', `${packageName}@${version}`, '--silent', '--pack-destination', tempDir], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim().split('\n').pop();

    const destination = packageDir(packageName);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(tempDir, tarball), '-C', destination, '--strip-components=1'], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const missingPackages = requiredPackages.filter((packageName) => !isInstalled(packageName));
if (missingPackages.length === 0) {
  console.log('[ensure-canvas-mac-deps] Canvas packages for darwin arm64 and x64 are installed.');
  process.exit(0);
}

console.log(`[ensure-canvas-mac-deps] Installing missing Canvas packages: ${missingPackages.join(', ')}`);
missingPackages.forEach(installPackage);

const stillMissing = missingPackages.filter((packageName) => !isInstalled(packageName));
if (stillMissing.length > 0) {
  throw new Error(`Failed to install Canvas packages: ${stillMissing.join(', ')}`);
}

console.log('[ensure-canvas-mac-deps] Canvas packages for darwin arm64 and x64 are installed.');
