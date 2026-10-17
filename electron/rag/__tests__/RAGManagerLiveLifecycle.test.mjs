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

const { LiveRAGIndexer } = require(path.join(root, 'dist-electron/electron/rag/LiveRAGIndexer.js'));
const { EmbeddingPipeline } = require(path.join(root, 'dist-electron/electron/rag/EmbeddingPipeline.js'));

function disposingManager(liveIndexer, embeddingPipeline, vectorStore) {
  const manager = Object.create(RAGManager.prototype);
  Object.assign(manager, {liveIndexer, embeddingPipeline, vectorStore, pendingLiveSegments: [], meetingReindexTimers: new Map(), cancelPendingReindex(){}});
  return manager;
}

test('A2-fix2-R1 dispose invalidates pending live embeddings before destroying storage', async () => {
  const gate = deferred(); let writesAfterDispose = 0; let destroyed = false;
  const vectorStore = {saveChunks: () => [1], storeEmbedding: () => {if (destroyed) writesAfterDispose++;},
    stampMeetingSpaceIfUnset: () => {if (destroyed) writesAfterDispose++;}, destroy: async () => {destroyed = true;}};
  const pipeline = {isReady: () => true, getEmbedding: () => gate.promise, getActiveProviderName: () => 'fixture',
    getActiveSpaceKey: () => 'fixture:2', getActiveDimensions: () => 2, dispose(){}};
  const live = new LiveRAGIndexer(vectorStore, pipeline);
  await live.start('A'); live.feedSegments(Array.from({length: 3}, (_, i) => ({speaker: 'user', text: 'fixture segment with enough words', timestamp: i * 10000})));
  const pending = live.tick(); await new Promise(resolve => setImmediate(resolve));
  const manager = disposingManager(live, pipeline, vectorStore);
  await manager.dispose(); const runningAfterDispose = live.isRunning();
  gate.resolve([1, 0]); await pending; await live.stop();
  assert.equal(runningAfterDispose, false); assert.equal(writesAfterDispose, 0);
});

test('A2-fix2-R2 initialization returning after dispose creates no live row or timer', async () => {
  const gate = deferred(); let rows = 0; let starts = 0; let destroys = 0;
  const manager = disposingManager({start: async () => {starts++;}, feedSegments(){}, dispose(){}},
    {ensureInitialized: () => gate.promise, dispose(){}}, {destroy: async () => {destroys++;}});
  manager.db = {prepare: () => ({run: () => {rows++;}})};
  const starting = manager.startLiveIndexing('A');
  const stopping = manager.stopLiveIndexing();
  await manager.dispose(); await manager.dispose(); gate.resolve(); await Promise.all([starting, stopping]);
  assert.equal(rows, 0); assert.equal(starts, 0); assert.equal(destroys, 1);
});

test('A2-fix2-R3 disposed background queue cannot write completed status or embeddings', async () => {
  const gate = deferred(); let destroyed = false; let lateWrites = 0; let selected = false;
  const pipeline = Object.create(EmbeddingPipeline.prototype);
  pipeline.provider = {name: 'fixture', dimensions: 2, space: 'fixture:2'};
  pipeline.fallbackMeetings = new Set(); pipeline.initializedCallbacks = new Set();
  pipeline.ensureInitialized = async () => {};
  pipeline.embedWithTimeout = () => gate.promise;
  pipeline.db = {prepare: sql => ({
    get: () => sql.includes('SELECT * FROM embedding_queue') ? (selected ? undefined : (selected = true, {id: 1, meeting_id: 'A', chunk_id: 1, retry_count: 0})) : {cleaned_text: 'fixture', meeting_id: 'A'},
    run: () => {if (destroyed) lateWrites++; return {changes: 0};}
  })};
  const vectorStore = {storeEmbedding: () => {if (destroyed) lateWrites++;}, destroy: async () => {destroyed = true;}};
  pipeline.vectorStore = vectorStore;
  const pending = pipeline.processQueue(); await new Promise(resolve => setImmediate(resolve));
  const manager = disposingManager({dispose(){}}, pipeline, vectorStore);
  await manager.dispose(); gate.resolve([1, 0]); await pending;
  assert.equal(lateWrites, 0);
});

test('A2-fix2-R4 dispose releases queue backoff without waiting for its timer', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const pipeline = Object.create(EmbeddingPipeline.prototype); pipeline.initializedCallbacks = new Set();
  const manager = disposingManager({dispose(){}}, pipeline, {destroy: async () => {}});
  let finished = false;
  const backoff = pipeline.delay(60000).then(() => {finished = true;});
  await manager.dispose(); await new Promise(resolve => setImmediate(resolve));
  try {assert.equal(finished, true);} finally {t.mock.timers.tick(60000); await backoff;}
});
