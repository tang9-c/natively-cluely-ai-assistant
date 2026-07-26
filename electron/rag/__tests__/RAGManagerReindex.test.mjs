import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distRag = path.resolve('dist-electron/electron/rag');
const [{ RAGManager }, { VectorStore }] = await Promise.all([
  import(pathToFileURL(path.join(distRag, 'RAGManager.js')).href),
  import(pathToFileURL(path.join(distRag, 'VectorStore.js')).href),
]);

test('a local-space meeting triggers auto-reindex when QCLOUD becomes active', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      is_processed INTEGER NOT NULL,
      embedding_space TEXT
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      meeting_id TEXT,
      embedding BLOB
    );
    CREATE TABLE chunk_summaries (
      id INTEGER PRIMARY KEY,
      meeting_id TEXT,
      embedding BLOB
    );
    INSERT INTO meetings (id, created_at, is_processed, embedding_space)
    VALUES (
      'meeting-local',
      '2026-07-26T00:00:00.000Z',
      1,
      'local:xenova/paraphrase-multilingual-minilm-l12-v2:384'
    );
  `);

  const vectorStore = new VectorStore(db, ':memory:', '');
  const qcloudSpace = 'qcloud:doubao-embedding-vision-251215:4096';
  assert.equal(vectorStore.getIncompatibleSpaceCount(qcloudSpace), 1);

  const manager = Object.create(RAGManager.prototype);
  manager.vectorStore = vectorStore;
  manager.embeddingPipeline = {
    getActiveSpaceKey: () => qcloudSpace,
  };
  manager._autoReindexTimer = null;

  let reindexCalls = 0;
  manager._runReindex = async () => {
    reindexCalls += 1;
  };

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = callback => {
    callback();
    return 1;
  };

  try {
    manager.scheduleAutoReindex();
    assert.equal(reindexCalls, 1);
  } finally {
    global.setTimeout = originalSetTimeout;
    db.close();
  }
});
