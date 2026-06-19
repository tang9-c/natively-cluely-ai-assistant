// electron/services/research/__tests__/CompanyResearchEngine.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const enginePath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/CompanyResearchEngine.js',
);
const tavilyPath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/TavilySearchProvider.js',
);

function makeMockCache({ hit = null } = {}) {
  return {
    get: async (name) => hit && hit.name === name ? hit : null,
    put: async () => {},
  };
}

function makeMockSearch({ results = [], error = null } = {}) {
  return {
    search: async () => {
      if (error) throw error;
      return results;
    },
  };
}

function makeMockBuilder(dossier) {
  return { build: async () => dossier };
}

const baseDossier = {
  schemaVersion: '1.0', companyName: 'Apple', generatedAt: '', expiresAt: '',
  source: 'tavily',
  financials: { summary: '', details: [], confidence: 'high' },
  business: { summary: '', details: [], confidence: 'high' },
  strategy: { summary: '', details: [], confidence: 'high' },
  people: { summary: '', details: [], confidence: 'high' },
  infrastructure: { summary: '', details: [], confidence: 'high' },
  procurement: { summary: '', details: [], confidence: 'high' },
  sources: [],
};

describe('CompanyResearchEngine', () => {
  test('research() returns cached dossier when cache hit and not expired', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const cache = makeMockCache({
      hit: { name: 'Apple', dossier: baseDossier, isExpired: () => false },
    });
    const search = makeMockSearch();
    const builder = makeMockBuilder(baseDossier);
    const engine = new CompanyResearchEngine({ cache, search, builder });
    const stages = [];
    const r = await engine.research('Apple', {
      onProgress: (p) => stages.push(p.stage),
    });
    assert.equal(r.success, true);
    assert.equal(r.cached, true);
    assert.equal(r.dossier.companyName, 'Apple');
    assert.deepEqual(stages, ['cache-check', 'done']);
  });

  test('research() skips cache when forceRefresh=true', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const cache = makeMockCache({
      hit: { name: 'Apple', dossier: baseDossier, isExpired: () => false },
    });
    const search = makeMockSearch({ results: [{ title: 't', url: 'https://x', content: 'c' }] });
    const builder = makeMockBuilder(baseDossier);
    const engine = new CompanyResearchEngine({ cache, search, builder });
    const r = await engine.research('Apple', { forceRefresh: true });
    assert.equal(r.success, true);
    assert.equal(r.cached, false);
  });

  test('research() returns INVALID_INPUT for empty companyName', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(), search: makeMockSearch(), builder: makeMockBuilder(baseDossier),
    });
    const r = await engine.research('   ');
    assert.equal(r.success, false);
    assert.equal(r.errorCode, 'INVALID_INPUT');
  });

  test('research() returns INVALID_INPUT for >100 char name', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(), search: makeMockSearch(), builder: makeMockBuilder(baseDossier),
    });
    const r = await engine.research('a'.repeat(101));
    assert.equal(r.success, false);
    assert.equal(r.errorCode, 'INVALID_INPUT');
  });

  test('research() returns TAVILY_QUOTA_EXHAUSTED on TavilyQuotaError', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const { TavilyQuotaError } = cjsRequire(tavilyPath);
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(),
      search: makeMockSearch({ error: new TavilyQuotaError() }),
      builder: makeMockBuilder(baseDossier),
    });
    const r = await engine.research('Apple');
    assert.equal(r.success, false);
    assert.equal(r.searchQuotaExhausted, true);
    assert.equal(r.errorCode, 'TAVILY_QUOTA_EXHAUSTED');
  });

  test('research() returns TAVILY_INVALID_KEY on TavilyAuthError', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const { TavilyAuthError } = cjsRequire(tavilyPath);
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(),
      search: makeMockSearch({ error: new TavilyAuthError() }),
      builder: makeMockBuilder(baseDossier),
    });
    const r = await engine.research('Apple');
    assert.equal(r.success, false);
    assert.equal(r.errorCode, 'TAVILY_INVALID_KEY');
  });

  test('research() falls back to LLM when TavilyNetworkError', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const { TavilyNetworkError } = cjsRequire(tavilyPath);
    const fallbackDossier = { ...baseDossier, source: 'llm-fallback' };
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(),
      search: makeMockSearch({ error: new TavilyNetworkError('timeout') }),
      builder: makeMockBuilder(fallbackDossier),
    });
    const r = await engine.research('Apple');
    assert.equal(r.success, true);
    assert.equal(r.dossier.source, 'llm-fallback');
  });
});
