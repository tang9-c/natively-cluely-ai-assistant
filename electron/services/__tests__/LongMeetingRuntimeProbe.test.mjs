import assert from 'node:assert/strict';
import test from 'node:test';

import { LongMeetingRuntimeProbe } from '../../../dist-electron/electron/services/LongMeetingRuntimeProbe.js';

function dependencies() {
  return {
    getSession: () => ({ fullSegments: 20, effectiveSegments: 19, epochSummaries: 1, actionCandidates: 2, shownCards: 1 }),
    getStt: () => ({ workerCount: 1, leaseCount: 2, activeTasks: 0, queuedTasks: 0, pendingAudio: 0, vadBacklog: null }),
    getRag: () => ({ pending: 2, processing: 0, completed: 3, failed: 0, embeddingBatches: 4 }),
    getIpc: () => ({ pending: 0, batches: 5, averageBatchSize: 3, maxPending: 8 }),
    getProcesses: () => [{ type: 'Browser', pid: 1, cpuPercent: 2, workingSetBytes: 100 }],
    getFiles: () => ({ databaseBytes: 1024, walBytes: 0, tempAudioBytes: 0, logBytes: 10, embeddingRows: 2 }),
    memoryUsage: () => ({ rss: 1000, heapUsed: 500, heapTotal: 700, external: 20, arrayBuffers: 10 }),
    cpuUsage: () => ({ user: 0, system: 0 }),
    now: () => 1000,
    eventLoopDelayP95Ms: () => 2,
  };
}

test('probe returns normalized aggregate metrics and file sizes', async () => {
  const probe = new LongMeetingRuntimeProbe(dependencies());
  const snapshot = await probe.snapshot({ elapsedMs: 5_000, phase: 'meeting' });
  assert.equal(snapshot.session.fullSegments, 20);
  assert.equal(snapshot.rag.pending, 2);
  assert.equal(snapshot.files.databaseBytes, 1_024);
  assert.equal(snapshot.main.rssBytes, 1_000);
  probe.dispose();
});

test('probe output cannot carry transcript or credentials', async () => {
  const probe = new LongMeetingRuntimeProbe(dependencies());
  const json = JSON.stringify(await probe.snapshot({ elapsedMs: 0, phase: 'warmup' }));
  assert.doesNotMatch(json, /text|prompt|evidence|apiKey|token|audioBase64/i);
  probe.dispose();
});
