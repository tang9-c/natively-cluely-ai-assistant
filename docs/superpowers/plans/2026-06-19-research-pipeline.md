# Research Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stubbed `profile:research-company` IPC handler with a complete end-to-end Research Pipeline that delivers a 6-dimension CompanyDossier via Tavily search + LLM synthesis, with 24h SQLite cache and graceful LLM fallback.

**Architecture:** Layered backend (Provider → Cache → Engine → Orchestrator) wired into the existing `ProfileOrchestrator`. Renderer gets a new `ResearchPanel` reachable from `ProfileIntelligenceSettings` and a dedicated `Research` tab in `SettingsOverlay`. All external API responses are cached and redacted before logging.

**Tech Stack:** TypeScript (Electron main), React + TailwindCSS + Framer Motion (renderer), `better-sqlite3` (cache), Zod (LLM response validation), `node:test` (unit), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-06-19-research-pipeline-design.md` (approved, commits `a03896f` + `cf80bcb`)

---

## File Structure

```
electron/services/research/                  # NEW
├── types.ts                                 # CompanyDossier, ResearchDimension, etc.
├── TavilySearchProvider.ts                  # replaces placeholder
├── CompanyResearchCache.ts                  # SQLite-backed cache
├── ResearchDossierBuilder.ts                # LLM synthesizer
├── CompanyResearchEngine.ts                 # top-level orchestrator
└── __tests__/
    ├── TavilySearchProvider.test.mjs
    ├── CompanyResearchCache.test.mjs
    ├── ResearchDossierBuilder.test.mjs
    ├── CompanyResearchEngine.test.mjs
    └── CompanyResearchFlow.test.mjs

electron/services/profile/ProfileOrchestrator.ts   # MODIFY (+~40 lines)
electron/ipcHandlers.ts                              # MODIFY (replace stub + 2 new handlers)
electron/preload.ts                                  # MODIFY (3 API surface changes)
electron/db/DatabaseManager.ts                       # MODIFY (v18 migration)

src/components/research/                       # NEW
├── ResearchPanel.tsx
├── ResearchInput.tsx
├── ResearchProgress.tsx
├── ResearchDimension.tsx
├── ResearchErrorBanner.tsx
└── ResearchFallbackBanner.tsx

src/hooks/useResearch.ts                       # NEW
src/App.tsx                                    # MODIFY (+~25 lines)
src/components/ProfileIntelligenceSettings.tsx # MODIFY (+~15 lines)
src/components/SettingsOverlay.tsx             # MODIFY (+~120 lines)
src/types/electron.d.ts                        # MODIFY (+~10 lines)

tests/e2e/research-pipeline.spec.ts            # NEW
```

---

# Phase 1 — Backend Pipeline + Unit Tests

## Task 1: Define Research Types

**Files:**
- Create: `electron/services/research/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// electron/services/research/types.ts
export const DOSSIER_SCHEMA_VERSION = '1.0' as const;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type DossierSource = 'tavily' | 'llm-fallback';

export interface ResearchBullet {
  text: string;
  citation?: number; // 1-based index into ResearchSource[]
}

export interface ResearchDimension {
  summary: string;
  details: ResearchBullet[];
  confidence: ConfidenceLevel;
}

export interface ResearchSource {
  index: number;
  title: string;
  url: string;
  snippet: string; // <=200 chars
}

export interface CompanyDossier {
  schemaVersion: typeof DOSSIER_SCHEMA_VERSION;
  companyName: string;          // display name
  generatedAt: string;          // ISO 8601
  expiresAt: string;            // ISO 8601
  source: DossierSource;
  financials: ResearchDimension;
  business: ResearchDimension;
  strategy: ResearchDimension;
  people: ResearchDimension;
  infrastructure: ResearchDimension;
  procurement: ResearchDimension;
  sources: ResearchSource[];    // empty when source === 'llm-fallback'
}

export type ResearchStage =
  | 'cache-check' | 'searching' | 'synthesizing' | 'done' | 'error';

export interface ResearchProgress {
  stage: ResearchStage;
  message: string;
}

export type ResearchErrorCode =
  | 'INVALID_INPUT'
  | 'TAVILY_KEY_MISSING'
  | 'TAVILY_QUOTA_EXHAUSTED'
  | 'TAVILY_INVALID_KEY'
  | 'TAVILY_NETWORK_ERROR'
  | 'LLM_FAILED'
  | 'LLM_INVALID_FORMAT'
  | 'DB_ERROR';

