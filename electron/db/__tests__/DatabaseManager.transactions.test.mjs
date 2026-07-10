// DatabaseManager.transactions.test.mjs
// PR2.3: cross-table transactions, rollback safety, and the getCustomNotes
// profile helper (singleton table managed through INSERT ... ON CONFLICT).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';

function makeManager() {
  const db = new Database(':memory:');
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.ensuredDims = new Map();
  return { db, manager };
}

function createMultiTableSchema(db) {
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      start_time INTEGER,
      duration_ms INTEGER,
      summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      calendar_event_id TEXT,
      source TEXT,
      is_processed INTEGER DEFAULT 1
    );
    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      speaker TEXT,
      speaker_id TEXT,
      speaker_label TEXT,
      provider_speaker_id TEXT,
      diarization_provider TEXT,
      content TEXT,
      timestamp_ms INTEGER,
      start_timestamp_ms INTEGER,
      end_timestamp_ms INTEGER,
      speaker_verification_json TEXT,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE TABLE ai_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      type TEXT,
      timestamp INTEGER,
      user_query TEXT,
      ai_response TEXT,
      metadata_json TEXT,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      cleaned_text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding BLOB,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE TABLE chunk_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL UNIQUE,
      summary_text TEXT NOT NULL,
      embedding BLOB,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE TABLE embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      chunk_id INTEGER,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      processed_at TEXT
    );

    CREATE TABLE knowledge_materials (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      title TEXT,
      mime_or_ext TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      error_code TEXT,
      error_message TEXT,
      source_type TEXT NOT NULL DEFAULT 'upload',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE knowledge_material_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      parent_chunk_index INTEGER,
      cleaned_text TEXT NOT NULL,
      parent_text TEXT,
      token_count INTEGER NOT NULL,
      embedding BLOB,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(material_id, chunk_index),
      FOREIGN KEY(material_id) REFERENCES knowledge_materials(id) ON DELETE CASCADE
    );
    CREATE TABLE material_embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_chunk_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      FOREIGN KEY(material_chunk_id) REFERENCES knowledge_material_chunks(id) ON DELETE CASCADE
    );

    CREATE TABLE profile_custom_notes (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO profile_custom_notes (id, content) VALUES (1, '');
  `);
}

describe('DatabaseManager — transactional saveMeeting rollback safety', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createMultiTableSchema(db);
  });

  it('saveMeeting commits a meeting plus its transcript + usage together', () => {
    manager.saveMeeting(
      {
        id: 'm_tx',
        title: 'Tx',
        date: '2025-01-01T00:00:00Z',
        transcript: [{ speaker: 'A', text: 'a', timestamp: 100 }],
        usage: [{ type: 'what_to_say', timestamp: 200, question: 'q', answer: 'a' }],
      },
      1,
      1
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM meetings WHERE id = ?').get('m_tx').c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM transcripts WHERE meeting_id = ?').get('m_tx').c, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ai_interactions WHERE meeting_id = ?').get('m_tx').c, 1);
  });

  it('clearAllData rolls back when one of the DELETEs fails (wraps in transaction)', () => {
    // Seed a meeting and a chunk, then drop the meetings table out from under
    // the manager so the second DELETE inside the transaction throws.
    db.exec(`INSERT INTO meetings (id, title, summary_json) VALUES ('m1', 'X', '{}');`);
    db.exec(`INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count) VALUES ('m1', 0, 'a', 1);`);
    db.exec(`DROP TABLE meetings;`);

    const ok = manager.clearAllData();
    // The transaction must report failure when any DELETE throws.
    assert.equal(ok, false);
  });
});

describe('DatabaseManager — replaceKnowledgeMaterialChunks atomicity', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createMultiTableSchema(db);
    manager.upsertKnowledgeMaterial({
      id: 'mat_x',
      fileName: 'x',
      mimeOrExt: 'pdf',
      fileHash: 'h',
      status: 'indexing',
    });
  });

  it('replaces existing chunks and queue rows in a single transaction', () => {
    // Pre-existing chunks
    manager.replaceKnowledgeMaterialChunks('mat_x', [
      { chunkIndex: 0, cleanedText: 'old A', tokenCount: 1 },
      { chunkIndex: 1, cleanedText: 'old B', tokenCount: 1 },
    ]);
    const idsBefore = db.prepare('SELECT id FROM knowledge_material_chunks WHERE material_id = ?').all('mat_x').map(r => r.id);
    assert.equal(idsBefore.length, 2);
    const queueBefore = db.prepare('SELECT COUNT(*) AS c FROM material_embedding_queue').get().c;
    assert.equal(queueBefore, 2);

    manager.replaceKnowledgeMaterialChunks('mat_x', [
      { chunkIndex: 0, cleanedText: 'new A', tokenCount: 1 },
    ]);

    const chunks = db.prepare('SELECT * FROM knowledge_material_chunks WHERE material_id = ? ORDER BY chunk_index').all('mat_x');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].cleaned_text, 'new A');
    // Old queue rows were also wiped before the new insert.
    const queueAfter = db.prepare('SELECT COUNT(*) AS c FROM material_embedding_queue').get().c;
    assert.equal(queueAfter, 1);
  });

  it('deleteKnowledgeMaterial removes chunks and queue rows atomically', () => {
    manager.replaceKnowledgeMaterialChunks('mat_x', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
    ]);
    manager.deleteKnowledgeMaterial('mat_x');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM knowledge_material_chunks').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM material_embedding_queue').get().c, 0);
  });
});

describe('DatabaseManager — getCustomNotes / saveCustomNotes', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createMultiTableSchema(db);
  });

  it('getCustomNotes returns the empty string for a fresh row', () => {
    assert.equal(manager.getCustomNotes(), '');
  });

  it('saveCustomNotes round-trips content', () => {
    manager.saveCustomNotes('hi from tests');
    assert.equal(manager.getCustomNotes(), 'hi from tests');
  });

  it('saveCustomNotes upserts and stays a singleton row', () => {
    manager.saveCustomNotes('one');
    manager.saveCustomNotes('two');
    const count = db.prepare('SELECT COUNT(*) AS c FROM profile_custom_notes').get().c;
    assert.equal(count, 1);
    assert.equal(manager.getCustomNotes(), 'two');
  });
});

describe('DatabaseManager — error resilience', () => {
  it('all profile methods are safe when db is null', () => {
    const manager = Object.create(DatabaseManager.prototype);
    manager.db = null;
    manager.ensuredDims = new Map();
    // Should never throw.
    assert.doesNotThrow(() => manager.savePersona('x'));
    assert.doesNotThrow(() => manager.saveUserProfile('{}'));
    assert.doesNotThrow(() => manager.saveCustomNotes('x'));
    assert.doesNotThrow(() => manager.saveActiveJD('raw', '{}', 'h'));
    assert.doesNotThrow(() => manager.clearProfilePersona());
    assert.doesNotThrow(() => manager.clearUserProfile());
    assert.doesNotThrow(() => manager.clearActiveJD());
    assert.doesNotThrow(() => manager.upsertResumeNodes([]));

    // Read methods return safe defaults.
    assert.equal(manager.getPersona(), '');
    assert.equal(manager.getUserProfile(), null);
    assert.equal(manager.getResumeNodes().length, 0);
    assert.equal(manager.getActiveJD(), null);
    assert.equal(manager.getProfileMaster(), null);
    assert.equal(manager.getModes().length, 0);
    assert.equal(manager.getActiveMode(), null);
    assert.equal(manager.getCustomNotes(), '');
  });

  it('getKnowledgeMaterial helpers return safe defaults when db is null', () => {
    const manager = Object.create(DatabaseManager.prototype);
    manager.db = null;
    manager.ensuredDims = new Map();
    assert.equal(manager.listKnowledgeMaterials().length, 0);
    assert.equal(manager.getKnowledgeMaterial('x'), null);
    assert.equal(manager.getKnowledgeMaterialChunks().length, 0);
    assert.equal(manager.getKnowledgeMaterialCandidateChunks('foo').length, 0);
    assert.equal(manager.getMaterialQueueStatus().pending, 0);
    assert.doesNotThrow(() => manager.upsertKnowledgeMaterial({ id: 'x', fileName: 'x', mimeOrExt: 'x', fileHash: 'x' }));
    assert.doesNotThrow(() => manager.deleteKnowledgeMaterial('x'));
    assert.equal(manager.upsertKnowledgeMaterial({ id: 'x', fileName: 'x', mimeOrExt: 'x', fileHash: 'x' }), null);
  });

  it('context-trace helpers return safe defaults when db is null', () => {
    const manager = Object.create(DatabaseManager.prototype);
    manager.db = null;
    manager.ensuredDims = new Map();
    assert.equal(manager.getAnswerContextTrace('x'), null);
    assert.equal(manager.saveAnswerContextTrace({ answerId: 'x' }), null);
    const r = manager.trackAnswerQualityEvent({ answerId: 'x', eventType: 'shown' });
    assert.equal(r.success, false);
    assert.equal(r.error, 'database_unavailable');
    const m = manager.getAnswerQualityMetrics({});
    assert.equal(m.shownCount, 0);
    const agg = manager.getRealtimeDiagnosticsAggregate({});
    assert.equal(agg.metrics.shownCount, 0);
    assert.equal(agg.traceSampleSize, 0);
  });
});
