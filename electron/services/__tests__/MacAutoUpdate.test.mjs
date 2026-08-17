import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import * as releaseNotes from '../../../dist-electron/electron/update/ReleaseNotesManager.js';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function between(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(startAt, -1, `Missing start marker: ${start}`);
  assert.notEqual(endAt, -1, `Missing end marker: ${end}`);
  return source.slice(startAt, endAt);
}

test('release SHA tags compare by their product semantic version', () => {
  assert.equal(typeof releaseNotes.extractReleaseSemver, 'function');
  assert.equal(releaseNotes.extractReleaseSemver('v2.7.1-sha-4a707f8'), '2.7.1');
  assert.equal(releaseNotes.extractReleaseSemver('2.8.0'), '2.8.0');
  assert.equal(releaseNotes.extractReleaseSemver('latest'), null);
});

test('macOS manual updater selects the architecture-specific DMG from release assets', () => {
  assert.equal(typeof releaseNotes.selectMacDmgAsset, 'function');
  const assets = [
    { name: 'CueUp-2.8.0-mac.zip', downloadUrl: 'https://example.test/intel.zip', size: 10 },
    { name: 'CueUp-2.8.0.dmg', downloadUrl: 'https://example.test/intel.dmg', size: 20 },
    { name: 'CueUp-2.8.0-arm64.dmg', downloadUrl: 'https://example.test/arm64.dmg', size: 30 },
  ];

  assert.equal(releaseNotes.selectMacDmgAsset(assets, 'arm64')?.name, 'CueUp-2.8.0-arm64.dmg');
  assert.equal(releaseNotes.selectMacDmgAsset(assets, 'x64')?.name, 'CueUp-2.8.0.dmg');
  assert.equal(releaseNotes.selectMacDmgAsset(assets, 'ia32'), undefined);
});

test('packaged macOS checks GitHub releases manually and renderer opens the returned asset URL', () => {
  const main = read('electron/main.ts');
  const banner = read('src/components/UpdateBanner.tsx');
  const settings = read('src/components/SettingsOverlay.tsx');
  const modal = read('src/components/UpdateModal.tsx');
  const ipc = read('electron/ipcHandlers.ts');
  const releaseWorkflow = read('.github/workflows/release-publish.yml');

  assert.match(main, /process\.platform === 'darwin'[\s\S]{0,160}checkForUpdatesManual\(\)/);
  assert.match(main, /manualDownloadUrl:\s*macAsset\?\.downloadUrl/);
  assert.match(main, /manualDownloadName:\s*macAsset\?\.name/);
  assert.match(main, /process\.platform === 'darwin' && !macAsset[\s\S]{0,160}throw new Error/);
  assert.match(banner, /updateInfo\?\.manualDownloadUrl/);
  assert.doesNotMatch(banner, /releases\/download\/v\$\{version\}/);
  const macInstallBranch = between(banner, "if (window.electronAPI.platform === 'darwin')", '} else {');
  assert.doesNotMatch(macInstallBranch, /downloadUpdate\(/);
  assert.match(macInstallBranch, /setStatus\('error'\)/);
  assert.match(settings, /updateStatus === 'available'[\s\S]{0,500}platform === 'darwin'[\s\S]{0,200}onClose\(\)/);
  assert.match(modal, /updateInfo\?\.manualDownloadName/);
  assert.match(ipc, /parsed\.hostname === 'github\.com'/);
  assert.match(ipc, /\/tang9-c\/natively-cluely-ai-assistant\/releases\/download\//);
  assert.doesNotMatch(releaseWorkflow, /latest-mac\.yml/);
});
