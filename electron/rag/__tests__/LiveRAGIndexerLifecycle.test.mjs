import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { LiveRAGIndexer } = await import(
  pathToFileURL(path.resolve('dist-electron/electron/rag/LiveRAGIndexer.js')).href
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createVectorStore() {
  const savedChunks = [];
  return {
    savedChunks,
    saveChunks(chunks) {
      savedChunks.push(...chunks);
      return chunks.map((_, index) => savedChunks.length - chunks.length + index + 1);
    },
    storeEmbedding() {},
    stampMeetingSpaceIfUnset() {},
  };
}

function createEmbeddingPipeline(getEmbedding) {
  return {
    isReady: () => true,
    getEmbedding,
    getActiveProviderName: () => 'local',
    getActiveSpaceKey: () => 'local:384',
    getActiveDimensions: () => 384,
  };
}

function segments(count, prefix = 'segment') {
  return Array.from({ length: count }, (_, index) => ({
    speaker: index % 2 === 0 ? 'interviewer' : 'user',
    text: `${prefix} ${index} contains enough meaningful words`,
    timestamp: index * 10_000,
  }));
}

test('stop waits for an in-flight indexing tick before resolving', async () => {
  const embeddingGate = deferred();
  const vectorStore = createVectorStore();
  const indexer = new LiveRAGIndexer(
    vectorStore,
    createEmbeddingPipeline(() => embeddingGate.promise),
  );
  indexer.start('meeting-race');
  indexer.feedSegments(segments(3));

  const tickPromise = indexer.tick();
  await new Promise((resolve) => setImmediate(resolve));
  let stopped = false;
  const stopPromise = indexer.stop().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(stopped, false, 'stop must wait for the pending embedding');
  embeddingGate.resolve(new Array(384).fill(0));
  await Promise.all([tickPromise, stopPromise]);
  assert.equal(stopped, true);
});

test('stop force-flushes a meaningful tail smaller than the periodic threshold', async () => {
  const vectorStore = createVectorStore();
  const indexer = new LiveRAGIndexer(
    vectorStore,
    createEmbeddingPipeline(async () => new Array(384).fill(0)),
  );
  indexer.start('meeting-tail');
  indexer.feedSegments(segments(1, 'final tail'));

  await indexer.stop();

  assert.equal(vectorStore.savedChunks.length, 1);
  assert.match(vectorStore.savedChunks[0].text, /final tail/);
});

test('segments arriving during a tick survive compaction and flush on stop', async () => {
  const embeddingGate = deferred();
  let embeddingCalls = 0;
  const vectorStore = createVectorStore();
  const indexer = new LiveRAGIndexer(
    vectorStore,
    createEmbeddingPipeline(async () => {
      embeddingCalls += 1;
      if (embeddingCalls === 1) {
        return embeddingGate.promise;
      }
      return new Array(384).fill(0);
    }),
  );
  indexer.start('meeting-concurrent-feed');
  indexer.feedSegments(segments(3, 'initial'));

  const tickPromise = indexer.tick();
  await new Promise((resolve) => setImmediate(resolve));
  indexer.feedSegments([{
    speaker: 'user',
    text: 'late arrival contains enough meaningful words',
    timestamp: 60_000,
  }]);
  const stopPromise = indexer.stop();
  embeddingGate.resolve(new Array(384).fill(0));

  await Promise.all([tickPromise, stopPromise]);
  assert.ok(
    vectorStore.savedChunks.some((chunk) => chunk.text.includes('late arrival')),
    'the segment appended during the first tick must be flushed separately',
  );
});

test('a successful periodic tick releases its processed transcript prefix', async () => {
  const vectorStore = createVectorStore();
  const indexer = new LiveRAGIndexer(
    vectorStore,
    createEmbeddingPipeline(async () => new Array(384).fill(0)),
  );
  indexer.start('meeting-compaction');
  indexer.feedSegments(segments(3));

  await indexer.tick();

  assert.equal(indexer.allSegments.length, 0);
  await indexer.stop();
});
