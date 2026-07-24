import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('strict meeting search flow never logs query, evidence, prompt, or raw errors', () => {
  const flow = read('electron/rag/MeetingSearchFlow.ts');
  const registry = read('electron/rag/MeetingSearchRequestRegistry.ts');

  for (const source of [flow, registry]) {
    assert.doesNotMatch(source, /console\.(log|warn|error)/);
    assert.doesNotMatch(source, /redactForLog\([^)]*(query|prompt|transcript|formattedContext)/);
  }
});

test('meeting IPC handler contains no raw search error logging', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("'rag:query-meeting'");
  const end = source.indexOf('// Query live meeting with JIT RAG', start);
  const handler = source.slice(start, end);

  assert.doesNotMatch(handler, /console\.(log|warn|error)/);
  assert.doesNotMatch(handler, /error\.message|String\(error\)|request\.query\)/);
  assert.doesNotMatch(handler, /resolveUploadedMaterialChatContext|queryGlobal/);
});

test('embedding degradation logs only bounded diagnostic metadata', () => {
  const source = read('electron/rag/RAGRetriever.ts');
  const marker = source.indexOf("errorType: 'embedding_query_failed'");
  assert.ok(marker > 0);
  const block = source.slice(source.lastIndexOf('catch', marker), source.indexOf('}', marker) + 1);

  assert.match(block, /meetingIdPresent/);
  assert.match(block, /embedding_query_failed/);
  assert.doesNotMatch(block, /\bquery\b|error\.message|chunk\.text|\bprovider\b/);
});