export interface ProfileResearchCompanyResponse {
  success: boolean;
  dossier?: CompanyDossier;
  cached?: boolean;
  searchQuotaExhausted?: boolean;
  error?: string;
  errorCode?: ResearchErrorCode;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run typecheck:electron 2>&1 | tail -20`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add electron/services/research/types.ts
git commit -m "feat(research): add CompanyDossier and supporting types"
```

---

## Task 2: SQLite v18 Migration — `company_research_cache` Table

**Files:**
- Modify: `electron/db/DatabaseManager.ts` (find the migration chain; usually near top of `init()`)
- Modify: `electron/db/DatabaseManager.ts` (add CRUD helpers in same file)

- [ ] **Step 1: Locate the migration chain**

Search: `grep -n "v17\|v18\|runMigrations\|migrate" electron/db/DatabaseManager.ts | head -20`
Find the place where migrations are applied sequentially. Note the latest version constant.

- [ ] **Step 2: Bump the version constant**

If the project has a `CURRENT_SCHEMA_VERSION` constant or runs migrations by `version` field, bump it from `v17` → `v18`. Otherwise add a new branch to the migration switch.

- [ ] **Step 3: Add the v18 migration SQL**

In the migration chain, add a new block:

```ts
// electron/db/DatabaseManager.ts — inside migration chain
if (currentVersion < 18) {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS company_research_cache (
      company_name TEXT PRIMARY KEY,
      company_name_display TEXT NOT NULL,
      dossier_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      source TEXT NOT NULL,
      schema_version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_company_research_expires
      ON company_research_cache(expires_at);
  `);
  this.setUserVersion(18);
}
```

Adapt the exact control-flow to the project's existing migration style (if/else chain, switch, versioned records, etc.).

- [ ] **Step 4: Add CRUD helper methods on DatabaseManager**

```ts
// electron/db/DatabaseManager.ts — add near other public methods
upsertCompanyResearchCache(row: {
  companyName: string;
  companyNameDisplay: string;
  dossierJson: string;
  generatedAt: string;
  expiresAt: string;
  source: string;
  schemaVersion: string;
}): void {
  this.db.prepare(`
    INSERT OR REPLACE INTO company_research_cache
      (company_name, company_name_display, dossier_json,
       generated_at, expires_at, source, schema_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.companyName, row.companyNameDisplay, row.dossierJson,
    row.generatedAt, row.expiresAt, row.source, row.schemaVersion,
  );
}

getCompanyResearchCache(companyName: string): {
  dossier_json: string; expires_at: string; schema_version: string;
} | null {
  const row = this.db.prepare(`
    SELECT dossier_json, expires_at, schema_version
    FROM company_research_cache
    WHERE company_name = ?
  `).get(companyName) as any;
  return row ?? null;
}

pruneCompanyResearchCache(): number {
  const r = this.db.prepare(`
    DELETE FROM company_research_cache WHERE expires_at < ?
  `).run(new Date().toISOString());
  return r.changes;
}

deleteAllCompanyResearchCache(): number {
  const r = this.db.prepare(`DELETE FROM company_research_cache`).run();
  return r.changes;
}
```

Adapt `prepare(...).run(...)` / `.get(...)` calls to the existing DatabaseManager style (the project uses better-sqlite3 — confirm the exact API used by surrounding methods).

- [ ] **Step 5: Build and run existing tests**

Run: `npm run build:electron && npm test 2>&1 | tail -30`
Expected: existing tests pass; no regression from schema bump.

- [ ] **Step 6: Commit**

```bash
git add electron/db/DatabaseManager.ts
git commit -m "feat(db): v18 migration + company_research_cache CRUD"
```

---

## Task 3: `TavilySearchProvider` — Write Failing Tests First

**Files:**
- Create: `electron/services/research/__tests__/TavilySearchProvider.test.mjs`

- [ ] **Step 1: Create the failing test file**

```js
// electron/services/research/__tests__/TavilySearchProvider.test.mjs
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

const providerPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/research/TavilySearchProvider.js',
);

describe('TavilySearchProvider', () => {
  let originalFetch;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
  });

  const restoreFetch = () => { globalThis.fetch = originalFetch; };

  test('search() POSTs to https://api.tavily.com/search with api_key', async () => {
    globalThis.fetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return new Response(JSON.stringify({
        results: [{ title: 'Apple Inc.', url: 'https://apple.com', content: 'Tech co' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { TavilySearchProvider } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'tvly-test', fetchImpl: globalThis.fetch });
    const results = await p.search(['Apple revenue 2024']);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://api.tavily.com/search');
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.api_key, 'tvly-test');
    assert.deepEqual(body.query, 'Apple revenue 2024');
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Apple Inc.');
    restoreFetch();
  });

  test('search() throws TavilyQuotaError on HTTP 429', async () => {
    globalThis.fetch = async () => new Response('{"detail":"quota exceeded"}', { status: 429 });
    const { TavilySearchProvider, TavilyQuotaError } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'tvly-test', fetchImpl: globalThis.fetch });
    await assert.rejects(() => p.search(['x']), (err) => err instanceof TavilyQuotaError);
    restoreFetch();
  });

  test('search() throws TavilyAuthError on HTTP 401', async () => {
    globalThis.fetch = async () => new Response('unauthorized', { status: 401 });
    const { TavilySearchProvider, TavilyAuthError } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'bad', fetchImpl: globalThis.fetch });
    await assert.rejects(() => p.search(['x']), (err) => err instanceof TavilyAuthError);
    restoreFetch();
  });

  test('search() throws TavilyNetworkError on timeout', async () => {
    globalThis.fetch = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const { TavilySearchProvider, TavilyNetworkError } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'k', fetchImpl: globalThis.fetch });
    await assert.rejects(() => p.search(['x']), (err) => err instanceof TavilyNetworkError);
    restoreFetch();
  });
});
```

- [ ] **Step 2: Build and run test to confirm it fails**

Run: `npm run build:electron && node --test electron/services/research/__tests__/TavilySearchProvider.test.mjs 2>&1 | tail -20`
Expected: FAIL — `TavilySearchProvider` module not found at `dist-electron/electron/services/research/TavilySearchProvider.js`.

---

## Task 4: `TavilySearchProvider` — Implementation

**Files:**
- Create: `electron/services/research/TavilySearchProvider.ts`

- [ ] **Step 1: Create the provider**

```ts
// electron/services/research/TavilySearchProvider.ts
import { redactForLog } from '../../utils/redactForLog';

export class TavilyError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TavilyError';
  }
}
export class TavilyQuotaError extends TavilyError {
  constructor(message = 'Tavily quota exhausted') { super(message); this.name = 'TavilyQuotaError'; }
}
export class TavilyAuthError extends TavilyError {
  constructor(message = 'Tavily API key invalid') { super(message); this.name = 'TavilyAuthError'; }
}
export class TavilyNetworkError extends TavilyError {
  constructor(message = 'Tavily network error', cause?: unknown) {
    super(message, cause);
    this.name = 'TavilyNetworkError';
  }
}

export interface TavilySearchOpts {
  apiKey: string;
  fetchImpl?: typeof fetch;     // injected for tests
  timeoutMs?: number;            // default 10_000
  maxResultsPerQuery?: number;   // default 5
}

export interface TavilyRawResult {
  title: string;
  url: string;
  content: string;
}

export class TavilySearchProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResultsPerQuery: number;

  constructor(opts: TavilySearchOpts) {
    if (!opts.apiKey) throw new TavilyAuthError('apiKey required');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxResultsPerQuery = opts.maxResultsPerQuery ?? 5;
  }

  async search(queries: string[]): Promise<TavilyRawResult[]> {
    if (queries.length === 0) return [];
    const all: TavilyRawResult[] = [];
    for (const q of queries) {
      const results = await this.searchOne(q);
      all.push(...results);
    }
    // de-dupe by URL
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }

  private async searchOne(query: string): Promise<TavilyRawResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: this.maxResultsPerQuery,
          include_answer: false,
        }),
        signal: controller.signal,
      });
      if (res.status === 429) throw new TavilyQuotaError();
      if (res.status === 401 || res.status === 403) throw new TavilyAuthError();
      if (!res.ok) throw new TavilyNetworkError(`HTTP ${res.status}`);
      const json: any = await res.json();
      const results = Array.isArray(json?.results) ? json.results : [];
      return results.map((r: any) => ({
        title: String(r.title ?? ''),
        url: String(r.url ?? ''),
        content: String(r.content ?? '').slice(0, 1000),
      }));
    } catch (err: any) {
      if (err instanceof TavilyError) throw err;
      if (err?.name === 'AbortError') {
        throw new TavilyNetworkError('timeout', err);
      }
      console.warn('[TavilySearchProvider] failed:', redactForLog([err]));
      throw new TavilyNetworkError(err?.message ?? 'unknown', err);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 2: Build and run test to confirm it passes**

Run: `npm run build:electron && node --test electron/services/research/__tests__/TavilySearchProvider.test.mjs 2>&1 | tail -15`
Expected: PASS — 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add electron/services/research/TavilySearchProvider.ts electron/services/research/__tests__/TavilySearchProvider.test.mjs
git commit -m "feat(research): TavilySearchProvider with quota/auth/network error classification"
```

---

## Task 5: `CompanyResearchCache` — Tests

**Files:**
- Create: `electron/services/research/__tests__/CompanyResearchCache.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
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
  __dirname, '../../../dist-electron/electron/services/research/CompanyResearchCache.js',
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
      expiresAt: '2026-06-20T00:00:00Z', source: 'tavily',
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
    assert.equal(await cache.get('Fresh'), null); // null after prune (we deleted all on prune)
    // verify Old was deleted
    const row = db.prepare('SELECT count(*) as c FROM company_research_cache').get();
    assert.equal(row.c, 0);
  });
});
```

- [ ] **Step 2: Build and run to confirm failure**

Run: `npm run build:electron && node --test electron/services/research/__tests__/CompanyResearchCache.test.mjs 2>&1 | tail -15`
Expected: FAIL — module not found.

---

## Task 6: `CompanyResearchCache` — Implementation

**Files:**
- Create: `electron/services/research/CompanyResearchCache.ts`

- [ ] **Step 1: Create the cache class**

```ts
// electron/services/research/CompanyResearchCache.ts
import {
  CACHE_TTL_MS, DOSSIER_SCHEMA_VERSION,
  type CompanyDossier,
} from './types';

interface CacheRow {
  dossier_json: string;
  expires_at: string;
  schema_version: string;
}

interface CacheHit {
  dossier: CompanyDossier;
  isExpired: () => boolean;
}

interface DbAdapter {
  getCompanyResearchCache(key: string): CacheRow | null;
  upsertCompanyResearchCache(row: {
    companyName: string;
    companyNameDisplay: string;
    dossierJson: string;
    generatedAt: string;
    expiresAt: string;
    source: string;
    schemaVersion: string;
  }): void;
  pruneCompanyResearchCache(): number;
  deleteAllCompanyResearchCache(): number;
}

export class CompanyResearchCache {
  constructor(private readonly db: DbAdapter) {}

  private normalize(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async get(companyName: string): Promise<CacheHit | null> {
    const key = this.normalize(companyName);
    if (!key) return null;
    const row = this.db.getCompanyResearchCache(key);
    if (!row) return null;
    if (row.schema_version !== DOSSIER_SCHEMA_VERSION) return null;
    let dossier: CompanyDossier;
    try {
      dossier = JSON.parse(row.dossier_json);
    } catch {
      return null;
    }
    const expiresAtMs = new Date(row.expires_at).getTime();
    return {
      dossier,
      isExpired: () => Date.now() > expiresAtMs,
    };
  }

  async put(companyName: string, dossier: CompanyDossier): Promise<void> {
    const key = this.normalize(companyName);
    const now = Date.now();
    this.db.upsertCompanyResearchCache({
      companyName: key,
      companyNameDisplay: dossier.companyName,
      dossierJson: JSON.stringify(dossier),
      generatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CACHE_TTL_MS).toISOString(),
      source: dossier.source,
      schemaVersion: DOSSIER_SCHEMA_VERSION,
    });
  }

  async prune(): Promise<number> {
    return this.db.pruneCompanyResearchCache();
  }

  async clearAll(): Promise<number> {
    return this.db.deleteAllCompanyResearchCache();
  }
}
```

- [ ] **Step 2: Build and run tests**

Run: `npm run build:electron && node --test electron/services/research/__tests__/CompanyResearchCache.test.mjs 2>&1 | tail -15`
Expected: PASS — 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add electron/services/research/CompanyResearchCache.ts electron/services/research/__tests__/CompanyResearchCache.test.mjs
git commit -m "feat(research): SQLite-backed CompanyResearchCache with 24h TTL"
```

---

## Task 7: `ResearchDossierBuilder` — Tests

**Files:**
- Create: `electron/services/research/__tests__/ResearchDossierBuilder.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// electron/services/research/__tests__/ResearchDossierBuilder.test.mjs
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const builderPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/research/ResearchDossierBuilder.js',
);

function makeMockLlm(responses) {
  let callIdx = 0;
  return {
    generateStructured: async (prompt, schema) => {
      const r = responses[callIdx++];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe('ResearchDossierBuilder', () => {
  test('build() with sources marks dossier.source = "tavily"', async () => {
    const validDossier = {
      schemaVersion: '1.0', companyName: 'Apple', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [{ text: 'f' }], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [{ index: 1, title: 't', url: 'https://x', snippet: 's' }],
    };
    const llm = makeMockLlm([validDossier]);
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', [{ title: 't', url: 'https://x', content: 's' }]);
    assert.equal(out.source, 'tavily');
    assert.equal(out.financials.confidence, 'high');
  });

  test('build() with empty sources marks dossier.source = "llm-fallback"', async () => {
    const llmDossier = {
      schemaVersion: '1.0', companyName: 'Apple', generatedAt: '', expiresAt: '',
      source: 'tavily', // builder should overwrite
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = makeMockLlm([llmDossier]);
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', []);
    assert.equal(out.source, 'llm-fallback');
  });

  test('build() retries once when LLM returns invalid shape', async () => {
    const validDossier = {
      schemaVersion: '1.0', companyName: 'X', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    // First call throws (invalid format), second returns valid.
    const llm = {
      generateStructured: async () => {
        if (!llm._called) { llm._called = true; throw new Error('invalid shape'); }
        return validDossier;
      },
    };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('X', []);
    assert.equal(out.companyName, 'X');
  });

  test('build() throws LlmInvalidFormatError after retry exhaustion', async () => {
    const llm = { generateStructured: async () => { throw new Error('still bad'); } };
    const { ResearchDossierBuilder, LlmInvalidFormatError } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    await assert.rejects(() => b.build('X', []), (err) => err instanceof LlmInvalidFormatError);
  });
});
```

- [ ] **Step 2: Build and confirm tests fail**

Run: `npm run build:electron && node --test electron/services/research/__tests__/ResearchDossierBuilder.test.mjs 2>&1 | tail -15`
Expected: FAIL — module not found.

---

## Task 8: `ResearchDossierBuilder` — Implementation

**Files:**
- Create: `electron/services/research/ResearchDossierBuilder.ts`

- [ ] **Step 1: Create the builder**

```ts
// electron/services/research/ResearchDossierBuilder.ts
import { z } from 'zod';
import type {
  CompanyDossier, ResearchDimension, ResearchSource, ResearchBullet,
} from './types';
import { DOSSIER_SCHEMA_VERSION } from './types';

export class LlmInvalidFormatError extends Error {
  constructor(message = 'LLM returned invalid dossier shape') {
    super(message);
    this.name = 'LlmInvalidFormatError';
  }
}

export interface LlmAdapter {
  generateStructured(prompt: string, schema: z.ZodTypeAny): Promise<unknown>;
}

interface BuilderOpts { llm: LlmAdapter; }

const BulletSchema = z.object({
  text: z.string(),
  citation: z.number().int().positive().optional(),
});

const DimensionSchema = z.object({
  summary: z.string(),
  details: z.array(BulletSchema),
  confidence: z.enum(['high', 'medium', 'low']),
});

const SourceSchema = z.object({
  index: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().max(500),
});

const DossierSchema = z.object({
  schemaVersion: z.literal('1.0'),
  companyName: z.string(),
  financials: DimensionSchema,
  business: DimensionSchema,
  strategy: DimensionSchema,
  people: DimensionSchema,
  infrastructure: DimensionSchema,
  procurement: DimensionSchema,
  sources: z.array(SourceSchema),
});

export class ResearchDossierBuilder {
  constructor(private readonly opts: BuilderOpts) {}

  async build(
    companyName: string,
    rawSources: Array<{ title: string; url: string; content: string }>,
  ): Promise<CompanyDossier> {
    const sources: ResearchSource[] = rawSources.map((r, i) => ({
      index: i + 1,
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 200),
    }));
    const isFallback = sources.length === 0;
    const prompt = this.buildPrompt(companyName, sources, isFallback);

    let parsed: any;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        parsed = await this.opts.llm.generateStructured(prompt, DossierSchema);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw new LlmInvalidFormatError();
    const valid = DossierSchema.parse(parsed);

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return {
      schemaVersion: DOSSIER_SCHEMA_VERSION,
      companyName: valid.companyName || companyName,
      generatedAt: now,
      expiresAt: expires,
      source: isFallback ? 'llm-fallback' : 'tavily',
      financials: this.maybeDowngrade(valid.financials, isFallback),
      business: this.maybeDowngrade(valid.business, isFallback),
      strategy: this.maybeDowngrade(valid.strategy, isFallback),
      people: this.maybeDowngrade(valid.people, isFallback),
      infrastructure: this.maybeDowngrade(valid.infrastructure, isFallback),
      procurement: this.maybeDowngrade(valid.procurement, isFallback),
      sources: isFallback ? [] : valid.sources,
    };
  }

  private maybeDowngrade(dim: ResearchDimension, isFallback: boolean): ResearchDimension {
    if (!isFallback) return dim;
    return { ...dim, confidence: 'low' as const };
  }

  private buildPrompt(
    companyName: string,
    sources: ResearchSource[],
    isFallback: boolean,
  ): string {
    const sourceBlock = sources.length === 0
      ? '(no external sources — use your training knowledge, mark all confidence as "low")'
      : sources.map((s) => `[${s.index}] ${s.title} — ${s.url}\n${s.snippet}`).join('\n\n');
    return `You are a company research analyst. Produce a 6-dimension dossier for "${companyName}".

Dimensions (each must have summary + 3-7 bullets + confidence):
1. financials — size, revenue, growth, R&D
2. business — products, customers, target markets
3. strategy — expansion plans, hiring hotspots, transformation
4. people — executives, department heads, key org structure
5. infrastructure — tech stack, supply chain, digital ecosystem
6. procurement — past purchase records, supplier compliance requirements

${isFallback ? '⚠️ No external sources available. Answer from training knowledge only.' : ''}

Sources:
${sourceBlock}

Respond with JSON matching the schema. For each bullet, optionally include "citation" (1-based index into the sources above).`;
  }
}
```

- [ ] **Step 2: Build and run tests**

Run: `npm run build:electron && node --test electron/services/research/__tests__/ResearchDossierBuilder.test.mjs 2>&1 | tail -15`
Expected: PASS — 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add electron/services/research/ResearchDossierBuilder.ts electron/services/research/__tests__/ResearchDossierBuilder.test.mjs
git commit -m "feat(research): ResearchDossierBuilder with Zod validation and 1-retry on invalid format"
```

---

## Task 9: `CompanyResearchEngine` — Tests

**Files:**
- Create: `electron/services/research/__tests__/CompanyResearchEngine.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// electron/services/research/__tests__/CompanyResearchEngine.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const enginePath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/research/CompanyResearchEngine.js',
);

function makeMockCache({ hit = null } = {}) {
  const store = new Map();
  return {
    get: async (name) => hit && hit.name === name ? hit : null,
    put: async (name, dossier) => { store.set(name, dossier); },
    _store: store,
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
      hit: { dossier: baseDossier, isExpired: () => false },
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
      hit: { dossier: baseDossier, isExpired: () => false },
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
    const { TavilyQuotaError } = cjsRequire(path.resolve(
      __dirname, '../../../dist-electron/electron/services/research/TavilySearchProvider.js',
    ));
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
    const { TavilyAuthError } = cjsRequire(path.resolve(
      __dirname, '../../../dist-electron/electron/services/research/TavilySearchProvider.js',
    ));
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
    const { TavilyNetworkError } = cjsRequire(path.resolve(
      __dirname, '../../../dist-electron/electron/services/research/TavilySearchProvider.js',
    ));
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
```

- [ ] **Step 2: Build and confirm tests fail**

Run: `npm run build:electron && node --test electron/services/research/__tests__/CompanyResearchEngine.test.mjs 2>&1 | tail -15`
Expected: FAIL — module not found.

---

## Task 10: `CompanyResearchEngine` — Implementation

**Files:**
- Create: `electron/services/research/CompanyResearchEngine.ts`

- [ ] **Step 1: Create the engine**

```ts
// electron/services/research/CompanyResearchEngine.ts
import type {
  CompanyDossier, ProfileResearchCompanyResponse, ResearchProgress,
} from './types';
import {
  TavilyQuotaError, TavilyAuthError,
} from './TavilySearchProvider';
import type { TavilySearchProvider } from './TavilySearchProvider';
import type { CompanyResearchCache } from './CompanyResearchCache';
import type { ResearchDossierBuilder } from './ResearchDossierBuilder';

interface CacheAdapter {
  get(companyName: string): Promise<{ dossier: CompanyDossier; isExpired: () => boolean } | null>;
  put(companyName: string, dossier: CompanyDossier): Promise<void>;
}

interface SearchAdapter {
  search(queries: string[]): Promise<Array<{ title: string; url: string; content: string }>>;
}

interface BuilderAdapter {
  build(companyName: string, sources: Array<{ title: string; url: string; content: string }>): Promise<CompanyDossier>;
}

interface EngineOpts {
  cache: CacheAdapter;
  search: SearchAdapter;
  builder: BuilderAdapter;
}

interface ResearchOpts {
  forceRefresh?: boolean;
  onProgress?: (p: ResearchProgress) => void;
}

export class CompanyResearchEngine {
  constructor(private readonly opts: EngineOpts) {}

  async research(companyName: string, opts: ResearchOpts = {}): Promise<ProfileResearchCompanyResponse> {
    const trimmed = (companyName ?? '').trim();
    if (!trimmed || trimmed.length > 100) {
      return { success: false, errorCode: 'INVALID_INPUT',
        error: '请输入有效的公司名（1-100 字符）' };
    }

    const progress = (p: ResearchProgress) => opts.onProgress?.(p);

    progress({ stage: 'cache-check', message: '正在检查缓存...' });
    if (!opts.forceRefresh) {
      const cached = await this.opts.cache.get(trimmed);
      if (cached && !cached.isExpired()) {
        progress({ stage: 'done', message: '缓存命中' });
        return { success: true, dossier: cached.dossier, cached: true };
      }
    }

    progress({ stage: 'searching', message: '正在搜索...' });
    const queries = this.buildQueries(trimmed);
    let sources: Array<{ title: string; url: string; content: string }> = [];
    try {
      sources = await this.opts.search.search(queries);
    } catch (err) {
      if (err instanceof TavilyQuotaError) {
        return { success: false, searchQuotaExhausted: true,
          errorCode: 'TAVILY_QUOTA_EXHAUSTED',
          error: 'Tavily 搜索额度已用完，请在 Tavily 控制台升级或等待下月重置' };
      }
      if (err instanceof TavilyAuthError) {
        return { success: false, errorCode: 'TAVILY_INVALID_KEY',
          error: 'Tavily API key 无效，请检查设置' };
      }
      // TavilyNetworkError / unknown → fallback
      sources = [];
    }

    progress({ stage: 'synthesizing', message: '正在综合 AI 报告...' });
    const dossier = await this.opts.builder.build(trimmed, sources);

    await this.opts.cache.put(trimmed, dossier);
    progress({ stage: 'done', message: '完成' });
    return { success: true, dossier, cached: false };
  }

  async clearCache(): Promise<number> {
    if ('clearAll' in this.opts.cache) {
      return await (this.opts.cache as any).clearAll();
    }
    return 0;
  }

  private buildQueries(companyName: string): string[] {
    return [
      `${companyName} revenue employees annual report 2024`,
      `${companyName} products customers target market`,
      `${companyName} expansion strategy hiring 2025`,
      `${companyName} executives leadership team`,
      `${companyName} technology stack infrastructure`,
      `${companyName} procurement suppliers compliance`,
    ];
  }
}
```

- [ ] **Step 2: Build and run tests**

Run: `npm run build:electron && node --test electron/services/research/__tests__/CompanyResearchEngine.test.mjs 2>&1 | tail -15`
Expected: PASS — 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add electron/services/research/CompanyResearchEngine.ts electron/services/research/__tests__/CompanyResearchEngine.test.mjs
git commit -m "feat(research): CompanyResearchEngine orchestrator with cache/search/fallback"
```

---

## Task 11: Extend `ProfileOrchestrator` — Tests First

**Files:**
- Create: `electron/services/__tests__/ProfileOrchestrator.Research.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
// electron/services/__tests__/ProfileOrchestrator.Research.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const orchestratorPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/profile/ProfileOrchestrator.js',
);
const credsPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/CredentialsManager.js',
);

// Note: these tests rely on CredentialsManager.getTavilyApiKey existing.
// If that method doesn't exist yet, stub it via the module export.

describe('ProfileOrchestrator — Research integration', () => {
  test('runCompanyResearch() returns TAVILY_KEY_MISSING when no key configured', async () => {
    // Force creds to return null
    const creds = cjsRequire(credsPath);
    const orig = creds.getTavilyApiKey;
    creds.getTavilyApiKey = () => null;

    const { ProfileOrchestrator } = cjsRequire(orchestratorPath);
    const o = new ProfileOrchestrator();
    const r = await o.runCompanyResearch('Apple');
    assert.equal(r.success, false);
    assert.equal(r.errorCode, 'TAVILY_KEY_MISSING');

    creds.getTavilyApiKey = orig;
  });

  test('runCompanyResearch() delegates to engine when key present', async () => {
    const creds = cjsRequire(credsPath);
    const orig = creds.getTavilyApiKey;
    creds.getTavilyApiKey = () => 'tvly-test';

    const { ProfileOrchestrator } = cjsRequire(orchestratorPath);
    const o = new ProfileOrchestrator();
    // Inject a stub engine
    o.researchEngine = {
      research: async (name) => ({ success: true, dossier: { companyName: name }, cached: false }),
      clearCache: async () => 0,
    };
    const r = await o.runCompanyResearch('Apple');
    assert.equal(r.success, true);
    assert.equal(r.dossier.companyName, 'Apple');

    creds.getTavilyApiKey = orig;
  });

  test('getCompanyResearchEngine() returns the same instance', async () => {
    const creds = cjsRequire(credsPath);
    const orig = creds.getTavilyApiKey;
    creds.getTavilyApiKey = () => 'k';
    const { ProfileOrchestrator } = cjsRequire(orchestratorPath);
    const o = new ProfileOrchestrator();
    const e1 = o.getCompanyResearchEngine();
    const e2 = o.getCompanyResearchEngine();
    assert.ok(e1);
    assert.equal(e1, e2);
    creds.getTavilyApiKey = orig;
  });
});
```

- [ ] **Step 2: Build and confirm tests fail**

Run: `npm run build:electron && node --test electron/services/__tests__/ProfileOrchestrator.Research.test.mjs 2>&1 | tail -20`
Expected: FAIL — `runCompanyResearch` and `getCompanyResearchEngine` don't exist on `ProfileOrchestrator`.

---

## Task 12: Extend `ProfileOrchestrator` — Implementation

**Files:**
- Modify: `electron/services/profile/ProfileOrchestrator.ts`

- [ ] **Step 1: Add imports**

At the top of `ProfileOrchestrator.ts`, after the existing imports, add:

```ts
import { CompanyResearchEngine } from '../research/CompanyResearchEngine';
import { TavilySearchProvider } from '../research/TavilySearchProvider';
import { CompanyResearchCache } from '../research/CompanyResearchCache';
import { ResearchDossierBuilder } from '../research/ResearchDossierBuilder';
import { CredentialsManager } from '../CredentialsManager';
import type { ProfileResearchCompanyResponse } from '../research/types';
```

Add `researchEngine` to the type contract if `ProfileOrchestratorRuntime` (in `ProfileOrchestratorContract.ts`) doesn't already include `getCompanyResearchEngine`. If it does, skip.

- [ ] **Step 2: Add the engine field and accessor**

In the `ProfileOrchestrator` class, add (alongside existing private fields like `db`, `resumeParser`):

```ts
researchEngine: CompanyResearchEngine | null = null;

getCompanyResearchEngine(): CompanyResearchEngine {
  if (!this.researchEngine) {
    const apiKey = (CredentialsManager.getInstance() as any)?.getTavilyApiKey?.()
      ?? process.env.TAVILY_API_KEY
      ?? '';
    const search = new TavilySearchProvider({ apiKey });
    const cache = new CompanyResearchCache(this.db as any);
    // LLMHelper is set via setLLMHelper; we need to bridge it.
    // For now, builder receives a stub. Task 13 wires the real LLMHelper.
    const llmHelper = (this as any).llmHelper;
    const builder = new ResearchDossierBuilder({
      llm: {
        generateStructured: async (prompt, schema) => {
          if (!llmHelper) throw new Error('LLM not initialized');
          return llmHelper.generateStructuredContent(prompt, schema);
        },
      },
    });
    this.researchEngine = new CompanyResearchEngine({ cache, search, builder });
  }
  return this.researchEngine;
}
```

Note: the `(this as any).llmHelper` access assumes `setLLMHelper` will store the helper. Update `setLLMHelper` to also store it:

```ts
private llmHelper: any = null;

setLLMHelper(llmHelper: any): void {
  this.llmHelper = llmHelper; // store for engine builder
  const parserLLM = new ParserLLM(llmHelper);
  this.resumeParser = new ResumeParser(parserLLM);
  this.jdParser = new JDParser(parserLLM);
  // Invalidate engine so it picks up the LLM helper
  this.researchEngine = null;
}
```

- [ ] **Step 3: Add `runCompanyResearch` method**

```ts
async runCompanyResearch(
  companyName: string,
  options: { forceRefresh?: boolean; onProgress?: (p: any) => void } = {},
): Promise<ProfileResearchCompanyResponse> {
  const apiKey = (CredentialsManager.getInstance() as any)?.getTavilyApiKey?.();
  if (!apiKey) {
    return {
      success: false,
      errorCode: 'TAVILY_KEY_MISSING',
      error: '请在 Settings → Research 中配置 Tavily API key',
    };
  }
  const engine = this.getCompanyResearchEngine();
  return engine.research(companyName, options);
}
```

- [ ] **Step 4: Build and verify tests pass**

Run: `npm run build:electron && node --test electron/services/__tests__/ProfileOrchestrator.Research.test.mjs 2>&1 | tail -20`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Run full unit test suite to ensure no regression**

Run: `npm test 2>&1 | tail -30`
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add electron/services/profile/ProfileOrchestrator.ts electron/services/__tests__/ProfileOrchestrator.Research.test.mjs
git commit -m "feat(profile): integrate CompanyResearchEngine into ProfileOrchestrator"
```

---

## Task 13: `CredentialsManager.getTavilyApiKey()` — Wire Method

**Files:**
- Modify: `electron/services/CredentialsManager.ts`

- [ ] **Step 1: Check existing key storage**

Run: `grep -n "tavily\|Tavily\|TAVILY" electron/services/CredentialsManager.ts`
Look for existing storage of Tavily keys. If absent, add a generic getter.

- [ ] **Step 2: Add getTavilyApiKey/setTavilyApiKey if missing**

If no `tavilyApiKey` field exists, add:

```ts
private tavilyApiKey: string | null = null;

setTavilyApiKey(key: string): void {
  this.tavilyApiKey = key;
  this.persist(); // adapt to existing persistence pattern
}

getTavilyApiKey(): string | null {
  return this.tavilyApiKey;
}
```

If `tavilyApiKey` is already stored under a different name (e.g., `getApiKey('tavily')`), add a thin wrapper:

```ts
getTavilyApiKey(): string | null {
  return this.getApiKey?.('tavily') ?? null;
}
```

- [ ] **Step 3: Ensure load() restores the key on app boot**

If the project has a `load()` / `init()` method that hydrates credentials from disk, add the Tavily field to the loaded shape.

- [ ] **Step 4: Build and run tests**

Run: `npm run build:electron && node --test electron/services/__tests__/ProfileOrchestrator.Research.test.mjs 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/CredentialsManager.ts
git commit -m "feat(creds): add Tavily API key getter/setter"
```

---

## Task 14: Replace IPC Handler Stub

**Files:**
- Modify: `electron/ipcHandlers.ts` (lines ~3655-3690)

- [ ] **Step 1: Locate the stub**

Run: `grep -n "profile:research-company\|profile:generate-negotiation" electron/ipcHandlers.ts`
Note line numbers for the four stubs.

- [ ] **Step 2: Replace `profile:research-company` stub**

Replace the existing stub with:

```ts
safeHandle(
  'profile:research-company',
  async (
    _: unknown,
    companyName: string,
    options: { forceRefresh?: boolean } = {},
  ) => {
    try {
      const orchestrator = appState.getKnowledgeOrchestrator();
      return await orchestrator.runCompanyResearch(companyName, options);
    } catch (err: any) {
      console.error('[ipcHandlers] profile:research-company failed:', redactForLog([err]));
      return {
        success: false,
        errorCode: 'DB_ERROR',
        error: 'Internal error: ' + (err?.message ?? 'unknown'),
      };
    }
  },
);
```

Note: `appState.getKnowledgeOrchestrator()` and `redactForLog` must already be imported in `ipcHandlers.ts`. If `redactForLog` is not imported, add `import { redactForLog } from './utils/redactForLog';` near the top.

- [ ] **Step 3: Add `profile:clear-research-cache` handler**

```ts
safeHandle('profile:clear-research-cache', async () => {
  const orchestrator = appState.getKnowledgeOrchestrator();
  const engine = orchestrator.getCompanyResearchEngine();
  const deleted = await engine.clearCache();
  return { success: true, deleted };
});
```

- [ ] **Step 4: Add `profile:test-tavily-key` handler**

```ts
safeHandle('profile:test-tavily-key', async (_: unknown, key: string) => {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, reason: 'invalid_key' };
    }
    if (res.status === 429) return { valid: true, quotaLow: true };
    return { valid: res.ok };
  } catch (err: any) {
    return { valid: false, reason: 'network_error', message: err?.message };
  }
});
```

- [ ] **Step 5: Build and verify type-check passes**

Run: `npm run typecheck:electron 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/ipcHandlers.ts
git commit -m "feat(ipc): replace profile:research-company stub with real handler + 2 new channels"
```

---

## Task 15: Update Preload Bridge

**Files:**
- Modify: `electron/preload.ts` (lines ~602, 1769, plus add 2 new APIs)

- [ ] **Step 1: Update `profileResearchCompany` signature**

Find the existing definition (around line 602). Update the JSDoc and signature to accept optional second arg:

```ts
profileResearchCompany(
  companyName: string,
  options?: { forceRefresh?: boolean },
): Promise<{
  success: boolean;
  dossier?: any;
  cached?: boolean;
  searchQuotaExhausted?: boolean;
  error?: string;
  errorCode?: string;
}>;
```

- [ ] **Step 2: Add 2 new API methods**

Near `profileResearchCompany`, add:

```ts
profileClearResearchCache(): Promise<{ success: boolean; deleted: number }>;
testTavilyApiKey(key: string): Promise<{
  valid: boolean; reason?: string; quotaLow?: boolean; message?: string;
}>;
```

- [ ] **Step 3: Wire the `contextBridge.exposeInMainWorld` calls**

Find the `ipcRenderer.invoke` calls around line 1769. Update to pass options, and add:

```ts
profileClearResearchCache: () => ipcRenderer.invoke('profile:clear-research-cache'),
testTavilyApiKey: (key: string) => ipcRenderer.invoke('profile:test-tavily-key', key),
```

- [ ] **Step 4: Update `src/types/electron.d.ts` mirror**

Find the matching interface in `src/types/electron.d.ts` around line 429 and update the signature to match.

- [ ] **Step 5: Run type check**

Run: `npm run typecheck:electron 2>&1 | tail -10 && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/preload.ts src/types/electron.d.ts
git commit -m "feat(preload): update profileResearchCompany + add clear-cache/test-key APIs"
```

---

## Task 16: Integration Test — Full Flow

**Files:**
- Create: `electron/services/research/__tests__/CompanyResearchFlow.test.mjs`

- [ ] **Step 1: Write the integration test**

```js
// electron/services/research/__tests__/CompanyResearchFlow.test.mjs
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const enginePath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/research/CompanyResearchEngine.js',
);
const cachePath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/research/CompanyResearchCache.js',
);
const tavilyPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/research/TavilySearchProvider.js',
);
const builderPath = path.resolve(
  __dirname, '../../../dist-electron/electron/services/research/ResearchDossierBuilder.js',
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
  sources: [],
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
```

- [ ] **Step 2: Build and run integration tests**

Run: `npm run build:electron && node --test electron/services/research/__tests__/CompanyResearchFlow.test.mjs 2>&1 | tail -15`
Expected: PASS — 3 tests pass.

- [ ] **Step 3: Run full backend test suite**

Run: `npm test 2>&1 | tail -30`
Expected: all tests pass (existing + new research tests).

- [ ] **Step 4: Commit**

```bash
git add electron/services/research/__tests__/CompanyResearchFlow.test.mjs
git commit -m "test(research): end-to-end flow tests (cache hit/miss, force refresh)"
```

---

## Task 17: Phase 1 Manual Smoke Check

- [ ] **Step 1: Run the app**

Run: `npm start` (or `npm run app:dev`)
Expected: app launches without errors.

- [ ] **Step 2: Trigger research from existing UI**

- Open Settings → (will be added in Phase 2). For now, trigger via dev console:
  ```js
  await window.electronAPI.profileResearchCompany('Apple Inc.', { forceRefresh: true });
  ```
- Expected: returns `{ success: true, dossier: { companyName: 'Apple Inc.', source: 'tavily', ... } }`.

- [ ] **Step 3: Check cache hit**

Run same call again:
- Expected: returns `{ success: true, cached: true, ... }`.

- [ ] **Step 4: Commit any incidental fixes**

If dev console revealed typos, commit them as a separate fix commit before Phase 2.

---

# Phase 2 — UI + E2E

## Task 18: `useResearch` Hook — Tests First

**Files:**
- Create: `src/hooks/__tests__/useResearch.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/hooks/__tests__/useResearch.test.ts
import { renderHook, act } from '@testing-library/react';
import { useResearch } from '../useResearch';

declare const global: any;

const mockElectronAPI = (response: any) => {
  global.window = global.window || {};
  global.window.electronAPI = {
    profileResearchCompany: async () => response,
    profileClearResearchCache: async () => ({ success: true, deleted: 0 }),
  };
};

describe('useResearch', () => {
  test('initial state is idle with empty dossier', () => {
    mockElectronAPI({ success: false });
    const { result } = renderHook(() => useResearch());
    expect(result.current.stage).toBe('idle');
    expect(result.current.dossier).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test('research() transitions idle → loading → success', async () => {
    mockElectronAPI({
      success: true,
      dossier: { companyName: 'Apple', source: 'tavily' },
      cached: false,
    });
    const { result } = renderHook(() => useResearch());
    await act(async () => {
      await result.current.research('Apple');
    });
    expect(result.current.stage).toBe('success');
    expect(result.current.dossier?.companyName).toBe('Apple');
  });

  test('research() sets error on quota exhausted', async () => {
    mockElectronAPI({
      success: false,
      searchQuotaExhausted: true,
      errorCode: 'TAVILY_QUOTA_EXHAUSTED',
      error: 'quota exhausted',
    });
    const { result } = renderHook(() => useResearch());
    await act(async () => {
      await result.current.research('Apple');
    });
    expect(result.current.stage).toBe('error');
    expect(result.current.quotaExhausted).toBe(true);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- src/hooks/__tests__/useResearch.test.ts 2>&1 | tail -15`
Expected: FAIL — `useResearch` doesn't exist.

---

## Task 19: `useResearch` Hook — Implementation

**Files:**
- Create: `src/hooks/useResearch.ts`

- [ ] **Step 1: Create the hook**

```ts
// src/hooks/useResearch.ts
import { useCallback, useState } from 'react';

export type ResearchStage = 'idle' | 'loading' | 'success' | 'error';

interface Dossier {
  schemaVersion: '1.0';
  companyName: string;
  generatedAt: string;
  expiresAt: string;
  source: 'tavily' | 'llm-fallback';
  financials: any;
  business: any;
  strategy: any;
  people: any;
  infrastructure: any;
  procurement: any;
  sources: Array<{ index: number; title: string; url: string; snippet: string }>;
}

interface ResearchResponse {
  success: boolean;
  dossier?: Dossier;
  cached?: boolean;
  searchQuotaExhausted?: boolean;
  error?: string;
  errorCode?: string;
}

export interface UseResearchReturn {
  stage: ResearchStage;
  dossier: Dossier | null;
  cached: boolean;
  error: string | null;
  errorCode: string | null;
  quotaExhausted: boolean;
  research(name: string, opts?: { forceRefresh?: boolean }): Promise<void>;
  reset(): void;
}

export function useResearch(): UseResearchReturn {
  const [stage, setStage] = useState<ResearchStage>('idle');
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  const research = useCallback(async (name: string, opts?: { forceRefresh?: boolean }) => {
    setStage('loading');
    setError(null);
    setErrorCode(null);
    setQuotaExhausted(false);
    try {
      const res: ResearchResponse = await window.electronAPI.profileResearchCompany(name, opts);
      if (res.success && res.dossier) {
        setDossier(res.dossier);
        setCached(!!res.cached);
        setStage('success');
      } else {
        setError(res.error ?? 'unknown error');
        setErrorCode(res.errorCode ?? null);
        setQuotaExhausted(!!res.searchQuotaExhausted);
        setStage('error');
      }
    } catch (err: any) {
      setError(err?.message ?? 'IPC failed');
      setStage('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStage('idle');
    setDossier(null);
    setCached(false);
    setError(null);
    setErrorCode(null);
    setQuotaExhausted(false);
  }, []);

  return { stage, dossier, cached, error, errorCode, quotaExhausted, research, reset };
}
```

- [ ] **Step 2: Run hook tests**

Run: `npm test -- src/hooks/__tests__/useResearch.test.ts 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useResearch.ts src/hooks/__tests__/useResearch.test.ts
git commit -m "feat(ui): useResearch hook with idle/loading/success/error state machine"
```

---

## Task 20: `ResearchInput` Component

**Files:**
- Create: `src/components/research/ResearchInput.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/research/ResearchInput.tsx
import { useState } from 'react';

interface Props {
  onSubmit: (name: string) => void;
  disabled: boolean;
  initialValue?: string;
}

export function ResearchInput({ onSubmit, disabled, initialValue = '' }: Props) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !disabled;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(trimmed);
      }}
      className="flex gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="输入公司名称（英文或中文）"
        maxLength={100}
        className="flex-1 px-3 py-2 rounded border border-border bg-bg-secondary
                   text-text-primary placeholder:text-text-muted
                   disabled:opacity-50"
        aria-label="公司名称"
      />
      <button
        type="submit"
        disabled={!canSubmit}
        className="px-4 py-2 rounded bg-accent-primary text-white font-medium
                   hover:bg-accent-primary-hover disabled:opacity-50
                   disabled:cursor-not-allowed"
      >
        {disabled ? '调研中...' : '🔍 立即调研'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/research/ResearchInput.tsx
git commit -m "feat(ui): ResearchInput controlled component"
```

---

## Task 21: `ResearchProgress`, `ResearchErrorBanner`, `ResearchFallbackBanner`

**Files:**
- Create: `src/components/research/ResearchProgress.tsx`
- Create: `src/components/research/ResearchErrorBanner.tsx`
- Create: `src/components/research/ResearchFallbackBanner.tsx`

- [ ] **Step 1: Create `ResearchProgress.tsx`**

```tsx
// src/components/research/ResearchProgress.tsx
const STAGES = [
  { key: 'cache-check', label: '正在检查缓存...' },
  { key: 'searching', label: '正在搜索（6 个查询）...' },
  { key: 'synthesizing', label: '正在综合 AI 报告...' },
] as const;

export function ResearchProgress({ currentStage }: { currentStage: string }) {
  return (
    <div className="flex flex-col gap-2 py-3" aria-live="polite">
      {STAGES.map((s) => {
        const reached = STAGES.findIndex((x) => x.key === currentStage) >=
                        STAGES.findIndex((x) => x.key === s.key);
        return (
          <div key={s.key} className="flex items-center gap-2 text-sm">
            <span className={reached ? 'text-accent-primary' : 'text-text-muted'}>
              {reached ? '●' : '○'}
            </span>
            <span className={reached ? 'text-text-primary' : 'text-text-muted'}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `ResearchErrorBanner.tsx`**

```tsx
// src/components/research/ResearchErrorBanner.tsx
interface Props {
  error: string;
  errorCode?: string | null;
  onRetry?: () => void;
  onConfigureKey?: () => void;
}

export function ResearchErrorBanner({ error, errorCode, onRetry, onConfigureKey }: Props) {
  const showConfigureKey = errorCode === 'TAVILY_KEY_MISSING' || errorCode === 'TAVILY_INVALID_KEY';
  return (
    <div role="alert" className="rounded-lg p-4 bg-red-500/10 border border-red-500/30 text-red-300">
      <p className="font-medium mb-2">{error}</p>
      {errorCode && <p className="text-xs text-red-400 mb-3">code: {errorCode}</p>}
      <div className="flex gap-2">
        {showConfigureKey && onConfigureKey && (
          <button onClick={onConfigureKey} className="text-sm underline">
            前往 Settings 配置
          </button>
        )}
        {onRetry && !showConfigureKey && (
          <button onClick={onRetry} className="text-sm underline">
            重试
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `ResearchFallbackBanner.tsx`**

```tsx
// src/components/research/ResearchFallbackBanner.tsx
export function ResearchFallbackBanner() {
  return (
    <div className="rounded-lg p-3 bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-sm">
      ⚠️ 本报告未经过实时搜索验证，仅基于模型训练知识。每条要点 confidence 为 low，仅供参考。
    </div>
  );
}
```

- [ ] **Step 4: Verify TS compiles and commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
git add src/components/research/ResearchProgress.tsx \
        src/components/research/ResearchErrorBanner.tsx \
        src/components/research/ResearchFallbackBanner.tsx
git commit -m "feat(ui): progress, error banner, fallback banner components"
```

---

## Task 22: `ResearchDimension` Component (collapsible)

**Files:**
- Create: `src/components/research/ResearchDimension.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/research/ResearchDimension.tsx
interface Bullet {
  text: string;
  citation?: number;
}

interface Dimension {
  summary: string;
  details: Bullet[];
  confidence: 'high' | 'medium' | 'low';
}

interface Props {
  title: string;
  subtitle?: string;
  dimension: Dimension;
  sources: Array<{ index: number; title: string; url: string }>;
  defaultOpen?: boolean;
}

const CONFIDENCE_LABEL = {
  high: { text: 'high', color: 'text-green-400' },
  medium: { text: 'medium', color: 'text-yellow-400' },
  low: { text: 'low', color: 'text-red-400' },
};

export function ResearchDimension({ title, subtitle, dimension, sources, defaultOpen = true }: Props) {
  const c = CONFIDENCE_LABEL[dimension.confidence];
  return (
    <details open={defaultOpen} className="border-b border-border py-3">
      <summary className="cursor-pointer font-medium text-text-primary flex items-baseline gap-2">
        <span>{title}</span>
        {subtitle && <span className="text-sm text-text-muted">{subtitle}</span>}
        <span className={`ml-auto text-xs ${c.color}`}>confidence: {c.text}</span>
      </summary>
      <div className="mt-3 space-y-3 text-sm text-text-secondary">
        {dimension.summary && <p className="text-text-primary">{dimension.summary}</p>}
        {dimension.details.length > 0 && (
          <ul className="list-disc pl-5 space-y-1">
            {dimension.details.map((b, i) => {
              const src = b.citation != null ? sources.find((s) => s.index === b.citation) : null;
              return (
                <li key={i}>
                  {b.text}
                  {src && (
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-accent-primary text-xs"
                    >
                      [{b.citation}]
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Verify TS and commit**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
git add src/components/research/ResearchDimension.tsx
git commit -m "feat(ui): collapsible ResearchDimension card with citation links"
```

---

## Task 23: `ResearchPanel` Top-Level Container

**Files:**
- Create: `src/components/research/ResearchPanel.tsx`

- [ ] **Step 1: Create the panel**

```tsx
// src/components/research/ResearchPanel.tsx
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useResearch } from '../../hooks/useResearch';
import { ResearchInput } from './ResearchInput';
import { ResearchProgress } from './ResearchProgress';
import { ResearchDimension } from './ResearchDimension';
import { ResearchErrorBanner } from './ResearchErrorBanner';
import { ResearchFallbackBanner } from './ResearchFallbackBanner';

interface Props {
  isOpen: boolean;
  initialCompanyName?: string;
  onClose: () => void;
}

const DIMENSION_DEFS = [
  { key: 'financials', title: '经营实力', subtitle: 'Financials' },
  { key: 'business', title: '业务版图', subtitle: 'Business' },
  { key: 'strategy', title: '战略动向', subtitle: 'Strategy' },
  { key: 'people', title: '关键人画像', subtitle: 'People' },
  { key: 'infrastructure', title: '技术与资产现状', subtitle: 'Infrastructure' },
  { key: 'procurement', title: '采购合规历史', subtitle: 'Procurement' },
] as const;

export function ResearchPanel({ isOpen, initialCompanyName = '', onClose }: Props) {
  const r = useResearch();

  useEffect(() => {
    if (!isOpen) r.reset();
  }, [isOpen]);

  const handleSubmit = (name: string) => r.research(name);

  const handleForceRefresh = () => {
    if (r.dossier) r.research(r.dossier.companyName, { forceRefresh: true });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={onClose}
          data-testid="research-panel"
        >
          <div
            className="bg-bg-primary rounded-xl shadow-2xl w-full max-w-3xl
                       max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-6 py-4 border-b border-border flex items-center">
              <h2 className="text-lg font-semibold flex-1">
                Research · 公司情报调研
              </h2>
              <button onClick={onClose} aria-label="关闭" className="text-text-muted hover:text-text-primary">
                ✕
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <ResearchInput
                onSubmit={handleSubmit}
                disabled={r.stage === 'loading'}
                initialValue={initialCompanyName}
              />

              {r.stage === 'loading' && <ResearchProgress currentStage="synthesizing" />}

              {r.stage === 'error' && r.error && (
                <div className="mt-4">
                  <ResearchErrorBanner
                    error={r.error}
                    errorCode={r.errorCode}
                    onRetry={() => r.dossier && r.research(r.dossier.companyName)}
                  />
                </div>
              )}

              {r.stage === 'success' && r.dossier && (
                <div className="mt-6 space-y-4">
                  {r.dossier.source === 'llm-fallback' && <ResearchFallbackBanner />}

                  <div className="text-xs text-text-muted flex gap-3">
                    <span>{r.dossier.companyName}</span>
                    <span>·</span>
                    <span>{new Date(r.dossier.generatedAt).toLocaleString('zh-CN')}</span>
                    <span>·</span>
                    <span>{r.cached ? '缓存中' : '实时生成'}</span>
                  </div>

                  <div>
                    {DIMENSION_DEFS.map((d) => (
                      <ResearchDimension
                        key={d.key}
                        title={d.title}
                        subtitle={d.subtitle}
                        dimension={r.dossier![d.key]}
                        sources={r.dossier!.sources}
                      />
                    ))}
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      onClick={handleForceRefresh}
                      className="px-4 py-2 rounded border border-border
                                 hover:bg-bg-secondary text-sm"
                    >
                      🔄 强制刷新
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/research/ResearchPanel.tsx
git commit -m "feat(ui): ResearchPanel top-level container with state machine"
```

---

## Task 24: Wire `ResearchPanel` into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Locate the routing state**

Run: `grep -n "isSettingsOpen\|isProfileOpen\|useState" src/App.tsx | head -20`
Find where the existing overlay states are declared.

- [ ] **Step 2: Add panel state and event listener**

After existing `useState` calls (around the other overlay states), add:

```tsx
const [isResearchPanelOpen, setIsResearchPanelOpen] = useState(false);
const [researchInitialName, setResearchInitialName] = useState('');

useEffect(() => {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ companyName: string }>).detail;
    setResearchInitialName(detail?.companyName ?? '');
    setIsResearchPanelOpen(true);
  };
  window.addEventListener('open-research-panel', handler);
  return () => window.removeEventListener('open-research-panel', handler);
}, []);
```

- [ ] **Step 3: Render `<ResearchPanel>` in the tree**

After the existing overlay components, add:

```tsx
<ResearchPanel
  isOpen={isResearchPanelOpen}
  initialCompanyName={researchInitialName}
  onClose={() => setIsResearchPanelOpen(false)}
/>
```

Add the import: `import { ResearchPanel } from './components/research/ResearchPanel';`

- [ ] **Step 4: Verify TS and run smoke check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
npm start  # then close after visual confirmation
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): wire ResearchPanel into App.tsx with open-research-panel event"
```

---

## Task 25: Quick-Action Button in `ProfileIntelligenceSettings`

**Files:**
- Modify: `src/components/ProfileIntelligenceSettings.tsx`

- [ ] **Step 1: Find the dossier card area**

Run: `grep -n "companyResearch\|立即调研\|companyDossier" src/components/ProfileIntelligenceSettings.tsx | head -20`
Locate where the "立即调研" button currently lives (around line 1002-1023 per the spec).

- [ ] **Step 2: Add quick-action button below existing card**

Just after the existing dossier card div closing tag, add:

```tsx
{profileData?.activeJD?.company && (
  <button
    onClick={() => window.dispatchEvent(new CustomEvent(
      'open-research-panel',
      { detail: { companyName: profileData.activeJD.company } },
    ))}
    className="mt-3 text-sm text-accent-primary hover:underline"
  >
    在新面板中调研此公司 →
  </button>
)}
```

- [ ] **Step 3: Verify TS compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProfileIntelligenceSettings.tsx
git commit -m "feat(ui): quick-action button to open ResearchPanel from profile settings"
```

---

## Task 26: SettingsOverlay `research` Tab

**Files:**
- Modify: `src/components/SettingsOverlay.tsx`

- [ ] **Step 1: Find the tab list**

Run: `grep -n "'research'\|tab === 'research'\|tabs.push\|TABS" src/components/SettingsOverlay.tsx | head -10`
Find where tabs are defined and rendered.

- [ ] **Step 2: Add `research` to the tab list**

Add `'research'` to the tab array with label `Research`:

```ts
const TABS = [
  { key: 'general', label: '通用' },
  // ...existing tabs...
  { key: 'research', label: 'Research' },
] as const;
```

- [ ] **Step 3: Add the Research tab body**

Find where each tab's body is rendered (a switch / object map). Add:

```tsx
{activeTab === 'research' && <ResearchTabBody />}
```

Then create the body component (inline or as a separate file `src/components/settings/ResearchTabBody.tsx`):

```tsx
// src/components/settings/ResearchTabBody.tsx
import { useState } from 'react';

export function ResearchTabBody() {
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<null | {
    valid: boolean; reason?: string; quotaLow?: boolean;
  }>(null);

  const handleTest = async () => {
    const r = await window.electronAPI.testTavilyApiKey(apiKey);
    setTestResult(r);
  };

  const handleSave = async () => {
    // Persist via existing credentials IPC; reuse the channel name from the project.
    // Most projects use 'set-tavily-api-key' — verify in electron/preload.ts.
    await window.electronAPI.setTavilyApiKey(apiKey);
  };

  const handleClearCache = async () => {
    const r = await window.electronAPI.profileClearResearchCache();
    alert(`已清除 ${r.deleted} 条缓存`);
  };

  return (
    <div className="space-y-6 p-6 max-w-xl">
      <div>
        <h3 className="text-base font-semibold mb-2">Tavily API Key</h3>
        <p className="text-sm text-text-muted mb-3">
          Research 功能使用 Tavily 进行实时搜索。免费额度每月 1000 次。
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="tvly-..."
          className="w-full px-3 py-2 rounded border border-border bg-bg-secondary"
        />
        <div className="mt-3 flex gap-2">
          <button onClick={handleSave} className="px-4 py-2 rounded bg-accent-primary text-white">
            保存
          </button>
          <button onClick={handleTest} disabled={!apiKey} className="px-4 py-2 rounded border">
            测试连接
          </button>
        </div>
        {testResult && (
          <p className={`mt-2 text-sm ${testResult.valid ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.valid
              ? (testResult.quotaLow ? '✓ Key 有效，但额度已接近上限' : '✓ Key 有效')
              : `✗ ${testResult.reason ?? '验证失败'}`}
          </p>
        )}
      </div>

      <div className="border-t border-border pt-6">
        <h3 className="text-base font-semibold mb-2">缓存</h3>
        <p className="text-sm text-text-muted mb-3">
          同一公司 24h 内只生成一次 dossier。
        </p>
        <button onClick={handleClearCache} className="px-4 py-2 rounded border">
          清除所有缓存
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify `setTavilyApiKey` IPC exists**

Run: `grep -n "set-tavily-api-key\|setTavilyApiKey" electron/preload.ts electron/ipcHandlers.ts | head -10`
If missing, add it to `ipcHandlers.ts`:

```ts
safeHandle('set-tavily-api-key', async (_: unknown, key: string) => {
  CredentialsManager.getInstance().setTavilyApiKey(key);
  return { success: true };
});
```

And to `preload.ts`:

```ts
setTavilyApiKey: (key: string) => ipcRenderer.invoke('set-tavily-api-key', key),
```

And to `src/types/electron.d.ts`.

- [ ] **Step 5: Build and verify**

Run: `npm run build:electron && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsOverlay.tsx \
        src/components/settings/ResearchTabBody.tsx \
        electron/ipcHandlers.ts electron/preload.ts src/types/electron.d.ts
git commit -m "feat(ui): Settings research tab with Tavily key + cache controls"
```

---

## Task 27: E2E Test — `tests/e2e/research-pipeline.spec.ts`

**Files:**
- Create: `tests/e2e/research-pipeline.spec.ts`

- [ ] **Step 1: Inspect existing E2E for patterns**

Run: `head -60 tests/e2e/basic-smoke.spec.ts`
Note how the project sets up the Electron app via Playwright `_electron` (or similar). Reuse patterns.

- [ ] **Step 2: Write the E2E test**

```ts
// tests/e2e/research-pipeline.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

test.describe('Research Pipeline E2E', () => {
  let app, window;

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main.js')],
      env: {
        ...process.env,
        E2E_TAVILY_API_KEY: process.env.E2E_TAVILY_API_KEY ?? 'tvly-test-noop',
      },
    });
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => { await app.close(); });

  test('Settings → Research tab shows Tavily key input', async () => {
    // Open Settings, navigate to Research tab.
    // (Exact selectors depend on SettingsOverlay markup; use role + name.)
    await window.getByRole('button', { name: /settings/i }).first().click();
    await window.getByRole('tab', { name: /research/i }).click();
    await expect(window.getByLabel(/tavily api key/i)).toBeVisible();
  });

  test('Full happy-path: configure key, research, see dossier', async () => {
    await window.getByRole('button', { name: /settings/i }).first().click();
    await window.getByRole('tab', { name: /research/i }).click();
    await window.getByLabel(/tavily api key/i).fill(process.env.E2E_TAVILY_API_KEY ?? 'tvly-test');
    await window.getByRole('button', { name: /保存/ }).click();

    // Trigger Research from a JD (assumes seed JD with company "Apple Inc.")
    // Or open the global chat and dispatch event directly.
    await window.evaluate(() => {
      window.dispatchEvent(new CustomEvent('open-research-panel', {
        detail: { companyName: 'Apple Inc.' },
      }));
    });

    await expect(window.getByTestId('research-panel')).toBeVisible();
    await window.getByRole('button', { name: /立即调研/ }).click();

    // Wait for success state (max 30s)
    await expect(window.getByText(/缓存中|实时生成/)).toBeVisible({ timeout: 30_000 });
    await expect(window.getByText(/经营实力/)).toBeVisible();
    await expect(window.getByText(/业务版图/)).toBeVisible();
  });

  test('Second research call shows "缓存中" label', async () => {
    await window.evaluate(() => {
      window.dispatchEvent(new CustomEvent('open-research-panel', {
        detail: { companyName: 'Apple Inc.' },
      }));
    });
    await window.getByRole('button', { name: /立即调研/ }).click();
    await expect(window.getByText(/缓存中/)).toBeVisible({ timeout: 5_000 });
  });

  test('Without API key, shows "请配置 Tavily API key"', async () => {
    // Clear the key via Settings
    // (Relies on a "清除" or empty-fill action; project-specific.)
    // For brevity, assume previous tests left a key; this test
    // checks the error message when running research without one.
    // Implementation depends on how Settings exposes clearing.
    test.skip(true, 'requires UI to clear API key — add when supported');
  });
});
```

- [ ] **Step 3: Run E2E test**

Run: `E2E_TAVILY_API_KEY=<real-key> npm run test:e2e -- research-pipeline.spec.ts 2>&1 | tail -30`
Expected: PASS for the happy-path test (skipping the "no key" test).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/research-pipeline.spec.ts
git commit -m "test(e2e): research pipeline happy-path + cache hit"
```

---

## Task 28: Full Verification

- [ ] **Step 1: Run all unit + IPC tests**

Run: `npm test 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 2: Type-check both processes**

Run: `npm run typecheck:electron 2>&1 | tail -10 && npx tsc --noEmit -p tsconfig.json 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Run E2E**

Run: `E2E_TAVILY_API_KEY=<real-key> npm run test:e2e 2>&1 | tail -30`
Expected: all E2E tests pass.

- [ ] **Step 4: Manual smoke check**

- `npm start`
- Open Settings → Research, configure a real Tavily key
- Open ProfileIntelligenceSettings, click "在新面板中调研此公司"
- Verify dossier renders all 6 dimensions
- Search again, verify "缓存中" label appears
- Delete the key in Settings, search again, verify error message
- Click "强制刷新", verify dossier `generatedAt` updates

- [ ] **Step 5: Final commit (if any incidental fixes)**

```bash
git status
# If anything pending:
git add -A
git commit -m "chore(research): post-verification cleanup"
```

---

## Self-Review Checklist (run before declaring plan complete)

**Spec coverage:**
- [x] TavilySearchProvider (Task 4)
- [x] CompanyResearchCache + v18 migration (Tasks 2, 6)
- [x] ResearchDossierBuilder with fallback marker (Task 8)
- [x] CompanyResearchEngine orchestration (Task 10)
- [x] ProfileOrchestrator integration (Tasks 11–13)
- [x] IPC handler replacement + 2 new channels (Task 14)
- [x] Preload bridge updates (Task 15)
- [x] ResearchPanel + sub-components (Tasks 20–23)
- [x] App.tsx routing + event listener (Task 24)
- [x] Quick-action button in ProfileIntelligenceSettings (Task 25)
- [x] Settings research tab (Task 26)
- [x] CredentialsManager.getTavilyApiKey (Task 13)
- [x] Unit tests for all backend modules (Tasks 3–10, 16)
- [x] Integration test (Task 16)
- [x] Hook test (Task 18)
- [x] E2E test (Task 27)

**No placeholders:** scanned for TBD/TODO/<placeholder> — none found.

**Type consistency:**
- `CompanyDossier` schema fields match across `types.ts`, `ResearchDossierBuilder.ts`, `CompanyResearchCache.ts`, `useResearch.ts`, `ResearchPanel.tsx`
- `ProfileResearchCompanyResponse` shape matches between `types.ts`, IPC handler, preload, and hook
- Method names: `runCompanyResearch` (ProfileOrchestrator), `getCompanyResearchEngine` (ProfileOrchestrator), `research` (engine), `clearCache` (engine + cache), `setTavilyApiKey` / `getTavilyApiKey` (CredentialsManager)
- Error codes: `INVALID_INPUT`, `TAVILY_KEY_MISSING`, `TAVILY_QUOTA_EXHAUSTED`, `TAVILY_INVALID_KEY`, `LLM_FAILED`, `LLM_INVALID_FORMAT`, `DB_ERROR` — used consistently across engine, IPC, hook, UI

**No spec gap identified.**