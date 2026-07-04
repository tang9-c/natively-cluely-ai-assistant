import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('business system fixed reply branch returns before any LLM generation', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');
  const fixedReplyIndex = handler.indexOf("businessSystemResult.kind === 'fixed_reply'");
  const returnIndex = handler.indexOf('return {', fixedReplyIndex);
  const runLlmIndex = handler.indexOf('runWhatShouldISay', fixedReplyIndex);

  assert.ok(fixedReplyIndex >= 0, 'fixed reply branch should exist');
  assert.ok(returnIndex > fixedReplyIndex, 'fixed reply branch should return a response');
  assert.ok(runLlmIndex > fixedReplyIndex, 'handler should still call runWhatShouldISay in non-fixed paths');
  assert.ok(returnIndex < runLlmIndex, 'fixed reply branch must return before runWhatShouldISay');
});

test('business system fixed reply trace records source status and no business system context', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');
  const fixedReplyIndex = handler.indexOf("businessSystemResult.kind === 'fixed_reply'");
  const contextBranchIndex = handler.indexOf("if (businessSystemResult.kind === 'context')", fixedReplyIndex);
  const fixedReplyBlock = handler.slice(fixedReplyIndex, contextBranchIndex);

  assert.match(fixedReplyBlock, /businessSystemContext:\s*false/);
  assert.match(fixedReplyBlock, /businessSystemStatus:\s*businessSystemResult\.status/);
  assert.match(fixedReplyBlock, /status:\s*'generated_with_fallback'/);
  assert.match(fixedReplyBlock, /statusCode:\s*'business-system-unavailable'/);
});
