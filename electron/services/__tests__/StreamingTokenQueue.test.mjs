import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { shouldFlushPreviousStream } from '../../../src/lib/streamingIntent.mjs';

test('shouldFlushPreviousStream only flushes when the incoming intent changes', () => {
  assert.equal(shouldFlushPreviousStream('chat', 'chat', 'stream-1'), false);
  assert.equal(shouldFlushPreviousStream('chat', 'what_to_answer', 'stream-1'), true);
  assert.equal(shouldFlushPreviousStream('chat', 'chat', null), false);
});

test('same-intent tokens should never trigger a flush boundary', () => {
  const tokens = ['变更', '管理', '有什么要求'];
  const flushDecisions = tokens.map((token, index) =>
    shouldFlushPreviousStream(index === 0 ? null : 'chat', 'chat', index === 0 ? null : 'stream-1'),
  );

  assert.deepEqual(flushDecisions, [false, false, false]);
});
