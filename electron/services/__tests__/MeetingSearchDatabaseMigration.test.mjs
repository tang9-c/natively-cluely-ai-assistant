import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/db/DatabaseManager.js'),
).href;
const { DatabaseManager } = await import(databaseModuleUrl);

function createV30Database({ includeConflictingStateColumn = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      summary_json TEXT
      ${includeConflictingStateColumn
        ? ", rag_index_state TEXT NOT NULL DEFAULT 'missing'"
        : ''}
    );

    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      content TEXT,
      timestamp_ms INTEGER,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      cleaned_text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );

    INSERT INTO meetings (id, title, summary_json)
    VALUES ('meeting-a', '采购讨论', '{}');

    INSERT INTO transcripts (meeting_id, content, timestamp_ms)
    VALUES ('meeting-a', '预算为 700 万', 1000);

    INSERT INTO chunks (meeting_id, chunk_index, cleaned_text, token_count)
    VALUES ('meeting-a', 0, '旧索引内容', 4);
  `);
  db.pragma('user_version = 30');
  return db;
}

function migrate(db) {
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.runMigrations();
}

test('v30 -> v31 adds strict meeting index state without changing existing data', () => {
  const db = createV30Database();

  migrate(db);

  assert.equal(db.pragma('user_version', { simple: true }), 34);
  assert.deepEqual(
    db.prepare(`
      SELECT rag_transcript_hash, rag_index_state
      FROM meetings
      WHERE id = ?
    `).get('meeting-a'),
    { rag_transcript_hash: null, rag_index_state: 'missing' },
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM meetings').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transcripts').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
  db.close();
});

test('v31 migration rolls back the first column when the second ALTER TABLE fails', () => {
  const db = createV30Database({ includeConflictingStateColumn: true });

  assert.throws(() => migrate(db), /duplicate column name/i);

  assert.equal(db.pragma('user_version', { simple: true }), 30);
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM pragma_table_info('meetings')
      WHERE name = 'rag_transcript_hash'
    `).get().count,
    0,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
  db.close();
});
