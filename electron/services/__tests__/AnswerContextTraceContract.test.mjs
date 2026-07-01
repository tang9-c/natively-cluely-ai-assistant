import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('renderer and main trace contracts include required context and source status fields', () => {
  const rendererTypes = read('src/types/electron.d.ts');
  const dbSource = read('electron/db/DatabaseManager.ts');

  for (const source of [rendererTypes, dbSource]) {
    assert.match(source, /AnswerContextUsed/);
    for (const key of [
      'currentTranscript',
      'shortTermHistory',
      'uploadedDocumentRag',
      'historicalMeetings',
      'longTermMemory',
      'enterpriseKnowledge',
      'screenContext',
    ]) {
      assert.match(source, new RegExp(`${key}:\\s*boolean`));
    }

    assert.match(source, /AnswerSourceStatus/);
    for (const key of [
      'ragAttempted',
      'ragReady',
      'embeddingReady',
      'uploadedMaterialHitCount',
      'citationCount',
      'screenContextStatus',
    ]) {
      assert.match(source, new RegExp(`${key}`));
    }
  }
});

test('database hydrates missing trace context and source status with conservative defaults', () => {
  const dbSource = read('electron/db/DatabaseManager.ts');

  assert.match(dbSource, /function normalizeAnswerContextUsed/);
  assert.match(dbSource, /function normalizeAnswerSourceStatus/);
  assert.match(dbSource, /currentTranscript:\s*Boolean\(input\?\.currentTranscript\)/);
  assert.match(dbSource, /ragAttempted:\s*Boolean\(input\?\.ragAttempted\)/);
  assert.match(dbSource, /uploadedMaterialHitCount:\s*Number\.isFinite/);
  assert.match(dbSource, /sourceStatus:\s*normalizeAnswerSourceStatus/);
});
