import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';

describe('Profile Database schema and CRUD', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        structured_json TEXT NOT NULL,
        compact_persona TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE resume_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
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
    `);
  });

  it('saves and retrieves a resume', () => {
    const resume = { identity: { name: 'Alice' }, skills: ['TypeScript'], experience: [], projects: [], education: [] };
    db.prepare('INSERT INTO user_profile (id, structured_json, created_at) VALUES (1, ?, ?)').run(JSON.stringify(resume), Date.now());
    const row = db.prepare('SELECT structured_json FROM user_profile WHERE id = 1').get();
    assert.equal(JSON.parse(row.structured_json).identity.name, 'Alice');
  });

  it('upserts and retrieves resume nodes', () => {
    const insert = db.prepare(`
      INSERT INTO resume_nodes (category, title, organization, start_date, end_date, duration_months, text_content, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      insert.run('experience', 'Eng', 'Acme', '2020-01', '2023-01', 36, 'Built things', 'typescript');
      insert.run('project', 'P1', null, null, null, null, 'Side project', null);
    });
    tx();
    const rows = db.prepare('SELECT * FROM resume_nodes ORDER BY id ASC').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].category, 'experience');
    assert.equal(rows[1].category, 'project');
  });

  it('saves and retrieves a JD', () => {
    const jd = { title: 'Senior Eng', technologies: ['Node'] };
    db.prepare('INSERT INTO profile_jds (id, raw_text, parsed_json, created_at) VALUES (1, ?, ?, ?)').run('raw', JSON.stringify(jd), Date.now());
    const row = db.prepare('SELECT parsed_json FROM profile_jds WHERE id = 1').get();
    assert.equal(JSON.parse(row.parsed_json).title, 'Senior Eng');
  });

  it('enforces singleton JD row via ON CONFLICT UPDATE', () => {
    const jd1 = { title: 'First' };
    const jd2 = { title: 'Second' };
    db.prepare('INSERT INTO profile_jds (id, raw_text, parsed_json, created_at) VALUES (1, ?, ?, ?)').run('r1', JSON.stringify(jd1), 1);
    db.prepare('INSERT INTO profile_jds (id, raw_text, parsed_json, created_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET raw_text = excluded.raw_text, parsed_json = excluded.parsed_json, created_at = excluded.created_at').run('r2', JSON.stringify(jd2), 2);
    const rows = db.prepare('SELECT * FROM profile_jds').all();
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].parsed_json).title, 'Second');
  });
});
