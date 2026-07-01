import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('DatabaseManager exposes answer quality metrics with deduped event semantics', () => {
  const source = read('electron/db/DatabaseManager.ts');

  assert.match(source, /getAnswerQualityMetrics/);
  assert.match(source, /dedupedEvents/);
  assert.match(source, /answer_id.*event_type.*surface/s);
  assert.match(source, /ragHitRate/);
  assert.match(source, /noContextAnswerRate/);
  assert.match(source, /p95LatencyMs/);
});

test('IPC and preload expose answer quality metrics', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ipc, /get-answer-quality-metrics/);
  assert.match(preload, /getAnswerQualityMetrics/);
  assert.match(types, /getAnswerQualityMetrics/);
});
