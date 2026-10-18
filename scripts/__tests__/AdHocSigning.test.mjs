import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const sign = require('../ad-hoc-sign.js').default;

test('macOS signing hook leaves the outer resource seal valid after signing native modules', {
  skip: process.platform !== 'darwin',
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-signing-test-'));
  try {
    const app = path.join(temp, 'SigningFixture.app');
    const contents = path.join(app, 'Contents');
    const native = path.join(contents, 'Resources', 'app.asar.unpacked', 'native-module');
    fs.mkdirSync(native, { recursive: true });
    fs.mkdirSync(path.join(contents, 'MacOS'));
    // Copy Mach-O binaries only for codesign; never execute or launch them.
    fs.copyFileSync('/usr/bin/true', path.join(contents, 'MacOS', 'SigningFixture'));
    fs.copyFileSync('/usr/bin/true', path.join(native, 'index.darwin-test.node'));
    fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.example.cueup-signing-fixture</string>
<key>CFBundleExecutable</key><string>SigningFixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
    await sign({ appOutDir: temp, packager: {
      appInfo: { productFilename: 'SigningFixture' }, info: { projectDir: root },
    } });
    const result = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const module = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', path.join(native, 'index.darwin-test.node')], { encoding: 'utf8' });
    assert.equal(module.status, 0, module.stderr);
    assert.match(module.stdout + module.stderr, /com.apple.security.screen-capture/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
