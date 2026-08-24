// DatabaseManager.meeting.test.mjs
// PR2.2: meetings / transcripts / ai_interactions / embedding_queue CRUD.

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

function createMeetingSchema(db) {
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
      is_processed INTEGER DEFAULT 1,
      embedding_provider TEXT,
      embedding_dimensions INTEGER,
      embedding_space TEXT
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
      speaker_identity_correction_json TEXT,
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
      speaker TEXT,
      start_timestamp_ms INTEGER,
      end_timestamp_ms INTEGER,
      cleaned_text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE chunk_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL UNIQUE,
      summary_text TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      chunk_id INTEGER,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );
  `);
}

function seedSampleMeeting(db) {
  db.exec(`
    INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed)
    VALUES ('meet_1', 'Sprint Review', 1700000000000, 600000, JSON_OBJECT('legacySummary', 'old', 'detailedSummary', JSON_OBJECT('foo','bar')), '2025-01-01T09:00:00Z', 'manual', 1);
    INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms, start_timestamp_ms, end_timestamp_ms)
    VALUES
      ('meet_1', 'A', 'Hello.', 1000, 1000, 2000),
      ('meet_1', 'B', 'Hi there.', 3000, 3000, 4000);
    INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response)
    VALUES ('meet_1', 'what_to_say', 5000, '?', 'Answer');
  `);
}

describe('DatabaseManager — saveMeeting / getMeetingDetails', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createMeetingSchema(db);
  });

  it('saveMeeting persists a meeting without transcript or usage', () => {
    manager.saveMeeting(
      { id: 'm1', title: 'Sync', summary: 'S', date: '2025-01-02T10:00:00Z' },
      1700000000000,
      120000
    );
    const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get('m1');
    assert.ok(row);
    assert.equal(row.title, 'Sync');
    assert.equal(row.start_time, 1700000000000);
    assert.equal(row.duration_ms, 120000);
  });

  it('saveMeeting with transcript writes transcript rows', () => {
    manager.saveMeeting(
      {
        id: 'm2',
        title: 't',
        date: '2025-01-02T10:00:00Z',
        transcript: [
          { speaker: 'X', text: 'Line 1', timestamp: 100, startTimestampMs: 100, endTimestampMs: 200 },
          { speaker: 'Y', text: 'Line 2', timestamp: 300, startTimestampMs: 300, endTimestampMs: 400 },
        ],
      },
      1700000000000,
      120000
    );
    const count = db.prepare('SELECT COUNT(*) AS c FROM transcripts WHERE meeting_id = ?').get('m2').c;
    assert.equal(count, 2);
  });

  it('saveMeeting preserves manual speaker identity correction metadata', () => {
    manager.saveMeeting(
      {
        id: 'm-speaker-correction',
        title: 'speaker correction',
        date: '2025-01-02T10:00:00Z',
        transcript: [{
          speaker: 'user',
          text: 'Customer sentence from shared microphone.',
          timestamp: 100,
          speakerIdentityCorrection: {
            isMe: false,
            source: 'user',
            correctedAt: 200,
          },
        }],
      },
      1700000000000,
      120000
    );

    const details = manager.getMeetingDetails('m-speaker-correction');
    assert.deepEqual(details.transcript[0].speakerIdentityCorrection, {
      isMe: false,
      source: 'user',
      correctedAt: 200,
    });
  });

  it('saveMeeting with usage writes ai_interactions rows', () => {
    manager.saveMeeting(
      {
        id: 'm3',
        title: 't',
        date: '2025-01-02T10:00:00Z',
        usage: [
          { type: 'what_to_say', timestamp: 100, question: 'q1', answer: 'a1' },
          { type: 'followup_questions', timestamp: 200, question: 'q2', answer: ['a2a', 'a2b'] },
        ],
      },
      1700000000000,
      120000
    );
    const rows = db.prepare('SELECT * FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp').all('m3');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].user_query, 'q1');
    assert.equal(rows[1].type, 'followup_questions');
  });

  it('saveMeeting is idempotent (INSERT OR REPLACE) on the same id', () => {
    manager.saveMeeting({ id: 'mx', title: 'first', date: '2025-01-01T00:00:00Z' }, 1, 1);
    manager.saveMeeting({ id: 'mx', title: 'second', date: '2025-01-01T00:00:00Z' }, 1, 1);
    const count = db.prepare('SELECT COUNT(*) AS c FROM meetings WHERE id = ?').get('mx').c;
    assert.equal(count, 1);
    const row = db.prepare('SELECT title FROM meetings WHERE id = ?').get('mx');
    assert.equal(row.title, 'second');
  });

  it('getMeetingDetails returns summary + transcript + usage', () => {
    seedSampleMeeting(db);
    const details = manager.getMeetingDetails('meet_1');
    assert.ok(details);
    assert.equal(details.id, 'meet_1');
    assert.equal(details.title, 'Sprint Review');
    assert.equal(details.summary, 'old');
    assert.deepEqual(details.detailedSummary, { foo: 'bar' });
    assert.equal(details.transcript.length, 2);
    assert.equal(details.transcript[0].speaker, 'A');
    assert.equal(details.transcript[0].text, 'Hello.');
    assert.equal(details.usage.length, 1);
    assert.equal(details.usage[0].type, 'what_to_say');
  });

  it('getMeetingDetails returns null for an unknown id', () => {
    assert.equal(manager.getMeetingDetails('nope'), null);
  });
});

describe('DatabaseManager — speaker identity correction migration', () => {
  for (const startingVersion of [32, 33]) {
    it(`adds the correction column when upgrading from schema version ${startingVersion}`, () => {
      const { db, manager } = makeManager();
      db.exec(`
        CREATE TABLE transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT);
        CREATE TABLE speaker_profile_stats (profile_id TEXT PRIMARY KEY);
      `);
      db.pragma(`user_version = ${startingVersion}`);

      manager.runMigrations();

      const columns = db.prepare('PRAGMA table_info(transcripts)').all().map(row => row.name);
      assert.ok(columns.includes('speaker_identity_correction_json'));
      assert.equal(db.pragma('user_version', { simple: true }), 35);
    });
  }
});

describe('DatabaseManager — updateMeetingTitle / updateMeetingSummary', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createMeetingSchema(db);
    seedSampleMeeting(db);
  });

  it('updateMeetingTitle returns true and persists the new title', () => {
    const ok = manager.updateMeetingTitle('meet_1', 'New title');
    assert.equal(ok, true);
    const row = db.prepare('SELECT title FROM meetings WHERE id = ?').get('meet_1');
    assert.equal(row.title, 'New title');
  });

  it('updateMeetingTitle returns false for an unknown meeting', () => {
    const ok = manager.updateMeetingTitle('missing', 'whatever');
    assert.equal(ok, false);
  });

  it('updateMeetingSummary merges the patch into detailedSummary', () => {
    const ok = manager.updateMeetingSummary('meet_1', { keyPoints: ['a', 'b'] });
    assert.equal(ok, true);
    const row = db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get('meet_1');
    const parsed = JSON.parse(row.summary_json);
    assert.deepEqual(parsed.detailedSummary, { foo: 'bar', keyPoints: ['a', 'b'] });
  });

  it('updateMeetingSummary returns false for an unknown meeting', () => {
    const ok = manager.updateMeetingSummary('missing', { x: 1 });
    assert.equal(ok, false);
  });
});

describe('DatabaseManager — getRecentMeetings / getUnprocessedMeetings / deleteMeeting', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createMeetingSchema(db);
  });

  it('getRecentMeetings returns meetings ordered by created_at desc', () => {
    db.exec(`
      INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, is_processed)
      VALUES
        ('m1', 'A', 1, 60000, '{}', '2025-01-01T00:00:00Z', 1),
        ('m2', 'B', 2, 60000, '{}', '2025-01-02T00:00:00Z', 1),
        ('m3', 'C', 3, 60000, '{}', '2025-01-03T00:00:00Z', 0);
    `);
    const rows = manager.getRecentMeetings(10);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, 'm3');
    assert.equal(rows[1].id, 'm2');
    assert.equal(rows[2].id, 'm1');
  });

  it('getRecentMeetings formats duration as m:ss', () => {
    db.exec(`INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, is_processed)
             VALUES ('m_dur', 'X', 1, 125000, '{}', '2025-01-01T00:00:00Z', 1);`);
    const rows = manager.getRecentMeetings(10);
    assert.equal(rows[0].duration, '2:05');
  });

  it('getRecentMeetings respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, is_processed)
                  VALUES (?, ?, ?, 60000, '{}', ?, 1)`).run(`m${i}`, `M${i}`, i, `2025-01-0${i + 1}T00:00:00Z`);
    }
    const rows = manager.getRecentMeetings(2);
    assert.equal(rows.length, 2);
  });

  it('getUnprocessedMeetings returns only is_processed = 0 rows', () => {
    db.exec(`
      INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, is_processed)
      VALUES
        ('a', 'A', 1, 60000, '{}', '2025-01-01T00:00:00Z', 1),
        ('b', 'B', 2, 60000, '{}', '2025-01-02T00:00:00Z', 0);
    `);
    const rows = manager.getUnprocessedMeetings();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'b');
    assert.equal(rows[0].isProcessed, false);
  });

  it('deleteMeeting returns true and removes the row', () => {
    seedSampleMeeting(db);
    const ok = manager.deleteMeeting('meet_1');
    assert.equal(ok, true);
    const count = db.prepare('SELECT COUNT(*) AS c FROM meetings WHERE id = ?').get('meet_1').c;
    assert.equal(count, 0);
  });

  it('deleteMeeting returns false for an unknown id', () => {
    const ok = manager.deleteMeeting('nope');
    assert.equal(ok, false);
  });
});

describe('DatabaseManager — clearAllData', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createMeetingSchema(db);
  });

  it('clearAllData returns true and wipes the canonical tables', () => {
    seedSampleMeeting(db);
    db.prepare('INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count) VALUES (?, ?, ?, ?)').run('meet_1', 0, 'text', 1);
    db.prepare('INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES (?, ?, ?)').run('meet_1', 1, 'pending');

    const ok = manager.clearAllData();
    assert.equal(ok, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM meetings').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM transcripts').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM ai_interactions').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM chunk_summaries').get().c, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM embedding_queue').get().c, 0);
  });
});
