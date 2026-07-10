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
