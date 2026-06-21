// electron/services/research/__tests__/CompanyResearchCache.test.mjs
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const cachePath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/CompanyResearchCache.js',
);

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE company_research_cache (
      company_name TEXT PRIMARY KEY,
      company_name_display TEXT NOT NULL,
      dossier_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      source TEXT NOT NULL,
      schema_version TEXT NOT NULL
    );
  `);
  return db;
}

describe('CompanyResearchCache', () => {
  let db, cache;
  beforeEach(() => {
    db = freshDb();
    const { CompanyResearchCache } = cjsRequire(cachePath);
    cache = new CompanyResearchCache({ db });
  });
  afterEach(() => db.close());

  test('get() returns null when no row', async () => {
    const r = await cache.get('Apple');
    assert.equal(r, null);
  });

  test('put() then get() round-trips a dossier', async () => {
    const dossier = {
      schemaVersion: '1.0', companyName: 'Apple', generatedAt: '2026-06-19T00:00:00Z',
      // Use a far-future expiry so the assertion `isExpired() === false` is
      // not at the mercy of wall-clock time advancing past a hardcoded date.
      expiresAt: '2099-01-01T00:00:00Z', source: 'tavily',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    await cache.put('Apple', dossier);
    const r = await cache.get('Apple');
    assert.ok(r);
    assert.equal(r.dossier.companyName, 'Apple');
    assert.equal(r.isExpired(), false);
  });

  test('get() is case-insensitive on company name', async () => {
    const dossier = { schemaVersion: '1.0', companyName: 'Apple', generatedAt: '',
      expiresAt: '2099-01-01T00:00:00Z', source: 'tavily',
      financials: {}, business: {}, strategy: {}, people: {},
      infrastructure: {}, procurement: {}, sources: [] };
    await cache.put('APPLE', dossier);
    const r = await cache.get('apple');
    assert.ok(r);
  });

  test('get() returns null when schema_version mismatches', async () => {
    db.prepare(`INSERT INTO company_research_cache VALUES (?,?,?,?,?,?,?)`).run(
      'apple', 'Apple', '{}', '', '2099-01-01T00:00:00Z', 'tavily', '0.9',
    );
    const r = await cache.get('Apple');
    assert.equal(r, null);
  });

  test('isExpired() returns true when expires_at is in the past', async () => {
    const dossier = { schemaVersion: '1.0', companyName: 'Apple', generatedAt: '',
      expiresAt: '2000-01-01T00:00:00Z', source: 'tavily',
      financials: {}, business: {}, strategy: {}, people: {},
      infrastructure: {}, procurement: {}, sources: [] };
    await cache.put('Apple', dossier);
    const r = await cache.get('Apple');
    assert.ok(r);
    assert.equal(r.isExpired(), true);
  });

  test('prune() deletes only expired rows', async () => {
    const old = { schemaVersion: '1.0', companyName: 'Old', generatedAt: '',
      expiresAt: '2000-01-01T00:00:00Z', source: 'tavily',
      financials: {}, business: {}, strategy: {}, people: {},
      infrastructure: {}, procurement: {}, sources: [] };
    const fresh = { ...old, companyName: 'Fresh', expiresAt: '2099-01-01T00:00:00Z' };
    await cache.put('Old', old);
    await cache.put('Fresh', fresh);
    const deleted = await cache.prune();
    assert.equal(deleted, 1);
    const row = db.prepare('SELECT count(*) as c FROM company_research_cache').get();
    assert.equal(row.c, 1);
  });

  test('clearAll() removes all rows', async () => {
    const dossier = { schemaVersion: '1.0', companyName: 'X', generatedAt: '',
      expiresAt: '2099-01-01T00:00:00Z', source: 'tavily',
      financials: {}, business: {}, strategy: {}, people: {},
      infrastructure: {}, procurement: {}, sources: [] };
    await cache.put('A', dossier);
    await cache.put('B', { ...dossier, companyName: 'B' });
    const deleted = await cache.clearAll();
    assert.equal(deleted, 2);
  });
});
