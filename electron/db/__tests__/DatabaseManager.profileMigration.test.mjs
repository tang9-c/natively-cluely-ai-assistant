import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';

const legacyResume = {
  identity: {
    name: 'Alice Zhang',
    email: 'alice@example.com',
    phone: '+86-13800000000',
    location: 'Shanghai',
    linkedin: 'https://linkedin.example/alice',
  },
  summary: 'Manufacturing software leader',
  skills: ['PLM', 'TypeScript'],
  experience: [{
    title: 'Engineering Director',
    organization: 'Acme',
    start: '2020-01',
    end: 'Present',
    description: 'Led platform delivery',
  }],
  projects: [{ name: 'Factory AI', description: 'AI quality platform' }],
  education: [{ degree: 'MEng', institution: 'SJTU', year: '2015' }],
};

function makeLegacyDatabase(version = 18) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_profile (
      id INTEGER PRIMARY KEY,
      structured_json TEXT NOT NULL,
      compact_persona TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE profile_master (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT,
      headline TEXT,
      summary TEXT NOT NULL DEFAULT '',
      contact_info_json TEXT NOT NULL DEFAULT '{}',
      experience_json TEXT NOT NULL DEFAULT '[]',
      skills_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO profile_master (id, summary) VALUES (1, '');
  `);
  db.prepare('INSERT INTO user_profile (id, structured_json) VALUES (1, ?)')
    .run(JSON.stringify(legacyResume));
  db.pragma(`user_version = ${version}`);
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.ensuredDims = new Map();
  return { db, manager };
}

function tableExists(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

describe('DatabaseManager legacy profile migration', () => {
  test('migrates every ResumeParsed field from a real v18 schema before dropping legacy tables', () => {
    const { db, manager } = makeLegacyDatabase(18);

    manager.migrateLegacyProfileToMaster(19);

    const master = db.prepare('SELECT * FROM profile_master WHERE id = 1').get();
    assert.equal(master.display_name, legacyResume.identity.name);
    assert.equal(master.headline, legacyResume.experience[0].title);
    assert.equal(master.summary, legacyResume.summary);
    assert.deepEqual(JSON.parse(master.contact_info_json), {
      email: legacyResume.identity.email,
      phone: legacyResume.identity.phone,
      location: legacyResume.identity.location,
      linkedin: legacyResume.identity.linkedin,
    });
    assert.deepEqual(JSON.parse(master.experience_json), legacyResume.experience);
    assert.deepEqual(JSON.parse(master.skills_json), legacyResume.skills);
    assert.deepEqual(JSON.parse(master.projects_json), legacyResume.projects);
    assert.deepEqual(JSON.parse(master.education_json), legacyResume.education);
    assert.equal(tableExists(db, 'user_profile'), false);
    assert.equal(tableExists(db, 'resume_nodes'), false);
    assert.equal(db.pragma('user_version', { simple: true }), 19);
  });

  test('rolls back data, legacy table deletion, and user_version when the write fails', () => {
    const { db, manager } = makeLegacyDatabase(18);
    db.exec(`
      CREATE TRIGGER reject_profile_master_update
      BEFORE UPDATE ON profile_master
      BEGIN
        SELECT RAISE(ABORT, 'simulated profile migration write failure');
      END;
    `);

    assert.throws(
      () => manager.migrateLegacyProfileToMaster(19),
      /simulated profile migration write failure/,
    );

    assert.equal(tableExists(db, 'user_profile'), true);
    assert.equal(tableExists(db, 'resume_nodes'), true);
    assert.equal(db.pragma('user_version', { simple: true }), 18);
    assert.equal(
      db.prepare('SELECT structured_json FROM user_profile WHERE id = 1').get().structured_json,
      JSON.stringify(legacyResume),
    );
  });

  test('preserves existing master fields while filling fields that are still empty', () => {
    const { db, manager } = makeLegacyDatabase(18);
    db.prepare('UPDATE profile_master SET display_name = ?, summary = ? WHERE id = 1')
      .run('User edited name', 'User edited summary');

    manager.migrateLegacyProfileToMaster(19);

    const master = db.prepare('SELECT * FROM profile_master WHERE id = 1').get();
    assert.equal(master.display_name, 'User edited name');
    assert.equal(master.summary, 'User edited summary');
    assert.equal(master.headline, legacyResume.experience[0].title);
    assert.equal(JSON.parse(master.contact_info_json).email, legacyResume.identity.email);
    assert.deepEqual(JSON.parse(master.projects_json), legacyResume.projects);
  });

  test('v36 recovers a residual legacy profile left in an already-upgraded database', () => {
    const { db, manager } = makeLegacyDatabase(35);

    manager.migrateLegacyProfileToMaster(36);

    const master = db.prepare('SELECT * FROM profile_master WHERE id = 1').get();
    assert.equal(master.display_name, legacyResume.identity.name);
    assert.deepEqual(JSON.parse(master.projects_json), legacyResume.projects);
    assert.deepEqual(JSON.parse(master.education_json), legacyResume.education);
    assert.equal(tableExists(db, 'user_profile'), false);
    assert.equal(tableExists(db, 'resume_nodes'), false);
    assert.equal(db.pragma('user_version', { simple: true }), 36);
  });
});
