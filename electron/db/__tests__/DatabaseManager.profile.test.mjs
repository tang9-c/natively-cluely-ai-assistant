// DatabaseManager.profile.test.mjs
// PR2.2: profile_persona / user_profile / resume_nodes / profile_jds / profile_master CRUD.
//
// Pattern: instantiate via Object.create(DatabaseManager.prototype) and inject
// a better-sqlite3 ':memory:' db. Schemas are copied verbatim from
// dist-electron/electron/db/DatabaseManager.js migrations so the methods that
// the manager exposes do not need any further setup.

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

function createProfileSchema(db) {
  db.exec(`
    CREATE TABLE profile_persona (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO profile_persona (id, content) VALUES (1, '');

    CREATE TABLE user_profile (
      id INTEGER PRIMARY KEY,
      structured_json TEXT NOT NULL,
      compact_persona TEXT NOT NULL,
      intro_short TEXT,
      intro_interview TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE resume_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      title TEXT,
      organization TEXT,
      start_date TEXT,
      end_date TEXT,
      duration_months INTEGER,
      text_content TEXT,
      tags TEXT,
      embedding BLOB
    );

    CREATE TABLE profile_jds (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      raw_text TEXT NOT NULL,
      parsed_json TEXT NOT NULL,
      file_hash TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE profile_master (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT,
      headline TEXT,
      summary TEXT NOT NULL DEFAULT '',
      contact_info_json TEXT NOT NULL DEFAULT '{}',
      experience_json TEXT NOT NULL DEFAULT '[]',
      skills_json TEXT NOT NULL DEFAULT '[]',
      projects_json TEXT NOT NULL DEFAULT '[]',
      education_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO profile_master (id, summary) VALUES (1, '');
  `);
}

describe('DatabaseManager — profile_persona', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createProfileSchema(db);
  });

  it('getPersona returns empty string when content is the default empty row', () => {
    assert.equal(manager.getPersona(), '');
  });

  it('savePersona then getPersona round-trips content', () => {
    manager.savePersona('Persona text A');
    assert.equal(manager.getPersona(), 'Persona text A');
  });

  it('savePersona upserts (does not duplicate) on the singleton row', () => {
    manager.savePersona('first');
    manager.savePersona('second');
    const count = db.prepare('SELECT COUNT(*) AS c FROM profile_persona').get().c;
    assert.equal(count, 1, 'profile_persona must remain a singleton row');
    assert.equal(manager.getPersona(), 'second');
  });

  it('clearProfilePersona empties the content but keeps the row', () => {
    manager.savePersona('about to clear');
    manager.clearProfilePersona();
    assert.equal(manager.getPersona(), '');
    const count = db.prepare('SELECT COUNT(*) AS c FROM profile_persona').get().c;
    assert.equal(count, 1);
  });
});

describe('DatabaseManager — user_profile', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createProfileSchema(db);
  });

  it('getUserProfile returns undefined when no row exists', () => {
    // The implementation returns the raw better-sqlite3 .get() result which
    // is undefined for missing rows. Callers must null-check.
    assert.equal(manager.getUserProfile(), undefined);
  });

  it('saveUserProfile then getUserProfile round-trips structured_json', () => {
    const payload = JSON.stringify({ name: 'Alex', skills: ['TypeScript'] });
    manager.saveUserProfile(payload);
    const row = manager.getUserProfile();
    assert.ok(row, 'expected a row to be returned');
    assert.equal(row.structured_json, payload);
  });

  it('saveUserProfile upserts on id=1', () => {
    manager.saveUserProfile(JSON.stringify({ v: 1 }));
    manager.saveUserProfile(JSON.stringify({ v: 2 }));
    const count = db.prepare('SELECT COUNT(*) AS c FROM user_profile').get().c;
    assert.equal(count, 1, 'user_profile must remain a singleton row');
    const row = manager.getUserProfile();
    assert.equal(row.structured_json, JSON.stringify({ v: 2 }));
  });

  it('clearUserProfile removes the row', () => {
    manager.saveUserProfile(JSON.stringify({ keep: false }));
    manager.clearUserProfile();
    assert.equal(manager.getUserProfile(), undefined);
  });
});

