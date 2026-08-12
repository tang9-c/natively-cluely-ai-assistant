import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('storage management IPC is registered through safeHandle and exposed by preload', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const declarations = read('src/types/electron.d.ts');

  for (const channel of ['storage:get-usage', 'storage:delete-downloaded-model', 'storage:delete-legacy-data']) {
    assert.match(ipc, new RegExp(`safeHandle\\(\\s*['"]${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(['"]${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
  for (const method of ['getStorageUsage', 'deleteDownloadedModel', 'deleteLegacyData']) {
    assert.match(preload, new RegExp(`${method}:`));
    assert.match(declarations, new RegExp(`${method}:`));
  }
});

test('storage management appears under General settings and requires confirmation before deletion', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  const component = read('src/components/settings/StorageManagement.tsx');

  assert.match(settings, /<StorageManagement\s*\/>/);
  assert.match(component, /存储空间/);
  assert.match(component, /window\.confirm/);
  assert.match(component, /deleteDownloadedModel/);
  assert.match(component, /deleteLegacyData/);
  assert.match(component, /预计可释放/);
});
