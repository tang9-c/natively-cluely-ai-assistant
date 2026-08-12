import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateMemoryReduction } from '../benchmark-dual-sensevoice-memory.mjs';

test('dual SenseVoice memory reduction uses the loaded-runtime delta', () => {
  const result = calculateMemoryReduction({ baselineStart: 100, baselineLoaded: 500 }, {
    currentStart: 100,
    currentLoaded: 300,
  });
  assert.deepEqual(result, {
    baselineDelta: 400,
    currentDelta: 200,
    reductionRatio: 0.5,
  });
});

test('dual SenseVoice memory reduction rejects a non-positive baseline', () => {
  assert.throws(() => calculateMemoryReduction(
    { baselineStart: 100, baselineLoaded: 100 },
    { currentStart: 100, currentLoaded: 90 },
  ), /positive/);
});
