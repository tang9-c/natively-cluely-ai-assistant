import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

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

test('update IPC handlers reject failures instead of returning a successful invoke result', () => {
  const source = read('electron/ipcHandlers.ts');
  const section = between(source, "safeHandle('quit-and-install-update'", '// Window movement handlers');

  assert.doesNotMatch(section, /return \{ success: false/);
  assert.match(section, /quit-and-install-update[\s\S]*catch[\s\S]*throw err/);
  assert.match(section, /check-for-updates[\s\S]*catch[\s\S]*throw err/);
  assert.match(section, /download-update[\s\S]*catch[\s\S]*throw err/);
});

test('AppState propagates update check and Windows install failures without force-exiting', () => {
  const source = read('electron/main.ts');
  const install = between(source, 'public async quitAndInstallUpdate()', 'public async checkForUpdates()');
  const check = between(source, 'public async checkForUpdates()', 'public async downloadUpdate()');

  assert.doesNotMatch(install, /app\.exit\(0\)/);
  assert.match(install, /quitAndInstall failed[\s\S]*broadcast\("update-error"[\s\S]*throw err/);
  assert.match(check, /broadcast\("update-error"[\s\S]*throw err/);
});

test('update error event makes the update modal visible', () => {
  const source = read('src/components/UpdateBanner.tsx');
  const errorHandler = between(source, 'const unsubError', 'return () =>');
  assert.match(errorHandler, /setIsVisible\(true\)/);
});
