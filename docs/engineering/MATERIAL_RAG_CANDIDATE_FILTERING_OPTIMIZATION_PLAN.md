# Material RAG Candidate Filtering Optimization Plan

## Summary

Optimize the existing Material RAG candidate filtering path without adding a new technology stack. The goal is to improve uploaded-material relevance across all modes while preserving realtime response speed.

The current path already uses SQLite, uploaded material chunks, lexical scoring, embedding-backed hybrid scoring, and context planning. This plan keeps that architecture and improves the first-stage candidate recall/ranking quality before Material RAG scoring.

This is the recommended first-stage design under the current constraints. It is not the maximum possible relevance design in absolute terms; a live LLM reranker may improve quality later, but it is intentionally excluded from the realtime click path in this pass.

## Goals

- Improve candidate relevance for all modes, not only Sales.
- Avoid new infrastructure such as Elasticsearch, OpenSearch, external rerankers, vector databases, or new LLM planner calls on the realtime path.
- Keep added local candidate filtering latency small, with a target incremental P95 under 20 ms.
- Preserve existing degraded behavior when uploaded material, embeddings, RAG, or `reference_files` provider scope is unavailable.
- Preserve candidate recall first. Strong query terms should increase rank and candidate priority; they must not become hard all-term filters that drop useful material too early.

## Key Changes

### 1. Add Shared Material Query Analysis

Introduce a shared local query analyzer for uploaded-material retrieval.

It should parse the existing structured retrieval query fields:

- `mode`
- `intent`
- `entities`
- `language`
- `latestTurn`

It should produce:

- `strongTerms`: high-value terms that should drive candidate recall and ranking. These are not mandatory AND filters.
- `optionalTerms`: useful secondary terms.
- `downrankTerms`: terms that should not dominate ranking.

For example, for:

```text
mode:sales
intent:case_study_request
entities:今天, 价格, 案例
language:zh
latestTurn:我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例
```

Expected analysis:

```text
strongTerms: 力学仿真模块, 力学仿真, 仿真模块, 仿真
optionalTerms: 功能, 产品适配, 适合, 案例
downrankTerms: 今天, 价格
```

The analyzer should be mode-agnostic. Mode and intent are hints for weighting, not branches that hardcode Sales-only behavior.

Parsing rules:

- Parse the structured fields first, then extract retrieval terms primarily from `latestTurn` and trusted `entities`.
- Do not tokenize the whole serialized retrieval query as free text. Metadata such as `mode:sales`, `intent:case_study_request`, and `language:zh` must not become normal candidate terms.
- `mode` and `intent` may apply small weighting hints, but they must not dominate candidate filtering.
- Preserve high-signal phrases before generic n-grams when a term cap is applied. Long phrases, technical nouns, acronyms, and extracted entities should enter the term list before weak two-character windows.
- Locally negated terms should be downranked, not deleted. For example, `价格` in `先不谈价格` should not make pricing material rank first, but it may still be useful as conversation context.

### 2. Improve SQLite Candidate Filtering Without New Infra

Keep the existing SQLite `LIKE`-based candidate retrieval, but make candidate selection more structured.

- First query with `strongTerms` and useful `optionalTerms`.
- Prefer rows matching title or file name over rows matching only body text.
- Prefer parent text matches over isolated child chunk matches.
- If the structured pass returns too few rows, fall back to the existing broad candidate logic.
- Keep `candidateLimit` bounded by the existing cap.

Do not rely only on TypeScript scoring after rows are returned. Today the DB can apply `LIMIT` before in-memory ranking, which can cut off older but more relevant title/file matches. The candidate query must either:

- add a cheap SQL match tier before `LIMIT`, using `CASE`-style scoring for title, file name, parent text, and body text matches; or
- run small bounded per-field queries, then merge and dedupe in TypeScript before the final candidate limit.

No schema migration is required. This pass must not introduce SQLite FTS5.

Recommended two-pass candidate shape:

```text
Material query
  |
  v
MaterialQueryAnalysis
  |
  +--> strongTerms
  +--> optionalTerms
  +--> downrankTerms
  |
  v
SQLite candidate retrieval
  |
  +--> Pass A: bounded structured LIKE query with match tier before LIMIT
  |
  +--> Pass B: if Pass A returns too few rows, fill from existing broad fallback
  |
  v
Weighted lexical / hybrid scoring
```

### 3. Improve Lexical Scoring

Extend lexical scoring to support weighted query terms.

- Downweight metadata terms such as `mode:sales`, `language:zh`, and generic intent labels.
- Downweight generic terms such as `案例`, `资料`, `功能`, `产品`, unless paired with stronger terms.
- Upweight long Chinese phrases, proper nouns, uppercase technical tokens, and extracted entities.
- Downweight locally negated terms such as `价格` in `先不谈价格`.
- Keep the existing embedding-backed hybrid path. Weighted lexical scoring should improve candidate quality for both embedding-ready and embedding-unavailable paths.

Hybrid scoring should keep the existing structure:

```text
finalScore = lexicalWeight * lexicalScore + vectorWeight * vectorScore
```

