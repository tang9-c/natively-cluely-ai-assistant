import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeProcessTree } from '../benchmark-packaged-idle-memory.mjs';

test('idle memory summary includes the spawned Electron process and recursive children only', () => {
  const table = [
    { pid: 10, ppid: 1, rssKb: 100 },
    { pid: 11, ppid: 10, rssKb: 40 },
    { pid: 12, ppid: 11, rssKb: 20 },
    { pid: 99, ppid: 1, rssKb: 900 },
  ];
  assert.deepEqual(summarizeProcessTree(table, 10), {
    pids: [10, 11, 12],
    rssKb: 160,
  });
});
