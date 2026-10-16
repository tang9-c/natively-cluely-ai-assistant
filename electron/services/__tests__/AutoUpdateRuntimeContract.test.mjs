import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

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

test('packaged startup configures manual updates without checking in the background', async () => {
  const setup = between(read('electron/main.ts'), 'private setupAutoUpdater()', 'private async checkForUpdatesManual()');
  const { code } = transformSync(`class AppState {
    ${setup}
    checkForUpdates() { return checkForUpdates(); }
  }
  new AppState().setupAutoUpdater();`, { loader: 'ts', format: 'cjs' });

  for (const platform of ['darwin', 'win32', 'linux']) {
    const timers = [];
    let checks = 0;
    const checkForUpdates = async () => { checks += 1; };
    const autoUpdater = {
      on() {},
      checkForUpdatesAndNotify: checkForUpdates,
    };
    vm.runInNewContext(code, {
      autoUpdater,
      app: { isPackaged: true },
      process: { platform },
      console: { log() {}, error() {} },
      checkForUpdates,
      setTimeout: callback => timers.push(callback),
    });
    for (const callback of timers) await callback();

    assert.equal(checks, 0, `${platform}: startup must not check for updates`);
    assert.equal(autoUpdater.autoDownload, false);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  }
});

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
