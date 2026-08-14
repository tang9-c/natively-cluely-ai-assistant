# Global Meeting Search Chinese Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make global meeting search reliably retrieve exact Chinese phrases from old meetings and raw transcripts without losing semantic-search fallback behavior.

**Architecture:** Keep the existing hybrid retrieval pipeline, but separate the raw user query from the intent-enriched embedding query. Preserve exact lexical candidates ahead of recency-ranked semantic candidates, continue lexical retrieval when embeddings fail, and make transcript preprocessing recognize meaningful CJK text without whitespace tokenization.

**Tech Stack:** TypeScript, Electron, Node test runner, better-sqlite3, existing RAGRetriever/VectorStore pipeline.

## Global Constraints

- Do not change database schema, renderer UI, prompts, provider routing, or citation shape.
- Do not add a tokenizer dependency.
- Do not log raw queries, transcript text, prompts, or credentials.
- Exact evidence must still fit the existing `maxTokens` budget.
- Preserve English noise filtering and semantic retrieval when no exact phrase exists.
- Work on the current branch and preserve the user-owned `.tmp/`.

## File Map

- Modify `electron/rag/TranscriptPreprocessor.ts`: CJK-aware content filtering.
- Modify `electron/rag/RAGRetriever.ts`: query separation, embedding degradation, exact-candidate ordering.
- Create `electron/rag/__tests__/TranscriptPreprocessorChinese.test.mjs`.
- Create `electron/rag/__tests__/GlobalMeetingSearchChineseRecall.test.mjs`.

---

### Task 1: Preserve meaningful Chinese transcript segments

**Files:**
- Modify: `electron/rag/TranscriptPreprocessor.ts:159-186`
- Create: `electron/rag/__tests__/TranscriptPreprocessorChinese.test.mjs`

**Interfaces:**
- Consumes: `preprocessTranscript(segments: RawSegment[]): CleanedSegment[]`
- Produces: unchanged interface; CJK text with at least two meaningful characters survives.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { preprocessTranscript } = await import(
  pathToFileURL(path.resolve('dist-electron/electron/rag/TranscriptPreprocessor.js')).href
);
const segment = (text) => [{ speaker: '我', text, timestamp: 1_000 }];

test('keeps meaningful Chinese text without whitespace', () => {
  for (const text of ['数字化移交', '手术机器人', '机器人行业解决方案']) {
    assert.equal(preprocessTranscript(segment(text)).length, 1, text);
  }
});

test('still removes one-character CJK noise and short English text', () => {
  assert.equal(preprocessTranscript(segment('啊')).length, 0);
  assert.equal(preprocessTranscript(segment('go now')).length, 0);
});

