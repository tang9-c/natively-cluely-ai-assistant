import assert from 'node:assert/strict';
import test from 'node:test';

import { collectSamples, validateBaselineMachine } from '../lib/performanceBaselineCollection.mjs';

test('collectSamples discards one warmup and preserves thirty measured durations', async () => {
  let call = 0;
  const samples = await collectSamples({
    runs: 30,
    warmupRuns: 1,
    runOnce: async () => ++call,
  });

  assert.deepEqual(samples, Array.from({ length: 30 }, (_, index) => index + 2));
});

test('baseline validation rejects a non-M4 or non-16GB machine', () => {
  assert.equal(validateBaselineMachine({ cpuModel: 'Apple M4', memoryBytes: 16 * 1024 ** 3 }), null);
  assert.equal(validateBaselineMachine({ cpuModel: 'Apple M3', memoryBytes: 16 * 1024 ** 3 }), 'baseline_cpu_mismatch');
  assert.equal(validateBaselineMachine({ cpuModel: 'Apple M4', memoryBytes: 8 * 1024 ** 3 }), 'baseline_memory_mismatch');
});