describe('DatabaseManager — resume_nodes', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createProfileSchema(db);
  });

  it('getResumeNodes returns [] when no nodes exist', () => {
    assert.deepEqual(manager.getResumeNodes(), []);
    assert.deepEqual(manager.getResumeNodes('experience'), []);
  });

  it('upsertResumeNodes + getResumeNodes round-trip multiple nodes', () => {
    manager.upsertResumeNodes([
      {
        category: 'experience',
        title: 'Senior Engineer',
        organization: 'Acme',
        startDate: '2020-01',
        endDate: '2024-01',
        durationMonths: 48,
        textContent: 'Did things.',
        tags: 'ts,sql',
      },
      {
        category: 'education',
        title: 'BS CS',
        organization: 'University X',
        startDate: '2014-09',
        endDate: '2018-06',
        durationMonths: 45,
        textContent: 'Studied.',
        tags: 'cs',
      },
    ]);

    const all = manager.getResumeNodes();
    assert.equal(all.length, 2);

    const exp = manager.getResumeNodes('experience');
    assert.equal(exp.length, 1);
    assert.equal(exp[0].title, 'Senior Engineer');
    assert.equal(exp[0].organization, 'Acme');
  });

  it('upsertResumeNodes is a no-op for an empty array', () => {
    manager.upsertResumeNodes([]);
    assert.deepEqual(manager.getResumeNodes(), []);
  });

  it('clearResumeNodes removes every node', () => {
    manager.upsertResumeNodes([
      { category: 'experience', title: 'A' },
      { category: 'experience', title: 'B' },
    ]);
    manager.clearResumeNodes();
    assert.deepEqual(manager.getResumeNodes(), []);
  });
});

describe('DatabaseManager — profile_jds (active JD)', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createProfileSchema(db);
  });

  it('getActiveJD returns undefined when no JD is stored', () => {
    // raw better-sqlite3 .get() result is undefined when no row matches.
    assert.equal(manager.getActiveJD(), undefined);
  });

  it('saveActiveJD then getActiveJD round-trips raw + parsed + file hash', () => {
    manager.saveActiveJD('Raw JD text', JSON.stringify({ role: 'SWE' }), 'hash-123');
    const row = manager.getActiveJD();
    assert.ok(row);
    assert.equal(row.raw_text, 'Raw JD text');
    assert.equal(row.parsed_json, JSON.stringify({ role: 'SWE' }));
    assert.equal(row.file_hash, 'hash-123');
  });

  it('saveActiveJD without fileHash stores null and upserts', () => {
    manager.saveActiveJD('raw 1', JSON.stringify({ role: 'A' }));
    manager.saveActiveJD('raw 2', JSON.stringify({ role: 'B' }));
    const count = db.prepare('SELECT COUNT(*) AS c FROM profile_jds').get().c;
    assert.equal(count, 1, 'profile_jds must remain a singleton row');
    const row = manager.getActiveJD();
    assert.equal(row.raw_text, 'raw 2');
    assert.equal(row.file_hash, null);
  });

  it('clearActiveJD removes the row', () => {
    manager.saveActiveJD('raw', JSON.stringify({ role: 'X' }), 'h');
    manager.clearActiveJD();
    assert.equal(manager.getActiveJD(), undefined);
  });
});

describe('DatabaseManager — profile_master', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createProfileSchema(db);
  });

  it('getProfileMaster returns the seeded row by default', () => {
    const row = manager.getProfileMaster();
    assert.ok(row);
    assert.equal(row.id, 1);
    assert.equal(row.summary, '');
  });

  it('updateProfileMaster upserts every field', () => {
    manager.updateProfileMaster({
      displayName: 'Alex Doe',
      headline: 'Staff SWE',
      summary: 'Six years building AI tooling.',
      contactInfoJson: JSON.stringify({ email: 'a@b.c' }),
      experienceJson: JSON.stringify([{ company: 'Acme' }]),
      skillsJson: JSON.stringify(['TypeScript', 'Rust']),
      projectsJson: JSON.stringify([{ name: 'Migration project' }]),
      educationJson: JSON.stringify([{ institution: 'SJTU' }]),
    });
    const row = manager.getProfileMaster();
    assert.equal(row.display_name, 'Alex Doe');
    assert.equal(row.headline, 'Staff SWE');
    assert.equal(row.summary, 'Six years building AI tooling.');
    assert.equal(JSON.parse(row.contact_info_json).email, 'a@b.c');
    assert.equal(JSON.parse(row.experience_json)[0].company, 'Acme');
    assert.deepEqual(JSON.parse(row.skills_json), ['TypeScript', 'Rust']);
    assert.equal(JSON.parse(row.projects_json)[0].name, 'Migration project');
    assert.equal(JSON.parse(row.education_json)[0].institution, 'SJTU');
  });

  it('updateProfileMaster preserves only the fields it received (defaults for missing)', () => {
    manager.updateProfileMaster({ displayName: 'Alex' });
    const row = manager.getProfileMaster();
    assert.equal(row.display_name, 'Alex');
    assert.equal(row.headline, null);
    assert.equal(row.summary, '');
    assert.equal(row.contact_info_json, '{}');
    assert.equal(row.experience_json, '[]');
    assert.equal(row.skills_json, '[]');
    assert.equal(row.projects_json, '[]');
    assert.equal(row.education_json, '[]');
  });
});
