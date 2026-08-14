import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distRag = path.resolve('dist-electron/electron/rag');
const { RAGRetriever } = await import(
  pathToFileURL(path.join(distRag, 'RAGRetriever.js')).href
);
const { VectorStore } = await import(
  pathToFileURL(path.join(distRag, 'VectorStore.js')).href
);

function chunk(id, meetingId, text, similarity = 0.8) {
  return {
    id,
    meetingId,
    chunkIndex: 0,
    speaker: '我',
    startMs: 0,
    endMs: 1_000,
    text,
    tokenCount: Math.max(1, Math.ceil(text.length / 4)),
    similarity,
  };
}

function createRetriever({
  embeddingReady = true,
  embeddingError,
  lexical = [],
  vector = [],
  vectorError,
  meetingFallback,
  meetingFallbackResults = [],
  summaries = [],
  summaryError,
} = {}) {
  const calls = { lexicalQueries: [], embeddingQueries: [] };
  const vectorStore = {
    async searchLexical(query) {
      calls.lexicalQueries.push(query);
      return lexical;
    },
    async searchSimilar() {
      if (vectorError) throw vectorError;
      return vector;
    },
    async searchLexicalMeetings(query, options) {
      if (meetingFallback) return meetingFallback(query, options);
      return meetingFallbackResults;
    },
    async searchSummaries() {
      if (summaryError) throw summaryError;
      return summaries;
    },
  };
  const embeddingPipeline = {
    isReady() {
      return embeddingReady;
    },
    async getEmbeddingForQuery(query) {
      calls.embeddingQueries.push(query);
      if (!embeddingReady) throw new Error('embedding pipeline is not ready');
      if (embeddingError) throw embeddingError;
      return [0.1, 0.2, 0.3];
    },
    getActiveSpaceKey() {
      return 'test:model:3';
    },
  };
  const retriever = new RAGRetriever(vectorStore, embeddingPipeline);
  retriever.__testCalls = calls;
  return retriever;
}

test('global transcript fallback receives the raw Chinese query', async () => {
  const seen = [];
  const retriever = createRetriever({
    embeddingReady: false,
    meetingFallback(query) {
      seen.push(query);
      return [chunk(90, 'old-meeting', '数字化移交')];
    },
  });

  const result = await retriever.retrieveGlobal('数字化移交');

  assert.deepEqual(seen, ['数字化移交']);
  assert.match(result.formattedContext, /数字化移交/);
});

test('global chunk lexical retrieval receives the raw query while embeddings use the semantic query', async () => {
  const retriever = createRetriever({ embeddingReady: true });

  await retriever.retrieveGlobal('数字化移交', {
    semanticQuery: '数字化移交\nintent:open_question\n交付上下文',
  });

  assert.deepEqual(retriever.__testCalls.lexicalQueries, ['数字化移交']);
  assert.deepEqual(retriever.__testCalls.embeddingQueries, ['数字化移交\nintent:open_question\n交付上下文']);
});

test('structured global search returns one best candidate per meeting without token formatting', async () => {
  const retriever = createRetriever({
    embeddingReady: false,
    lexical: [
      chunk(301, 'meeting-a', '数字化移交第一处', 0.9),
      chunk(302, 'meeting-a', '数字化移交第二处', 0.8),
      chunk(303, 'meeting-b', '数字化移交另一个会议', 0.7),
    ],
  });

  const results = await retriever.searchGlobalMeetings('数字化移交', { limit: 5 });

  assert.deepEqual(results.map((item) => item.meetingId), ['meeting-a', 'meeting-b']);
  assert.equal(results[0].id, 301);
});

test('global lexical retrieval continues when query embedding throws', async () => {
  const retriever = createRetriever({
    embeddingReady: true,
    embeddingError: new Error('expected embedding failure'),
    lexical: [chunk(91, 'old-meeting', '手术机器人有 15000 个零件')],
  });

  const result = await retriever.retrieveGlobal('手术机器人');

  assert.match(result.formattedContext, /手术机器人/);
});