The implementation should only make lexical scoring more precise; it should not remove embedding-backed retrieval.

### 4. Preserve Realtime Behavior

The realtime generation path must not add synchronous LLM planner or LLM reranker calls.

Allowed operations on the realtime path:

- local string parsing
- term weighting
- SQLite candidate retrieval
- existing lexical/hybrid scoring
- existing contribution cache

Disallowed for this plan:

- extra LLM call before Material RAG
- external reranker
- new DB engine
- schema migration
- SQLite FTS5
- large candidate-limit increase

## Expected Behavior

For the force-simulation example:

```text
我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例。
```

Relevant uploaded material should rank higher when it contains:

- force simulation module details
- mechanical simulation / CAE / FEA / structural analysis content
- product fit or application scenario discussion
- customer case, implementation case, proof point, or validation example related to the module

Material should rank lower when it only contains:

- pricing tables
- generic Sales wording
- generic product overview with no force-simulation relation
- unrelated case studies from another domain
- weak terms such as `今天`, `价格`, or bare `案例`

## Test Plan

### Unit Tests

- Query analysis extracts strong terms from Chinese, English, and mixed-language queries.
- Negated terms are downweighted without deleting unrelated useful terms.
- Generic terms are downweighted across all modes.
- Mode metadata and intent metadata do not dominate retrieval.
- Term caps preserve high-signal phrases before weak n-grams or metadata terms.
- `strongTerms` are treated as ranking signals, not mandatory all-term filters.

### Retrieval Tests

- A chunk containing `力学仿真模块` outranks a chunk containing only `案例`.
- A chunk containing `先不谈价格` does not cause pricing material to outrank force-simulation material.
- Title and file-name matches outrank body-only matches when scores are otherwise similar.
- Title, file-name, and parent-text matches are not lost before `candidateLimit` is applied.
- If no structured terms match, retrieval falls back to existing broad candidate behavior.
- Embedding-ready hybrid search still works.
- Embedding-unavailable lexical fallback still works.
- Cross-mode negative fixtures prove generic terms such as `案例`, `产品`, `资料`, and `功能` do not outrank mode-specific terms in every mode template.

### Cross-Mode Fixtures

Add or update fixtures for all 8 mode templates:

- General: document-backed clarification or explanation lookup.
- Looking-for-work: behavioral interview answer backed by resume/project material.
- Sales: force simulation feature fit and case request.
- FDE: Windchill/QMS integration, permissions, and read-only boundary.
- Recruiting: candidate evidence, role requirement, and risk signal lookup.
- Team-meet: action item, decision, and risk material lookup.
- Lecture: concept, definition, formula, or reading material lookup.
- Technical-interview: coding, algorithm, system design, or API reference lookup.

Each mode fixture must include:

- one positive material that should rank in the top results;
- one generic material that shares weak terms but should rank lower;
- one unrelated material that should not be selected;
- one metadata-heavy retrieval query proving `mode`, `intent`, and `language` fields do not dominate scoring.

Measure:

- `Recall@20`
- `Precision@5`
- `no_relevant_uploaded_material`
- local candidate filtering latency

### Performance Benchmarks

Benchmark the local candidate filtering path before and after the change with realistic fixture data:

- 0 chunks
- 50 chunks
- 200 chunks
- 1000 chunks

Run each dataset in both modes:

- embedding-ready hybrid scoring
- embedding-unavailable lexical fallback

Acceptance targets:

- Query analysis plus DB candidate retrieval incremental P95 under 20 ms.
- Total Material RAG local retrieval P95 must not regress by more than 10% at 200 candidates.
- The benchmark report must show the slowest segment: query analysis, SQLite candidate retrieval, lexical scoring, hybrid embedding work, or fallback fill.

### Regression Coverage Diagram

Implementation should cover this path:

```text
accepted dynamic action card
  |
  v
uploaded material contribution
  |
  v
MaterialQueryAnalysis
  |
  +--> metadata parsed but not treated as normal search text
  +--> strong terms protected from term-cap truncation
  +--> negated and generic terms downweighted
  |
  v
SQLite candidate filtering
  |
  +--> structured pass with match tier before LIMIT
  +--> fallback fill when structured pass is sparse
  |
  v
MaterialRagRetriever
  |
  +--> embedding-ready hybrid scoring
  +--> embedding-unavailable lexical fallback
  |
  v
citations / uploaded material context / no_relevant_uploaded_material
```

## Assumptions

- The implementation stays inside the current Material RAG stack.
- No new runtime dependency is added.
- No schema migration is required.
- The dynamic action trigger and semantic gate behavior are unchanged.
- LLM planner/reranker can be reconsidered later for offline, speculative, or quality-first paths, but is not part of this realtime optimization.

## Not In Scope

- Realtime LLM planner or LLM reranker before Material RAG. This may improve relevance later, but it conflicts with the current click-path latency target.
- Elasticsearch, OpenSearch, external vector databases, or external reranker services.
- SQLite FTS5 or any schema migration.
- Dynamic action trigger, semantic gate, or action-card UI changes.
- New product operations panels or new retrieval UI.
