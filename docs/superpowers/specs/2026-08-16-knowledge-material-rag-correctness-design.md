# Knowledge Material RAG Correctness Design

## Problem

The uploaded-material RAG path violates six correctness invariants:

1. Stored embeddings are not bound to a provider/model/dimension space, so incompatible vectors can suppress lexical matches.
2. Material upload, deletion, and reindex do not invalidate the 60-second real-time context cache.
3. Reindex reconstructs source text by concatenating overlapping child chunks, which amplifies duplicated text on every run.
4. A partial batch embedding response still leaves the material marked `complete` with pending chunks.
5. Citation records are created for all retrieval hits even when the context budget omits some hits.
6. Two-character alphanumeric terms such as `AI` and `8D` are discarded before retrieval.

## Approved behavior

- Persist `embedding_provider`, `embedding_dimensions`, and `embedding_space` on each knowledge material through a database migration.
- Use a stored material embedding only when its material embedding space matches the active embedding space. Legacy or mismatched material vectors fall back to lexical retrieval until reindexed.
- Upload, delete, and successful reindex invalidate cached uploaded-material context immediately.
- Reindex reconstructs canonical text by removing only the known suffix/prefix overlap between adjacent chunks, making repeated reindex stable.
- Batch embedding output must contain exactly one valid vector per indexed chunk. A mismatch marks the material embedding queue failed while preserving a complete lexical index.
- Return citations only for candidates included in the final context plan.
- Accept exactly two-character alphanumeric terms while keeping single-character Latin noise excluded.
- Do not log material text, query text, filenames, embeddings, or credentials.

## Architecture and data flow

### Embedding-space ownership

`knowledge_materials` owns the embedding-space identity for all of its chunks. Indexing obtains the active identity from `EmbeddingPipeline`, embeds the complete batch, validates cardinality and vectors, stores chunk embeddings, and then stamps the material identity. A failed or partial batch does not stamp an identity.

Retrieval loads the material identity with each candidate. When the active identity is unavailable or does not match, the retriever ignores the stored vector. Lexical retrieval remains available in every case. Reindexing with the current provider replaces chunks and stamps the new identity only after a complete embedding batch.

### Cache invalidation

`WhatToSayContextPreparationService` exposes one production-safe material-cache invalidation method. Knowledge-material mutations call it after the database mutation becomes visible. This is process-local because the cache itself is process-local.

### Reindex reconstruction

Adjacent child chunks are merged by finding the longest exact suffix of the accumulated text that equals a prefix of the next chunk. If no overlap exists, chunks are joined with a paragraph separator. This uses stored chunks without requiring original uploaded files and avoids introducing a second canonical-text store.

### Retrieval output integrity

Context planning remains authoritative. Citation filtering uses the same `(sourceId, chunkId)` identity as candidate selection, both in direct contribution planning and in deferred `WhatToSay` planning.

## Error handling

- Legacy/mismatched embedding metadata: ignore vectors and use lexical ranking; do not fail the query.
- Partial, empty, or invalid embedding batch: mark all material embedding queue entries failed, keep textual material status `complete`, and leave embedding identity unset.
- Cache invalidation failure is impossible by design because it is an in-memory clear operation; material database mutations remain authoritative.
- Reindex overlap merging only removes exact adjacent overlap and never fuzzy-matches text.

## Testing

Each defect is implemented with a red-green TDD cycle:

- A stale same-dimensional embedding cannot suppress an exact lexical hit.
- Matching-space embeddings still participate in hybrid ranking.
- Upload, deletion, and reindex prevent reuse of cached material contributions.
- Repeated reindex preserves reconstructed content and chunk count.
- Partial batch embeddings produce failed embedding queue state and no material embedding-space stamp.
- Omitted context candidates produce no citations.
- `AI` and `8D` retrieve matching material; one-character Latin queries remain ignored.

Final verification includes the knowledge-material/RAG suites, database migration tests, Electron typecheck, production build, complete `npm test`, and `git diff --check`.

## Scope exclusions

- No changes to meeting transcript RAG ranking.
- No automatic background reindex of all legacy materials.
- No changes to token budgets, provider routing, UI, or database ownership of original uploaded files.