test('global lexical retrieval continues when vector search throws', async () => {
  const retriever = createRetriever({
    vectorError: new Error('expected vector search failure'),
    lexical: [chunk(92, 'old-meeting', '手术机器人有 15000 个零件')],
  });

  const result = await retriever.retrieveGlobal('手术机器人');

  assert.match(result.formattedContext, /手术机器人/);
});

test('global lexical retrieval continues when summary search throws', async () => {
  const retriever = createRetriever({
    summaryError: new Error('expected summary search failure'),
    lexical: [chunk(93, 'old-meeting', '数字化移交需要完整验收')],
  });

  const result = await retriever.retrieveGlobal('数字化移交');

  assert.match(result.formattedContext, /数字化移交/);
});

test('old exact Chinese phrase survives Top-K against recent semantic matches', async () => {
  const now = Date.now();
  const recentWeak = Array.from({ length: 8 }, (_, index) => ({
    ...chunk(index + 1, `recent-${index}`, `近期无关候选 ${index}`, 0.5),
    absoluteStartMs: now,
  }));
  const exactOld = {
    ...chunk(100, 'meeting-2024', '康乐斯团的手术机器人有 15000 个零件', 1),
    absoluteStartMs: Date.UTC(2024, 0, 1),
    lexicalScore: 1,
    vectorScore: 0,
  };
  const retriever = createRetriever({
    vector: recentWeak,
    lexical: [exactOld],
  });

  const result = await retriever.retrieveGlobal('手术机器人', { topK: 8 });

  assert.ok(result.chunks.some((item) => item.id === exactOld.id));
  assert.match(result.formattedContext, /手术机器人/);
});

test('oversized exact candidate does not hide later exact evidence that fits the budget', async () => {
  const exact = Array.from({ length: 6 }, (_, index) => ({
    ...chunk(200 + index, `meeting-${index}`, `数字化移交证据 ${index}`, 1 - (index * 0.05)),
    absoluteStartMs: Date.now() - index,
    tokenCount: index === 4 ? 100 : 10,
  }));
  const retriever = createRetriever({ vector: exact });

  const result = await retriever.retrieveGlobal('数字化移交', {
    topK: 8,
    maxTokens: 100,
  });

  assert.ok(result.chunks.some((item) => item.id === exact[5].id));
});

function createSearchDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      summary_json TEXT,
      start_time INTEGER,
      created_at TEXT
    );
    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      content TEXT,
      timestamp_ms INTEGER
    );
    INSERT INTO meetings (id, title, summary_json, start_time, created_at)
    VALUES
      ('digital', '交付讨论', '{}', 1, '2024-01-01T00:00:00.000Z'),
      ('surgical', '产品讨论', '{}', 2, '2024-01-02T00:00:00.000Z'),
      ('robot', '行业讨论', '{}', 3, '2024-01-03T00:00:00.000Z');
    INSERT INTO transcripts (meeting_id, content, timestamp_ms)
    VALUES
      ('digital', '项目需要完成数字化移交', 1),
      ('surgical', '产品采用手术机器人方案', 1),
      ('robot', '机器人行业解决方案', 1);
  `);
  return db;
}

test('global retrieval finds every reported Chinese phrase from raw transcripts without chunks', async () => {
  const db = createSearchDatabase();
  const store = Object.create(VectorStore.prototype);
  store.db = db;
  const retriever = createRetriever({
    embeddingReady: false,
    meetingFallback: (query, options) => store.searchLexicalMeetings(query, options),
  });

  for (const phrase of ['数字化移交', '手术机器人', '机器人']) {
    const result = await retriever.retrieveGlobal(phrase);
    assert.match(result.formattedContext, new RegExp(phrase), phrase);
  }

  db.close();
});
