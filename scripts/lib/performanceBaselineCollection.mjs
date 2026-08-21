const TARGET_MEMORY_BYTES = 16 * 1024 ** 3;

export async function collectSamples({ runs = 30, warmupRuns = 1, runOnce }) {
  const samples = [];
  for (let index = 0; index < warmupRuns + runs; index += 1) {
    const durationMs = await runOnce(index);
    if (index >= warmupRuns && Number.isFinite(durationMs) && durationMs >= 0) samples.push(durationMs);
  }
  return samples;
}

export function validateBaselineMachine({ cpuModel, memoryBytes }) {
  if (!/Apple M4\b/i.test(String(cpuModel))) return 'baseline_cpu_mismatch';
  if (memoryBytes !== TARGET_MEMORY_BYTES) return 'baseline_memory_mismatch';
  return null;
}
