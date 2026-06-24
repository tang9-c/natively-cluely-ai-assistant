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

test('ipc handlers use login item normalization helpers', () => {
  const ipcHandlers = read('electron/ipcHandlers.ts');

  assert.match(ipcHandlers, /setOpenAtLoginForPlatform/);
  assert.match(ipcHandlers, /getOpenAtLoginForPlatform/);
  assert.doesNotMatch(ipcHandlers, /return settings\.openAtLogin;/);
});

test('login item helper normalizes Windows executableWillLaunchAtLogin', () => {
  const helper = read('electron/utils/loginItemSettings.ts');

  assert.match(helper, /executableWillLaunchAtLogin/);
  assert.match(helper, /platform === 'win32'/);
  assert.match(helper, /app\.getPath\('exe'\)/);
});
