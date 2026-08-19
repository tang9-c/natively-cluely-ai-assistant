import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildVisibleTranscriptRows,
  getTranscriptRowKey,
} = require('../../../.tmp/transcript-virtualization-test/transcriptVirtualization.js');

test('filters non-human rows without mutating the full transcript', () => {
  const transcript = [
    { speaker: 'user', text: 'A', timestamp: 1 },
    { speaker: 'system', text: 'hidden', timestamp: 2 },
    { speaker: 'interviewer', text: 'B', timestamp: 3 },
  ];
  const rows = buildVisibleTranscriptRows(transcript);

  assert.deepEqual(rows.map(row => row.entry.text), ['A', 'B']);
  assert.equal(transcript.length, 3);
});

test('prefers raw segment ids and otherwise creates deterministic unique keys', () => {
  assert.equal(getTranscriptRowKey({
    speaker: 'user', text: 'A', timestamp: 1, rawSegmentIds: ['raw-1', 'raw-2'],
  }, 0), 'raw:raw-1|raw-2');
  assert.notEqual(
    getTranscriptRowKey({ speaker: 'user', text: 'same', timestamp: 1 }, 0),
    getTranscriptRowKey({ speaker: 'user', text: 'same', timestamp: 1 }, 1),
  );
});
