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

test('business system credentials never join realtime prompt candidates', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const service = read('electron/services/business-system/BusinessSystemContextService.ts');

  assert.doesNotMatch(service, /apiKey[\s\S]{0,120}candidate/);
  assert.doesNotMatch(service, /password[\s\S]{0,120}candidate/);
  assert.doesNotMatch(ipc, /getBusinessSystemCredentials[\s\S]{0,240}contextCandidates\.push/);
});

test('business system trace observability contains status and source name only', () => {
  const ipc = read('electron/ipcHandlers.ts');

  assert.match(ipc, /businessSystemStatus/);
  assert.match(ipc, /businessSystemSourceName/);
  assert.doesNotMatch(ipc, /businessSystem.*apiKey/);
  assert.doesNotMatch(ipc, /businessSystem.*password/);
});
