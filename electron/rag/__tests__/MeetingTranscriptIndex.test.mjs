import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distRag = path.resolve('dist-electron/electron/rag');

async function loadFingerprintModule() {
  return import(pathToFileURL(path.join(distRag, 'MeetingTranscriptFingerprint.js')).href);
}

async function loadVectorStore() {
  const { VectorStore } = await import(
    pathToFileURL(path.join(distRag, 'VectorStore.js')).href
  );
  return VectorStore;
}

function createIndexDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      rag_transcript_hash TEXT,
      rag_index_state TEXT NOT NULL DEFAULT 'missing'
    );

    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      speaker TEXT,
      start_timestamp_ms INTEGER,
      end_timestamp_ms INTEGER,
      cleaned_text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding BLOB
    );

    CREATE TABLE embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      chunk_id INTEGER,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE vec_chunks_4 (
      chunk_id INTEGER PRIMARY KEY,
      embedding BLOB
    );

    INSERT INTO meetings (id, rag_transcript_hash, rag_index_state)
    VALUES
      ('meeting-a', 'old-hash', 'complete'),
      ('meeting-b', 'other-hash', 'complete');

    INSERT INTO chunks (
      meeting_id, chunk_index, speaker, start_timestamp_ms,
      end_timestamp_ms, cleaned_text, token_count, embedding
    )
    VALUES
      ('meeting-a', 0, '客户', 0, 1000, '旧索引内容', 4, X'00000000'),
      ('meeting-b', 0, '客户', 0, 1000, '其他会议内容', 4, X'00000000');

    INSERT INTO embedding_queue (meeting_id, chunk_id, status)
    SELECT meeting_id, id, 'pending' FROM chunks;

    INSERT INTO vec_chunks_4 (chunk_id, embedding)
    SELECT id, X'00000000' FROM chunks;
  `);
  return db;
}

function createVectorStore(VectorStore, db) {
  const store = Object.create(VectorStore.prototype);
  store.db = db;
  store.useNativeVec = true;
  return store;
}

test('transcript fingerprint is stable for canonical timestamp and row-id order', async () => {
  const { fingerprintTranscript } = await loadFingerprintModule();
  const laterFirst = [
    { id: 2, speaker: '客户', timestampMs: 20, content: '第二句' },
    { id: 1, speaker: '我', timestampMs: 10, content: '第一句' },
  ];
  const canonical = [...laterFirst].reverse();

  const first = fingerprintTranscript(laterFirst);
  const second = fingerprintTranscript(canonical);

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('transcript fingerprint changes with speaker, timestamp, or content', async () => {
  const { fingerprintTranscript } = await loadFingerprintModule();
  const base = [{ id: 1, speaker: '我', timestampMs: 10, content: '预算为 700 万' }];
  const baseHash = fingerprintTranscript(base);

  assert.notEqual(
    fingerprintTranscript([{ ...base[0], speaker: '客户' }]),
    baseHash,
  );
  assert.notEqual(
    fingerprintTranscript([{ ...base[0], timestampMs: 11 }]),
    baseHash,
  );
  assert.notEqual(
    fingerprintTranscript([{ ...base[0], content: '预算为 300 万' }]),
    baseHash,
  );
});

test('atomic replacement removes old chunks, vectors, and embedding queue only for the meeting', async () => {
  const VectorStore = await loadVectorStore();
  const db = createIndexDatabase();
  const store = createVectorStore(VectorStore, db);
  const oldMeetingAChunkId = db.prepare(
    'SELECT id FROM chunks WHERE meeting_id = ?',
  ).get('meeting-a').id;
  const meetingBChunkId = db.prepare(
    'SELECT id FROM chunks WHERE meeting_id = ?',
  ).get('meeting-b').id;

  store.replaceMeetingChunksAtomically('meeting-a', [{
    meetingId: 'meeting-a',
    chunkIndex: 0,
    speaker: '我',
    startMs: 0,
    endMs: 1000,
    text: '完整的新索引',
    tokenCount: 5,
  }], 'new-hash');

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE id = ?').get(oldMeetingAChunkId).count,
    0,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM vec_chunks_4 WHERE chunk_id = ?').get(oldMeetingAChunkId).count,
    0,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM embedding_queue WHERE meeting_id = ?').get('meeting-a').count,
    0,
  );
  assert.deepEqual(
    db.prepare(`
      SELECT cleaned_text, embedding
      FROM chunks
      WHERE meeting_id = ?
    `).get('meeting-a'),
    { cleaned_text: '完整的新索引', embedding: null },
  );
  assert.deepEqual(
    db.prepare(`
      SELECT rag_transcript_hash, rag_index_state
      FROM meetings
      WHERE id = ?
    `).get('meeting-a'),
    { rag_transcript_hash: 'new-hash', rag_index_state: 'complete' },
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE id = ?').get(meetingBChunkId).count,
    1,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM vec_chunks_4 WHERE chunk_id = ?').get(meetingBChunkId).count,
    1,
  );
  db.close();
});

test('atomic replacement rolls back every deletion when inserting a new chunk fails', async () => {
  const VectorStore = await loadVectorStore();
  const db = createIndexDatabase();
  const store = createVectorStore(VectorStore, db);
  const oldChunk = db.prepare(
    'SELECT id, cleaned_text FROM chunks WHERE meeting_id = ?',
  ).get('meeting-a');
  db.exec(`
    CREATE TRIGGER reject_forced_chunk
    BEFORE INSERT ON chunks
    WHEN NEW.cleaned_text = 'FAIL'
    BEGIN
      SELECT RAISE(ABORT, 'forced chunk failure');
    END;
  `);

  assert.throws(
    () => store.replaceMeetingChunksAtomically('meeting-a', [{
      meetingId: 'meeting-a',
      chunkIndex: 0,
      speaker: '我',
      startMs: 0,
      endMs: 1000,
      text: 'FAIL',
      tokenCount: 1,
    }], 'new-hash'),
    /forced chunk failure/,
  );

  assert.deepEqual(
    db.prepare('SELECT id, cleaned_text FROM chunks WHERE meeting_id = ?').get('meeting-a'),
    oldChunk,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM vec_chunks_4 WHERE chunk_id = ?').get(oldChunk.id).count,
    1,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM embedding_queue WHERE meeting_id = ?').get('meeting-a').count,
    1,
  );
  assert.deepEqual(
    db.prepare(`
      SELECT rag_transcript_hash, rag_index_state
      FROM meetings
      WHERE id = ?
    `).get('meeting-a'),
    { rag_transcript_hash: 'old-hash', rag_index_state: 'complete' },
  );
  db.close();
});
