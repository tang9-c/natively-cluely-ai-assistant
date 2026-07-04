import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

async function loadTraceHelper() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/BusinessSystemFixedReplyTrace.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
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

test('business system fixed reply trace helper records source status and no injected business context', async () => {
  const { buildBusinessSystemFixedReplyTraceInput } = await loadTraceHelper();

  const trace = buildBusinessSystemFixedReplyTraceInput({
    answerId: 'answer-1',
    surface: 'overlay',
    latencyMs: 42,
    question: '根据 PLM 回答一下这个怎么样',
    ragReady: true,
    embeddingReady: false,
    screenContextStatus: 'failed',
    businessSystemStatus: 'missing_query_anchor',
    businessSystemSourceName: 'PLM 知识源',
    degradedReason: 'business_system_missing_query_anchor',
    businessSystemTimingMs: 7,
  });

  assert.equal(trace.answerId, 'answer-1');
  assert.equal(trace.status, 'generated_with_fallback');
  assert.equal(trace.degradedReason, 'business_system_missing_query_anchor');
  assert.equal(trace.contextUsed.businessSystemContext, false);
  assert.equal(trace.contextUsed.currentTranscript, true);
  assert.equal(trace.sourceStatus.businessSystemStatus, 'missing_query_anchor');
  assert.equal(trace.sourceStatus.businessSystemSourceName, 'PLM 知识源');
  assert.deepEqual(trace.observability, {
    retrievalTimingMs: { business_system: 7 },
    businessSystemStatus: 'missing_query_anchor',
    businessSystemSourceName: 'PLM 知识源',
  });
});
