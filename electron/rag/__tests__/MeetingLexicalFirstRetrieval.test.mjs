import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { RAGRetriever } = await import(
  pathToFileURL(path.resolve('dist-electron/electron/rag/RAGRetriever.js')).href
);

function chunk(id, meetingId, text, similarity = 0.8) {
  return {
    id,
    meetingId,
    chunkIndex: 0,
    speaker: '客户',
    startMs: 0,
    endMs: 1000,
    text,
    tokenCount: 8,
    similarity,
    lexicalScore: similarity,
  };
}

function createHarness({
  embeddingReady,
  embeddingError,
  lexical = [chunk(1, 'meeting-a', '预算为 700 万')],
  vector = [],
}) {
  const calls = {
    lexical: [],
    vector: [],
    embedding: 0,
  };
  const vectorStore = {
    async searchLexical(query, options) {
      calls.lexical.push({ query, options });
      return lexical;
    },
    async searchSimilar(queryEmbedding, options) {
      calls.vector.push({ queryEmbedding, options });
      return vector;
    },
  };
  const embeddingPipeline = {
    isReady() {
      return embeddingReady;
    },
    async getEmbeddingForQuery() {
      calls.embedding += 1;
      if (embeddingError) throw embeddingError;
      return [0.1, 0.2, 0.3];
    },
    getActiveSpaceKey() {
      return 'test:model:3';
    },
  };

  return {
    calls,
    retriever: new RAGRetriever(vectorStore, embeddingPipeline),
  };
}

test('meeting retrieval uses lexical results when embedding is unavailable', async () => {
  const { retriever, calls } = createHarness({ embeddingReady: false });

  const result = await retriever.retrieve('预算', { meetingId: 'meeting-a' });

  assert.deepEqual(result.chunks.map((item) => item.meetingId), ['meeting-a']);
  assert.equal(calls.embedding, 0);
  assert.equal(calls.vector.length, 0);
  assert.equal(calls.lexical.length, 1);
  assert.equal(calls.lexical[0].options.meetingId, 'meeting-a');
});

test('meeting retrieval preserves lexical results when query embedding fails', async () => {
  const { retriever, calls } = createHarness({
    embeddingReady: true,
    embeddingError: new Error('provider details must not be logged'),
  });

  const result = await retriever.retrieve('预算', { meetingId: 'meeting-a' });

  assert.deepEqual(result.chunks.map((item) => item.meetingId), ['meeting-a']);
  assert.equal(calls.embedding, 1);
  assert.equal(calls.lexical.length, 1);
});

test('meeting retrieval removes candidates that do not match the requested meeting', async () => {
  const { retriever, calls } = createHarness({
    embeddingReady: true,
    lexical: [
      chunk(1, 'meeting-a', '预算为 700 万'),
      chunk(2, 'meeting-b', '预算为 300 万'),
    ],
    vector: [
      chunk(3, 'meeting-a', '项目预算'),
      chunk(4, 'meeting-b', '其他会议预算'),
    ],
  });

  const result = await retriever.retrieve('预算', { meetingId: 'meeting-a' });

  assert.ok(result.chunks.length > 0);
  assert.deepEqual(
    [...new Set(result.chunks.map((item) => item.meetingId))],
    ['meeting-a'],
  );
  assert.equal(calls.lexical[0].options.meetingId, 'meeting-a');
  assert.equal(calls.vector[0].options.meetingId, 'meeting-a');
});

test('meeting retrieval returns an empty context without entering a global search path', async () => {
  const { retriever, calls } = createHarness({
    embeddingReady: false,
    lexical: [],
  });

  const result = await retriever.retrieve('天心', { meetingId: 'meeting-a' });

  assert.deepEqual(result.chunks, []);
  assert.equal(result.formattedContext, '');
  assert.equal(calls.lexical.length, 1);
  assert.equal(calls.vector.length, 0);
});
