import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('business system settings IPC handlers are registered', () => {
  const source = read('electron/ipcHandlers.ts');

  for (const channel of [
    'business-system:list-sources',
    'business-system:save-source',
    'business-system:delete-source',
    'business-system:test-source',
  ]) {
    assert.match(source, new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`), channel);
  }
});

test('preload exposes business system settings APIs', () => {
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  for (const name of [
    'getBusinessSystemKnowledgeSources',
    'saveBusinessSystemKnowledgeSource',
    'deleteBusinessSystemKnowledgeSource',
    'testBusinessSystemKnowledgeSource',
  ]) {
    assert.match(preload, new RegExp(`${name}:`), name);
    assert.match(rendererTypes, new RegExp(`${name}:`), name);
  }
});

test('settings IPC does not return plaintext credentials', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("safeHandle('business-system:list-sources'");
  const end = source.indexOf("safeHandle('business-system:save-source'", start);
  const handler = source.slice(start, end);

  assert.match(handler, /getBusinessSystemKnowledgeSourcesPublic/);
  assert.doesNotMatch(handler, /getBusinessSystemCredentials/);
});
