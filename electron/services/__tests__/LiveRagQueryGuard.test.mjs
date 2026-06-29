import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const guardPath = path.join(root, 'dist-electron/electron/rag/LiveRagQueryGuard.js');

async function loadGuard() {
  return import(pathToFileURL(guardPath).href);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('live RAG skips meeting control commands like 结束', async () => {
  const { shouldUseLiveRagQuery } = await loadGuard();

  assert.equal(shouldUseLiveRagQuery('结束'), false);
  assert.equal(shouldUseLiveRagQuery('结束。'), false);
  assert.equal(shouldUseLiveRagQuery('结束会议'), false);
  assert.equal(shouldUseLiveRagQuery('总结刚才客户提到的预算'), true);
});

test('live RAG worker failures are recoverable preflight errors', async () => {
  const { isRecoverableLiveRagError } = await loadGuard();

  assert.equal(isRecoverableLiveRagError('Worker exited with code 1'), true);
  assert.equal(isRecoverableLiveRagError('NO_RELEVANT_CONTEXT_FOUND'), true);
  assert.equal(isRecoverableLiveRagError('LLM helper not initialized'), false);
});

test('rag:query-live uses live RAG guard before querying and fallback for worker exit', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'rag:query-live');

  assert.match(source, /LiveRagQueryGuard/);
  assert.match(handler, /shouldUseLiveRagQuery\(query\)/);
  assert.match(handler, /isRecoverableLiveRagError\(msg\)/);
  assert.doesNotMatch(handler, /event\.sender\.send\('rag:stream-error',\s*\{\s*live:\s*true,\s*error:\s*msg\s*\}\)[\s\S]{0,80}Worker exited/);
});
