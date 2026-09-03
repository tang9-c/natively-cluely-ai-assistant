// DatabaseManager.modes.test.mjs
// PR2.2: modes / mode_intent_keywords CRUD.

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

function createModeSchema(db) {
  db.exec(`
    CREATE TABLE modes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template_type TEXT NOT NULL DEFAULT 'general',
      custom_context TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE mode_intent_keywords (
      id TEXT PRIMARY KEY,
      mode_id TEXT NOT NULL,
      intent TEXT NOT NULL,
      keywords_csv TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(mode_id, intent),
      FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
    );

    CREATE TABLE mode_reference_files (
      id TEXT PRIMARY KEY,
      mode_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
    );

    CREATE TABLE mode_reference_file_metadata (
      reference_file_id TEXT PRIMARY KEY,
      scenario_type TEXT NOT NULL,
      doc_subtype TEXT NOT NULL,
      parsed_json TEXT,
      file_hash TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reference_file_id) REFERENCES mode_reference_files(id) ON DELETE CASCADE
    );

    CREATE TABLE mode_note_sections (
      id TEXT PRIMARY KEY,
      mode_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
    );
  `);
}

describe('DatabaseManager — getModes / createMode / setActiveMode / getActiveMode', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createModeSchema(db);
  });

  it('getModes returns [] when none exist', () => {
    assert.deepEqual(manager.getModes(), []);
  });

  it('createMode then getModes round-trips the new mode', () => {
    manager.createMode({ id: 'm_a', name: 'Sales', templateType: 'sales', customContext: '' });
    const rows = manager.getModes();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'm_a');
    assert.equal(rows[0].name, 'Sales');
    assert.equal(rows[0].template_type, 'sales');
    assert.equal(rows[0].is_active, 0);
  });

  it('createMode defaults new modes to is_active = 0', () => {
    manager.createMode({ id: 'm_b', name: 'B', templateType: 'general', customContext: '' });
    const row = db.prepare('SELECT is_active FROM modes WHERE id = ?').get('m_b');
    assert.equal(row.is_active, 0);
  });

  it('getActiveMode returns null when no mode is active', () => {
    assert.equal(manager.getActiveMode(), null);
  });

  it('setActiveMode marks the chosen mode as active and demotes the previous one', () => {
    manager.createMode({ id: 'a', name: 'A', templateType: 'general', customContext: '' });
    manager.createMode({ id: 'b', name: 'B', templateType: 'general', customContext: '' });
    // Force "a" active via raw SQL, since createMode is always inactive.
    db.prepare('UPDATE modes SET is_active = 1 WHERE id = ?').run('a');

    manager.setActiveMode('b');
    const a = db.prepare('SELECT is_active FROM modes WHERE id = ?').get('a');
    const b = db.prepare('SELECT is_active FROM modes WHERE id = ?').get('b');
    assert.equal(a.is_active, 0);
    assert.equal(b.is_active, 1);
    const active = manager.getActiveMode();
    assert.equal(active.id, 'b');
  });

  it('setActiveMode(null) clears the active mode', () => {
    manager.createMode({ id: 'a', name: 'A', templateType: 'general', customContext: '' });
    db.prepare('UPDATE modes SET is_active = 1 WHERE id = ?').run('a');
    manager.setActiveMode(null);
    const all = db.prepare('SELECT is_active FROM modes').all();
    assert.ok(all.every(r => r.is_active === 0));
    assert.equal(manager.getActiveMode(), null);
  });
});

describe('DatabaseManager — updateMode / deleteMode', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createModeSchema(db);
    manager.createMode({ id: 'm1', name: 'A', templateType: 'general', customContext: 'ctx' });
  });

  it('updateMode patches name only', () => {
    manager.updateMode('m1', { name: 'New' });
    const row = db.prepare('SELECT * FROM modes WHERE id = ?').get('m1');
    assert.equal(row.name, 'New');
    assert.equal(row.template_type, 'general');
    assert.equal(row.custom_context, 'ctx');
  });

  it('updateMode patches templateType only', () => {
    manager.updateMode('m1', { templateType: 'sales' });
    const row = db.prepare('SELECT * FROM modes WHERE id = ?').get('m1');
    assert.equal(row.template_type, 'sales');
    assert.equal(row.name, 'A');
  });

  it('updateMode patches customContext only', () => {
    manager.updateMode('m1', { customContext: 'new ctx' });
    const row = db.prepare('SELECT * FROM modes WHERE id = ?').get('m1');
    assert.equal(row.custom_context, 'new ctx');
  });

  it('updateMode is a no-op for an unknown id (no throw)', () => {
    assert.doesNotThrow(() => manager.updateMode('nope', { name: 'X' }));
  });

  it('deleteMode removes the row', () => {
    manager.deleteMode('m1');
    const row = db.prepare('SELECT * FROM modes WHERE id = ?').get('m1');
    assert.equal(row, undefined);
  });

  it('deleteMode is a no-op for an unknown id (no throw)', () => {
    assert.doesNotThrow(() => manager.deleteMode('nope'));
  });

  it('deleteMode explicitly removes all owned sensitive rows even with foreign keys disabled', () => {
    db.prepare('INSERT INTO mode_reference_files (id, mode_id, file_name, content) VALUES (?, ?, ?, ?)')
      .run('ref1', 'm1', 'private.txt', 'REFERENCE_SENTINEL');
    db.prepare('INSERT INTO mode_reference_file_metadata (reference_file_id, scenario_type, doc_subtype, parsed_json) VALUES (?, ?, ?, ?)')
      .run('ref1', 'sales', 'references', '{"secret":"METADATA_SENTINEL"}');
    db.prepare('INSERT INTO mode_note_sections (id, mode_id, title) VALUES (?, ?, ?)')
      .run('section1', 'm1', 'Private section');
    db.prepare('INSERT INTO mode_intent_keywords (id, mode_id, intent, keywords_csv) VALUES (?, ?, ?, ?)')
      .run('intent1', 'm1', 'custom', 'private');
    db.pragma('foreign_keys = OFF');

    const deleted = manager.deleteMode('m1');

    assert.deepEqual(deleted, {
      modes: 1,
      referenceFiles: 1,
      metadata: 1,
      noteSections: 1,
      intentKeywords: 1,
    });
    for (const table of ['modes', 'mode_reference_files', 'mode_reference_file_metadata', 'mode_note_sections', 'mode_intent_keywords']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
  });

  it('deleteMode propagates failure instead of reporting success', () => {
    db.exec(`
      CREATE TRIGGER reject_mode_delete BEFORE DELETE ON modes
      BEGIN SELECT RAISE(ABORT, 'simulated mode delete failure'); END;
    `);

    assert.throws(() => manager.deleteMode('m1'), /simulated mode delete failure/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM modes').get().count, 1);
  });
});

