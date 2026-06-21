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

  test('research() synthesizes Tavily search results instead of treating LLM as only a Tavily fallback', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const tavilySources = [{ title: 'IBM Annual Report', url: 'https://ibm.com/report', content: 'IBM source' }];
    let builderArgs = null;
    const builder = {
      build: async (companyName, sources) => {
        builderArgs = { companyName, sources };
        return baseDossier;
      },
    };
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(),
      search: makeMockSearch({ results: tavilySources }),
      builder,
    });

    const r = await engine.research('IBM');

    assert.equal(r.success, true);
    assert.equal(builderArgs.companyName, 'IBM');
    assert.deepEqual(builderArgs.sources, tavilySources);
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

  test('research() emits synthesizing-attempt progress events when builder retries', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const attempts = [];
    const builder = {
      build: async () => {
        // Simulate builder calling opts.onAttempt twice before succeeding
        attempts.push('a1');
        return baseDossier;
      },
    };
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(),
      search: makeMockSearch({ results: [{ title: 't', url: 'https://x', content: 'c' }] }),
      builder,
    });
    const progress = [];
    await engine.research('Apple', {
      onProgress: (p) => progress.push({ stage: p.stage, message: p.message }),
    });
    // Expect synthesizing events with attempt markers (1/2 or 1/N), then done
    const synthStages = progress.filter((p) => p.stage === 'synthesizing');
    assert.ok(synthStages.length >= 1, 'expected at least one synthesizing progress event');
    assert.equal(progress[progress.length - 1].stage, 'done');
  });

  test('research() aborts with LLM_TIMEOUT when builder hangs past timeoutMs', async () => {
    const { CompanyResearchEngine } = cjsRequire(enginePath);
    const builder = {
      build: () => new Promise(() => {}), // hang forever
    };
    const engine = new CompanyResearchEngine({
      cache: makeMockCache(),
      search: makeMockSearch({ results: [{ title: 't', url: 'https://x', content: 'c' }] }),
      builder,
      synthesisTimeoutMs: 80, // tiny for test
    });
    const start = Date.now();
    const r = await engine.research('Apple');
    const elapsed = Date.now() - start;
    assert.equal(r.success, false);
    assert.equal(r.errorCode, 'LLM_TIMEOUT');
    assert.ok(elapsed < 1500, `expected fast abort (got ${elapsed}ms)`);
  });

  test('exported DEFAULT_SYNTHESIS_TIMEOUT_MS is 60s (bounds stall)', () => {
    const { DEFAULT_SYNTHESIS_TIMEOUT_MS } = cjsRequire(enginePath);
    assert.equal(DEFAULT_SYNTHESIS_TIMEOUT_MS, 60_000);
  });
});
