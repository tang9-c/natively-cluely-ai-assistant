import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('NativelyInterface tracks accepted, regenerated, and ignored lifecycle events', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /LatestAnswerLifecycle/);
  assert.match(source, /emitAnswerQualityEvent/);
  assert.match(source, /'accepted'/);
  assert.match(source, /'regenerated'/);
  assert.match(source, /'ignored'/);
  assert.match(source, /regenerated.*ignored|ignored.*regenerated/s);
});

test('NativelyInterface displays full confidence health states', () => {
  const source = read('src/components/NativelyInterface.tsx');

  for (const label of [
    'RAG 可用',
    'Embedding 可用',
    '上传资料未使用',
    '说话人分离不可用',
    '屏幕上下文不可用',
  ]) {
    assert.match(source, new RegExp(label));
  }

  assert.match(source, /sourceStatus/);
  assert.match(source, /sttUserStatus/);
  assert.match(source, /sttInterviewerStatus/);
});

test('NativelyInterface does not report RAG or embedding unavailable when source status is unknown', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /getContextHealth/);
  assert.match(source, /latestSourceStatus\?\.ragReady \?\? contextHealth\?\.ragReady/);
  assert.match(source, /latestSourceStatus\?\.embeddingReady \?\? contextHealth\?\.embeddingReady/);
  assert.match(source, /return '状态检查中'/);
  assert.doesNotMatch(source, /latestSourceStatus\?\.embeddingReady \? 'Embedding 可用' : 'Embedding 不可用'/);
});

test('NativelyInterface gates realtime answer state by request id and previews citations without promising source navigation', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /latestAnswerRequestIdRef/);
  assert.match(source, /requestId !== latestAnswerRequestIdRef\.current/);
  assert.match(source, /openAnswerCitation/);
  assert.match(source, /查看引用片段/);
  assert.match(source, /引用来源已变更，无法预览原片段|引用来源不可用/);
  assert.doesNotMatch(source, /打开资料引用/);
});

test('what-to-say request ids flow through IPC token batches and gate renderer updates', () => {
  const renderer = read('src/components/NativelyInterface.tsx');
  const ipc = read('electron/ipcHandlers.ts');
  const main = read('electron/main.ts');
  const preload = read('electron/preload.ts');

  assert.match(preload, /requestId\?: string/);
  assert.match(ipc, /requestId:\s*requestOptions\.requestId/);
  assert.match(ipc, /reserveWhatShouldISayRequest\(requestOptions\.requestId\)/);
  assert.match(main, /suggested_answer_token[\s\S]{0,300}requestId/);
  assert.match(main, /queueBatch\('suggested_answer',\s*\{\s*token,\s*question,\s*confidence,\s*requestId\s*\}\)/);
  assert.match(renderer, /activeRealtimeRequestIdRef/);
  assert.match(renderer, /it\.requestId\s*!==\s*activeRealtimeRequestIdRef\.current/);
  assert.match(renderer, /requestId:\s*realtimeRequestId/);
});

test('NativelyInterface renders stable realtime answer failure status instead of silently updating state', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /formatRealtimeAnswerStatusForDisplay/);
  assert.match(source, /scope-rejected/);
  assert.match(source, /provider-error/);
  assert.match(source, /no-result/);
  assert.match(source, /partial-trace-unavailable/);
  assert.match(source, /result\.statusCode\s*!==\s*'ok'/);
  assert.match(source, /role:\s*'system'/);
});