describe('DatabaseManager — deleteReferenceFile', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createModeSchema(db);
    manager.createMode({ id: 'm1', name: 'A', templateType: 'general', customContext: '' });
    db.prepare('INSERT INTO mode_reference_files (id, mode_id, file_name, content) VALUES (?, ?, ?, ?)')
      .run('ref1', 'm1', 'private.txt', 'REFERENCE_SENTINEL');
    db.prepare('INSERT INTO mode_reference_file_metadata (reference_file_id, scenario_type, doc_subtype, parsed_json) VALUES (?, ?, ?, ?)')
      .run('ref1', 'general', 'references', '{"secret":"METADATA_SENTINEL"}');
    db.pragma('foreign_keys = OFF');
  });

  it('explicitly deletes content and metadata with foreign keys disabled', () => {
    const deleted = manager.deleteReferenceFile('ref1');

    assert.deepEqual(deleted, { referenceFiles: 1, metadata: 1 });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mode_reference_files').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mode_reference_file_metadata').get().count, 0);
  });
});

describe('DatabaseManager — atomic reference file metadata writes', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createModeSchema(db);
    manager.createMode({ id: 'm1', name: 'Sales', templateType: 'sales', customContext: '' });
  });

  it('writes the reference file and metadata in one transaction', () => {
    manager.addReferenceFileWithMetadata(
      { id: 'ref1', modeId: 'm1', fileName: 'customer.md', content: 'Acme context' },
      {
        referenceFileId: 'ref1',
        scenarioType: 'sales',
        docSubtype: 'customer-profile',
        fileHash: 'hash-1',
      },
    );

    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mode_reference_files').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mode_reference_file_metadata').get().count, 1);
  });

  it('rolls back the reference file when metadata insertion fails', () => {
    db.exec(`
      CREATE TRIGGER reject_reference_metadata BEFORE INSERT ON mode_reference_file_metadata
      BEGIN SELECT RAISE(ABORT, 'simulated metadata failure'); END;
    `);

    assert.throws(
      () => manager.addReferenceFileWithMetadata(
        { id: 'ref1', modeId: 'm1', fileName: 'customer.md', content: 'Acme context' },
        {
          referenceFileId: 'ref1',
          scenarioType: 'sales',
          docSubtype: 'customer-profile',
          fileHash: 'hash-1',
        },
      ),
      /simulated metadata failure/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mode_reference_files').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mode_reference_file_metadata').get().count, 0);
  });
});

describe('DatabaseManager — mode_intent_keywords', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createModeSchema(db);
    manager.createMode({ id: 'm1', name: 'M', templateType: 'general', customContext: '' });
  });

  it('getIntentKeywords returns [] when no keywords exist', () => {
    assert.deepEqual(manager.getIntentKeywords('m1'), []);
  });

  it('upsertIntentKeywords inserts new rows and then replaces them on second call', () => {
    manager.upsertIntentKeywords('m1', [
      { intent: 'pricing', keywordsCsv: 'price,cost' },
      { intent: 'objection', keywordsCsv: 'no,not now' },
    ]);
    let rows = manager.getIntentKeywords('m1');
    assert.equal(rows.length, 2);

    manager.upsertIntentKeywords('m1', [
      { intent: 'pricing', keywordsCsv: 'price,budget' },
    ]);
    rows = manager.getIntentKeywords('m1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].intent, 'pricing');
    assert.equal(rows[0].keywords_csv, 'price,budget');
  });

  it('resetIntentKeywords restores template defaults for general', () => {
    manager.upsertIntentKeywords('m1', [
      { intent: 'custom', keywordsCsv: 'a,b' },
    ]);
    manager.resetIntentKeywords('m1', 'general');
    const rows = manager.getIntentKeywords('m1');
    // general defaults have multiple intents; just assert the custom one is gone.
    assert.ok(rows.every(r => r.intent !== 'custom'));
    assert.ok(rows.length > 0);
  });
});
