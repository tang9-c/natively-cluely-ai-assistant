// electron/services/research/__tests__/CompanyResearchFlow.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const enginePath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/CompanyResearchEngine.js',
);
const cachePath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/CompanyResearchCache.js',
);
const builderPath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/ResearchDossierBuilder.js',
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

const baseDossier = (source = 'tavily') => ({
  schemaVersion: '1.0', companyName: 'Apple', generatedAt: '2026-06-19T00:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z', source,
  financials: { summary: '', details: [], confidence: 'high' },
  business: { summary: '', details: [], confidence: 'high' },
  strategy: { summary: '', details: [], confidence: 'high' },
  people: { summary: '', details: [], confidence: 'high' },
  infrastructure: { summary: '', details: [], confidence: 'high' },
  procurement: { summary: '', details: [], confidence: 'high' },
  // Non-empty sources — the source-label guard in ResearchDossierBuilder
  // (a69f590 "tie source label to sources count") downgrades to 'llm-fallback'
  // when the LLM echoes back an empty sources array. Mocking the LLM as if it
  // echoed the Tavily hit keeps source='tavily' end-to-end, matching the test
  // intent. See ResearchDossierBuilder.test.mjs:36-41 / :55-57 for the same
  // fixture pattern (non-empty sources paired with source='tavily' assertion).
  sources: [{ index: 1, title: 'Apple', url: 'https://apple.com', snippet: 'Tech co' }],
});

describe('CompanyResearchFlow — end-to-end', () => {
  test('cold start → cache miss → search → build → cache put → dossier returned', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const { CompanyResearchCache } = cjsRequire(cachePath);
    const { ResearchDossierBuilder } = cjsRequire(builderPath);

    const db = freshDb();
    const cache = new CompanyResearchCache({ db });
    const search = {
      search: async () => [{ title: 'Apple', url: 'https://apple.com', content: 'Tech co' }],
    };
    const builder = new ResearchDossierBuilder({
      llm: { generateStructured: async () => baseDossier('tavily') },
    });
    const engine = new CompanyResearchEngine({ cache, search, builder });

    const r = await engine.research('Apple');
    assert.equal(r.success, true);
    assert.equal(r.cached, false);
    assert.equal(r.dossier.companyName, 'Apple');
    assert.equal(r.dossier.source, 'tavily');
  });

  test('second call within 24h returns cached=true without search', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const { CompanyResearchCache } = cjsRequire(cachePath);
    const { ResearchDossierBuilder } = cjsRequire(builderPath);

    const db = freshDb();
    const cache = new CompanyResearchCache({ db });
    let searchCalls = 0;
    const search = {
      search: async () => { searchCalls++; return []; },
    };
    const builder = new ResearchDossierBuilder({
      llm: { generateStructured: async () => baseDossier('tavily') },
    });
    const engine = new CompanyResearchEngine({ cache, search, builder });

    await engine.research('Apple');
    const r = await engine.research('Apple');
    assert.equal(r.cached, true);
    assert.equal(searchCalls, 1);
  });

  test('forceRefresh=true bypasses cache', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const { CompanyResearchCache } = cjsRequire(cachePath);
    const { ResearchDossierBuilder } = cjsRequire(builderPath);

    const db = freshDb();
    const cache = new CompanyResearchCache({ db });
    const search = {
      search: async () => [{ title: 't', url: 'https://x', content: 'c' }],
    };
    const builder = new ResearchDossierBuilder({
      llm: { generateStructured: async () => baseDossier('tavily') },
    });
    const engine = new CompanyResearchEngine({ cache, search, builder });

    await engine.research('Apple');
    const r = await engine.research('Apple', { forceRefresh: true });
    assert.equal(r.cached, false);
  });
});
