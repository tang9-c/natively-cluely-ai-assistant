import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const { RAGManager } = require(path.join(root, 'dist-electron/electron/rag/RAGManager.js'));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('stop waits for deferred live start and startup transcript is flushed before stop', async () => {
  const initialization = deferred();
  const events = [];
  let active = false;
  const manager = Object.create(RAGManager.prototype);
  manager.embeddingPipeline = {
    ensureInitialized: () => initialization.promise,
  };
  manager.db = {
    prepare: () => ({ run: () => ({ changes: 1 }) }),
  };
  manager.liveIndexer = {
    async start() {
      events.push('start');
      active = true;
    },
    feedSegments(segments) {
      if (active) events.push(`feed:${segments.map((segment) => segment.text).join('|')}`);
    },
    async stop() {
      events.push('stop');
      active = false;
    },
  };
  manager.pendingLiveSegments = [];
  manager.liveRagStartPromise = null;

  const starting = manager.startLiveIndexing('live-meeting-current');
  manager.feedLiveTranscript([{ speaker: 'user', text: 'opening final', timestamp: 1 }]);
  let stopped = false;
  const stopping = manager.stopLiveIndexing().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  const stoppedBeforeInitialization = stopped;

  initialization.resolve();
  await Promise.all([starting, stopping]);

  assert.equal(stoppedBeforeInitialization, false);
  assert.deepEqual(events, ['start', 'feed:opening final', 'stop']);
  assert.equal(active, false);
});
