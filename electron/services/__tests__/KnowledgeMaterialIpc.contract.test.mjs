import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

function handlerBody(channel) {
  const start = source.indexOf(`safeHandle('${channel}'`);
  assert.notEqual(start, -1, `${channel} handler should exist`);
  const next = source.indexOf('\n  safeHandle(', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

for (const channel of [
  'knowledge:upload-materials',
  'knowledge:delete-material',
  'knowledge:reindex-material',
]) {
  test(`${channel} invalidates uploaded-material context cache after mutation`, () => {
    const body = handlerBody(channel);
    assert.match(body, /invalidateMaterialCache\(\)/);
  });
}

test('knowledge:upload-materials invalidates cache again when background indexing completes', () => {
  const body = handlerBody('knowledge:upload-materials');
  assert.match(body, /onMaterialIndexChanged:\s*invalidateMaterialCache/);
});
