import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('launcher ad IPC is registered, exposed, and typed', () => {
  const handlers = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(handlers, /safeHandle\('get-launcher-ads'/);
  assert.match(handlers, /safeHandle\('open-ad-link'/);
  assert.match(handlers, /RemoteAdService\.isAllowedTargetUrl/);
  assert.match(preload, /getLauncherAds: \(\) => ipcRenderer\.invoke\('get-launcher-ads'\)/);
  assert.match(preload, /openAdLink: \(url: string\) => ipcRenderer\.invoke\('open-ad-link', url\)/);
  assert.match(types, /getLauncherAds: \(\) => Promise<LauncherAd\[\]>/);
  assert.match(types, /openAdLink: \(url: string\) => Promise<\{ success: boolean \}>/);
});
