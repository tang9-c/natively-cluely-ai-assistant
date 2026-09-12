import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-rag-delete-'));
const require = createRequire(import.meta.url);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: { app: { isPackaged: false, getPath: () => testUserData } },
  children: [],
  paths: [],
};
test.after(() => fs.rmSync(testUserData, { recursive: true, force: true }));

const distRag = path.resolve('dist-electron/electron/rag');
const [{ RAGManager }, { VectorStore }] = await Promise.all([
  import(pathToFileURL(path.join(distRag, 'RAGManager.js')).href),
  import(pathToFileURL(path.join(distRag, 'VectorStore.js')).href),
]);

test('meeting deletion removes relational, queue, vector, and meeting rows atomically', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meetings (id TEXT PRIMARY KEY);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE vec_chunks_768 (chunk_id INTEGER PRIMARY KEY);
    CREATE TABLE vec_summaries_768 (summary_id INTEGER PRIMARY KEY);
    INSERT INTO meetings VALUES ('meeting-delete');
    INSERT INTO chunks VALUES (11, 'meeting-delete');
    INSERT INTO chunk_summaries VALUES (21, 'meeting-delete');
    INSERT INTO embedding_queue VALUES (31, 'meeting-delete');
    INSERT INTO vec_chunks_768 VALUES (11);
    INSERT INTO vec_summaries_768 VALUES (21);
  `);

  const manager = Object.create(RAGManager.prototype);
  manager.db = db;
  manager.vectorStore = new VectorStore(db, ':memory:', '');

  assert.equal(manager.deleteMeetingCompletely('meeting-delete'), true);

  for (const table of ['chunks', 'chunk_summaries', 'embedding_queue', 'vec_chunks_768', 'vec_summaries_768', 'meetings']) {
    assert.equal(db.prepare(`SELECT count(*) count FROM ${table}`).get().count, 0, `${table} should be empty`);
  }
  db.close();
});

test('meeting deletion rolls back RAG cleanup when deleting the meeting row fails', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meetings (id TEXT PRIMARY KEY);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE embedding_queue (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE vec_chunks_768 (chunk_id INTEGER PRIMARY KEY);
    CREATE TABLE vec_summaries_768 (summary_id INTEGER PRIMARY KEY);
    INSERT INTO meetings VALUES ('meeting-delete');
    INSERT INTO chunks VALUES (11, 'meeting-delete');
    INSERT INTO chunk_summaries VALUES (21, 'meeting-delete');
    INSERT INTO embedding_queue VALUES (31, 'meeting-delete');
    INSERT INTO vec_chunks_768 VALUES (11);
    INSERT INTO vec_summaries_768 VALUES (21);
    CREATE TRIGGER reject_meeting_delete BEFORE DELETE ON meetings
    BEGIN
      SELECT RAISE(ABORT, 'meeting delete failed');
    END;
  `);

  const manager = Object.create(RAGManager.prototype);
  manager.db = db;
  manager.vectorStore = new VectorStore(db, ':memory:', '');

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(manager.deleteMeetingCompletely('meeting-delete'), false);
  } finally {
    console.warn = originalWarn;
  }
  for (const table of ['chunks', 'chunk_summaries', 'embedding_queue', 'vec_chunks_768', 'vec_summaries_768', 'meetings']) {
    assert.equal(db.prepare(`SELECT count(*) count FROM ${table}`).get().count, 1, `${table} should be restored`);
  }
  db.close();
});

test('late embedding results do not create vectors after source rows were deleted', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, embedding BLOB);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT, embedding BLOB);
    CREATE TABLE vec_chunks_2 (chunk_id INTEGER PRIMARY KEY, embedding BLOB);
    CREATE TABLE vec_summaries_2 (summary_id INTEGER PRIMARY KEY, embedding BLOB);
  `);

  const store = Object.create(VectorStore.prototype);
  store.db = db;
  store.useNativeVec = true;

  store.storeEmbedding(11, [0.1, 0.2]);
  store.storeSummaryEmbedding('meeting-delete', [0.1, 0.2]);

  assert.equal(db.prepare('SELECT count(*) count FROM vec_chunks_2').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) count FROM vec_summaries_2').get().count, 0);
  db.close();
});

test('existing source rows still receive embeddings', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, embedding BLOB);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT, embedding BLOB);
    INSERT INTO chunks VALUES (11, NULL);
    INSERT INTO chunk_summaries VALUES (21, 'meeting-keep', NULL);
  `);

  const store = Object.create(VectorStore.prototype);
  store.db = db;
  store.useNativeVec = false;

  store.storeEmbedding(11, [0.1, 0.2]);
  store.storeSummaryEmbedding('meeting-keep', [0.1, 0.2]);

  assert.notEqual(db.prepare('SELECT embedding FROM chunks WHERE id = 11').get().embedding, null);
  assert.notEqual(db.prepare("SELECT embedding FROM chunk_summaries WHERE meeting_id = 'meeting-keep'").get().embedding, null);
  db.close();
});

test('vector cleanup failure preserves relational IDs and aborts deletion', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE chunk_summaries (id INTEGER PRIMARY KEY, meeting_id TEXT);
    CREATE TABLE vec_chunks_768 (chunk_id INTEGER PRIMARY KEY);
    CREATE TABLE vec_summaries_768 (summary_id INTEGER PRIMARY KEY);
    INSERT INTO chunks VALUES (11, 'meeting-delete');
    INSERT INTO chunk_summaries VALUES (21, 'meeting-delete');
    INSERT INTO vec_chunks_768 VALUES (11);
    CREATE TRIGGER reject_vector_delete BEFORE DELETE ON vec_chunks_768
    BEGIN
      SELECT RAISE(ABORT, 'vector delete failed');
    END;
  `);

  const store = new VectorStore(db, ':memory:', '');
  assert.throws(() => store.deleteChunksForMeeting('meeting-delete'), /vector delete failed/);
  assert.equal(db.prepare('SELECT count(*) count FROM chunks').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) count FROM chunk_summaries').get().count, 1);
  db.close();
});
