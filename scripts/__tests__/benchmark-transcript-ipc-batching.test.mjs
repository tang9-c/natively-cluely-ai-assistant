import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runTranscriptIpcBenchmark } from '../benchmark-transcript-ipc-batching.mjs';

test('30-minute synthetic stream meets IPC acceptance limits', async () => {
  const result = await runTranscriptIpcBenchmark({ durationMinutes: 30, seed: 42 });

  assert.ok(result.messageReductionRatio >= 0.5);
  assert.ok(result.waitP95Ms <= 100);
  assert.equal(result.finalLossCount, 0);
  assert.equal(result.orderMismatchCount, 0);
  assert.ok(result.maxPendingCount <= 16);
});