test('keeps meaningful mixed-language text with one CJK character', () => {
  assert.equal(preprocessTranscript(segment('AI 在 production is unavailable')).length, 1);
  assert.equal(preprocessTranscript(segment('啊 hello')).length, 0);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/rag/__tests__/TranscriptPreprocessorChinese.test.mjs
```

Expected: the meaningful-Chinese test fails because whitespace counting reports one word.

- [ ] **Step 3: Implement the minimum predicate**

```ts
function hasMeaningfulContent(text: string): boolean {
    const cjkCount = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
    if (cjkCount >= 2) return true;
    return text.split(/\s+/).filter(Boolean).length >= 3;
}
```

Replace the current word-count branch with `if (!hasMeaningfulContent(text)) continue;`.

- [ ] **Step 4: Rebuild and verify GREEN**

Run the Step 2 commands. Expected: 2 tests pass, 0 fail.

---

### Task 2: Use the raw query and survive embedding failure

**Files:**
- Modify: `electron/rag/RAGRetriever.ts:182-242`
- Create: `electron/rag/__tests__/GlobalMeetingSearchChineseRecall.test.mjs`

**Interfaces:**
- Consumes: `retrieveGlobal(query, options)` and `searchLexicalMeetings(queryText, options)`.
- Produces: unchanged `RetrievedContext`; transcript fallback receives raw query and lexical retrieval survives embedding failure.

- [ ] **Step 1: Write failing behavior tests**

Create fixtures implementing `searchLexical`, `searchLexicalMeetings`, `searchSimilar`, `searchSummaries`, `isReady`, `getEmbeddingForQuery`, and `getActiveSpaceKey`, then add:

```js
test('global transcript fallback receives the raw Chinese query', async () => {
  const seen = [];
  const retriever = createRetriever({
    embeddingReady: false,
    meetingFallback(query) {
      seen.push(query);
      return [chunk(90, 'old-meeting', '数字化移交')];
    },
  });
  const result = await retriever.retrieveGlobal('数字化移交');
  assert.deepEqual(seen, ['数字化移交']);
  assert.match(result.formattedContext, /数字化移交/);
});

test('global lexical retrieval continues when query embedding throws', async () => {
  const retriever = createRetriever({
    embeddingReady: true,
    embeddingError: new Error('expected embedding failure'),
    lexical: [chunk(91, 'old-meeting', '手术机器人有 15000 个零件')],
  });
  const result = await retriever.retrieveGlobal('手术机器人');
  assert.match(result.formattedContext, /手术机器人/);
});
```

- [ ] **Step 2: Verify RED**

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/rag/__tests__/GlobalMeetingSearchChineseRecall.test.mjs
```

Expected: current code returns before lexical fallback when embeddings are unavailable or throw.

- [ ] **Step 3: Implement optional semantic retrieval**

Use a nullable query embedding:

```ts
let queryEmbedding: number[] | null = null;
if (this.embeddingPipeline.isReady()) {
    try {
        queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(retrievalQuery);
    } catch {
        console.warn('[RAGRetriever] Semantic global retrieval unavailable', {
            errorType: 'embedding_query_failed',
        });
    }
}
```

Only call vector and summary searches when the embedding exists. Always call:

```ts
const lexicalChunkResults = await this.vectorStore.searchLexical(retrievalQuery, {
    limit: topK * 2,
});
const meetingFallbackResults = await this.vectorStore.searchLexicalMeetings(query, {
    limit: topK,
});
```

- [ ] **Step 4: Rebuild and verify GREEN**

Run Step 2. Expected: query separation and degradation tests pass with no raw error logging.

---

### Task 3: Reserve slots for exact old-meeting matches

**Files:**
- Modify: `electron/rag/RAGRetriever.ts:244-267`
- Modify: `electron/rag/__tests__/GlobalMeetingSearchChineseRecall.test.mjs`

**Interfaces:**
- Consumes: ranked `ScoredChunk[]` and raw `query`.
- Produces: budget-fitting exact matches ordered before non-exact candidates.

- [ ] **Step 1: Add the failing ranking test**

```js
test('old exact Chinese phrase survives Top-K against recent semantic matches', async () => {
  const now = Date.now();
  const recentWeak = Array.from({ length: 8 }, (_, index) => ({
    ...chunk(index + 1, `recent-${index}`, `近期无关候选 ${index}`, 0.5),
    absoluteStartMs: now,
  }));
  const exactOld = {
    ...chunk(100, 'meeting-2024', '康乐斯团的手术机器人有 15000 个零件', 1),
    absoluteStartMs: Date.UTC(2024, 0, 1),
    lexicalScore: 1,
    vectorScore: 0,
  };
  const retriever = createRetriever({
    embeddingReady: true,
    vector: recentWeak,
    lexical: [exactOld],
  });
  const result = await retriever.retrieveGlobal('手术机器人', { topK: 8 });
  assert.ok(result.chunks.some((item) => item.id === exactOld.id));
});
```

- [ ] **Step 2: Verify RED**

Run the Task 2 test command. Expected: eight recent medium-similarity chunks displace the old exact chunk.

- [ ] **Step 3: Implement exact-first ordering**

```ts
const normalizedExactQuery = query.trim().toLocaleLowerCase();
const exactCandidates = normalizedExactQuery
    ? ranked.filter((chunk) => chunk.text.toLocaleLowerCase().includes(normalizedExactQuery))
    : [];
const exactIds = new Set(exactCandidates.map((chunk) => chunk.id));
const orderedCandidates = [
    ...exactCandidates,
    ...ranked.filter((chunk) => !exactIds.has(chunk.id)),
];
```

Iterate over `orderedCandidates` in the existing token-budget loop. Do not bypass `maxTokens` or change `topK`.
When a candidate does not fit, `continue` scanning instead of terminating the loop so a later smaller exact candidate can still be selected.

- [ ] **Step 4: Rebuild and verify GREEN**

Run the Task 2 command. Expected: all tests in the file pass.

---

### Task 4: Exercise real SQLite fallback for all reported phrases

**Files:**
- Modify: `electron/rag/__tests__/GlobalMeetingSearchChineseRecall.test.mjs`

**Interfaces:**
- Consumes: `VectorStore.searchLexicalMeetings(queryText, { limit })`.
- Produces: behavior proof against real in-memory SQLite without chunk rows.

- [ ] **Step 1: Add the database test**

Create tables `meetings(id, title, summary_json, start_time, created_at)` and `transcripts(id, meeting_id, content, timestamp_ms)`, then add:

```js
test('global retrieval finds every reported Chinese phrase from raw transcripts without chunks', async () => {
  const db = createSearchDatabase();
  const store = Object.create(VectorStore.prototype);
  store.db = db;
  const retriever = createRetriever({
    embeddingReady: false,
    meetingFallback: (query, options) => store.searchLexicalMeetings(query, options),
  });

  for (const phrase of ['数字化移交', '手术机器人', '机器人']) {
    const result = await retriever.retrieveGlobal(phrase);
    assert.match(result.formattedContext, new RegExp(phrase), phrase);
  }

  db.close();
});
```

Use only short, minimally redacted evidence derived from the supplied transcript.

- [ ] **Step 2: Run the behavior test**

Run the Task 2 command. Expected: PASS, documenting that the lower-level SQL works with raw phrases.

- [ ] **Step 3: Run focused RAG tests**

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/rag/__tests__/*.test.mjs
```

Expected: all RAG tests pass, 0 fail.

---

### Task 5: Full verification and graph refresh

**Files:**
- Verify all Task 1-4 files.
- Incrementally update the code graph.

**Interfaces:**
- Consumes: repository verification commands and code-review graph MCP.
- Produces: fresh test evidence and updated graph coverage.

- [ ] **Step 1: Type check**

```bash
npm run typecheck:electron
```

Expected: exit code 0.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass, 0 fail.

- [ ] **Step 3: Inspect the final workspace**

```bash
git diff --check
git diff -- electron/rag/TranscriptPreprocessor.ts electron/rag/RAGRetriever.ts electron/rag/__tests__/TranscriptPreprocessorChinese.test.mjs electron/rag/__tests__/GlobalMeetingSearchChineseRecall.test.mjs
git status --short
```

Expected: only task files plus pre-existing `.tmp/`.

- [ ] **Step 4: Refresh the graph**

Run `build_or_update_graph_tool` with this repository and `base=HEAD`, then query tests for the modified functions.

Expected: modified nodes and new tests appear.

- [ ] **Step 5: Report without committing production changes**

Report exact test counts and workspace state. Do not commit production changes unless separately requested.
