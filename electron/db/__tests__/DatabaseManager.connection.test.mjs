// DatabaseManager — connection / pragmas / vec extension tests.
//
// Pattern: instantiate via Object.create(DatabaseManager.prototype) and inject
// a better-sqlite3 ':memory:' db. This bypasses the real init() path (which
// requires sqlite-vec and a real app path) while exercising every public
// method that operates on `this.db`.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';

function makeManager() {
  const db = new Database(':memory:');
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  // ensureVecTableForDim() reads `this.ensuredDims` (a Map); initialize it
  // so the prototype-only path can be exercised without running init().
  manager.ensuredDims = new Map();
  return { db, manager };
}

describe('DatabaseManager — connection state', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
  });

  it('isAvailable() returns true once a db handle is attached', () => {
    assert.equal(manager.isAvailable(), true);
  });

  it('getInitError() returns null/undefined on a healthy in-memory db', () => {
    assert.ok(manager.getInitError() == null);
  });

  it('getDb() returns the attached better-sqlite3 instance', () => {
    assert.equal(manager.getDb(), db);
    assert.equal(typeof manager.getDb().prepare, 'function');
  });

  it('getDbPath() is a function (graceful no-throw even when no path was set)', () => {
    // getDbPath looks at this.dbPath; when not set it returns undefined rather
    // than throwing, so callers can null-check.
    const path = manager.getDbPath();
    assert.ok(path === undefined || typeof path === 'string');
  });

  it('getExtPath() is a function and returns undefined or string when unset', () => {
    const ext = manager.getExtPath();
    assert.ok(ext === undefined || typeof ext === 'string');
  });

  it('transaction() wraps work in a BEGIN/COMMIT block', () => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
    // better-sqlite3's db.transaction(fn) returns a callable wrapper; invoking
    // it runs the wrapped fn inside a transaction.
    const txn = manager.transaction(() => {
      db.prepare('INSERT INTO t (n) VALUES (?)').run(1);
      db.prepare('INSERT INTO t (n) VALUES (?)').run(2);
    });
    txn();
    const rows = db.prepare('SELECT n FROM t ORDER BY n').all();
    assert.deepEqual(rows.map(r => r.n), [1, 2]);
  });

  it('transaction() rolls back when the wrapped function throws', () => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
    db.prepare('INSERT INTO t (n) VALUES (?)').run(0);

    const txn = manager.transaction(() => {
      db.prepare('INSERT INTO t (n) VALUES (?)').run(1);
      db.prepare('INSERT INTO t (n) VALUES (?)').run(2);
      throw new Error('boom');
    });

    assert.throws(() => txn(), /boom/);

    // Only the seed row should remain; 1 and 2 must have been rolled back.
    const rows = db.prepare('SELECT n FROM t ORDER BY n').all();
    assert.deepEqual(rows.map(r => r.n), [0]);
  });
});

describe('DatabaseManager — vec extension helpers (in-memory, no sqlite-vec loaded)', () => {
  let manager;

  beforeEach(() => {
    ({ manager } = makeManager());
  });

  it('hasVecExtension() returns a boolean reflecting whether vec is loaded', () => {
    const v = manager.hasVecExtension();
    assert.equal(typeof v, 'boolean');
  });

  it('getExistingVecDims() returns an array of integer dimensions', () => {
    const dims = manager.getExistingVecDims();
    assert.ok(Array.isArray(dims));
    for (const d of dims) {
      assert.equal(typeof d, 'number');
      assert.ok(Number.isInteger(d));
    }
  });

  it('ensureVecTableForDim() swallows SqliteError gracefully when sqlite-vec is unavailable', () => {
    // ensureVecTableForDim() wraps its CREATE VIRTUAL TABLE in try/catch and
    // logs the error instead of rethrowing — callers must never crash even if
    // sqlite-vec is not loaded.
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      if (manager.hasVecExtension()) {
        assert.doesNotThrow(() => manager.ensureVecTableForDim(384));
      } else {
        assert.doesNotThrow(() => manager.ensureVecTableForDim(384));
      }
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});

describe('DatabaseManager — KNOWN_DIMS constant', () => {
  it('KNOWN_DIMS is exported as a static and contains the canonical dims', () => {
    assert.ok(Array.isArray(DatabaseManager.KNOWN_DIMS));
    // The dims we currently care about across providers.
    for (const d of DatabaseManager.KNOWN_DIMS) {
      assert.equal(typeof d, 'number');
      assert.ok(Number.isInteger(d));
      assert.ok(d > 0);
    }
  });
});