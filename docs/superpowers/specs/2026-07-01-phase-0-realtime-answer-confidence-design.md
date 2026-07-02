# Phase 0 Realtime Answer Confidence Design

Date: 2026-07-01
Status: revised after adversarial review, ready for implementation planning
Source plan: `docs/engineering/PHASE_0_REALTIME_ANSWER_CONFIDENCE_PLAN.md`

## Goal

Make every realtime answer auditable, citable, and measurable without replacing the existing streaming architecture.

For each generated answer, the app must know:

- which context sources were actually eligible, attempted, used, omitted, or degraded
- which exact evidence chunks back each visible citation
- whether a citation can still be opened against the same source version
- whether the user saw, copied, accepted, ignored, or regenerated the answer
- whether a prompt, retrieval, memory, or context-selection change improved groundedness

This phase must close the loop for realtime answers before adding more context sources. More context without orchestration, citations, and evals makes failures harder to explain.

## Non-Negotiable Scope

This phase covers three high-risk paths:

1. Unified retrieval orchestration for realtime answers.
2. Citable UI with citation-to-source validation.
3. Offline groundedness evaluation harness.

This phase does not rewrite RAG ingestion, replace streaming, add remote analytics, or add new enterprise connectors.

## Entry Contract

The single realtime answer entry remains the existing IPC channel:

```ts
ipcRenderer.invoke(
  'generate-what-to-say',
  question?: string,
  imagePaths?: string[],
  options?: {
    promptInstruction?: string;
    persist?: boolean;
    source?: 'overlay' | 'launcher' | 'dynamic_action';
    modeEvent?: ModeEventContext;
  }
)
```

Rules:

- Renderer code must not be allowed to pass raw `uploadedMaterialContext` or prebuilt citation context. The main process owns retrieval, citation construction, and scope enforcement.
- `question`, `imagePaths`, and `modeEvent` are untrusted renderer input and must be validated before retrieval or model calls.
- `source` is UI metadata only. It must not change provider policy or data scopes.
- Invalid input returns `answer=null`, `statusCode='invalid-request'`, and no trace or quality event.
- Permission or data-scope denial returns `answer=null` only when there is not enough allowed context to answer. Otherwise answer generation may continue with omitted sources and explicit degraded reasons.

The main-process owner is `electron/ipcHandlers.ts` `generate-what-to-say`. It calls retrieval, assembles trace metadata, persists trace, and returns `answerId`, `contextTrace`, `citations`, and `degradedReasons`.

## Unified Retrieval Contract

Add a narrow orchestration boundary inside the existing realtime answer path. The implementation can live in `electron/services/context/RealtimeContextOrchestrator.ts` or as a small helper next to `PromptAssembler`, but one function must own source ordering, dedupe, trimming, and fallback.

```ts
type RealtimeContextSource =
  | 'current_transcript'
  | 'short_term_history'
  | 'uploaded_material'
  | 'mode_reference'
  | 'historical_meetings'
  | 'profile_history'
  | 'screen_context';

type RealtimeContextCandidate = {
  source: RealtimeContextSource;
  sourceId: string;
  chunkId?: string | number;
  text: string;
  score?: number;
  tokenCount: number;
  sourceVersion?: string;
  contentHash?: string;
  metadata?: Record<string, unknown>;
};

type RealtimeContextPlan = {
  injected: RealtimeContextCandidate[];
  omitted: Array<RealtimeContextCandidate & { reason: AnswerDegradedReason }>;
  sourceStatus: AnswerSourceStatus;
  degradedReasons: AnswerDegradedReason[];
  contextFingerprint: string;
  retrievalTimingMs: Record<RealtimeContextSource, number>;
};
```

Source priority for Phase 0:

1. Current transcript and direct user question.
2. Screen context when image input is attached and screenshots scope is allowed.
3. Uploaded material hits with valid citation anchors.
4. Active mode reference context.
5. Short-term assistant history.
6. Historical meetings and profile history only if this path actually injects them.

Budget rules:

- Reserve model output and system prompt budget first.
- Keep current transcript unless it alone exceeds the budget; then trim it and emit `transcript_truncated`.
- Uploaded material and mode reference context are deduped by `(source, sourceId, chunkId, contentHash)` and then by normalized text hash.
- When two candidates contain the same fact, keep the higher-priority source. Record the omitted duplicate as `duplicate_context_dropped`.
- If budget is exceeded after required context, drop lower-priority candidates first and emit source-specific degraded reasons such as `uploaded_material_context_truncated`, `mode_context_dropped`, or `assistant_history_truncated`.
- RAG no-hit, timeout, and scope-denied states are different states. They must not collapse into "no material".

Fallback rules:

- Uploaded material miss: answer may continue; trace has `ragAttempted=true`, `uploadedMaterialHitCount=0`, `uploadedDocumentRag=false`, and `no_relevant_uploaded_material`.
- Uploaded material timeout/error: answer may continue; trace has `uploaded_material_rag_failed`, not `no_relevant_uploaded_material`.
- Reference file scope denied: omit reference context, add `context_scope_denied`, and do not mark RAG or citations as used.
- If all usable context is empty, return `answer=null`, `statusCode='no-context'`.

## Data Scope Contract

Every context source maps to provider scopes before retrieval and before outbound LLM calls:

| Context | Scope |
|---|---|
| current transcript | `transcript` |
| screen context and screenshots | `screenshots` |
| uploaded material and mode reference files | `reference_files` |
| short-term assistant history and profile history | `profile_history` |
| historical meetings | `transcript` plus `profile_history` when tied to a profile |
| embeddings | `embeddings` |

Rules:

- Retrieval that requires embeddings must call the embedding provider resolver with `providerDataScopes`.
- Context injection into the final prompt must use `assertProviderDataScopes()` or `routeWithScopeFallback()` through `LLMHelper` before any cloud provider sees scoped data.
- If cloud scope is denied and local fallback is available, local fallback may receive the scoped context. The trace must record `scopeFallback='local'`.
- If cloud scope is denied and no local fallback is available, the source is omitted and the trace must record `scopeFallback='omitted'`.
- Scope denial must be visible to UI as `context_scope_denied` or the more specific source reason. It must not be rendered as "未找到相关资料".

## Citation Contract

Every persisted citation must be a verifiable pointer, not just display metadata.

```ts
type AnswerCitationRecord = {
  citationId: string;
  sourceType:
    | 'current_meeting'
    | 'historical_meeting'
    | 'uploaded_material'
    | 'long_term_memory'
    | 'enterprise_knowledge'
    | 'screen_context';
  sourceId: string;
  sourceVersion: string;
  chunkId: string | number;
  chunkContentHash: string;
  sourceFileHash?: string;
  startOffset?: number;
  endOffset?: number;
  score?: number;
  title?: string;
};
```

Rules:

- `citationId` is generated by the main process and is unique within an answer.
- Uploaded material citations must include `chunkId`, `chunkContentHash`, and `sourceVersion` or `sourceFileHash`.
- Offset fields are required when the source supports stable text offsets. If offsets are unavailable, clickback opens the chunk with hash validation, not a guessed position.
- Clickback must re-read the current source/chunk and compare `chunkContentHash` and source version. Mismatch returns `stale-citation`; missing source returns `missing-citation`.
- Stale or missing citations must never open a best-effort neighboring chunk.
- The UI can stay compact: show `资料引用 N`, but the count must be clickable when N > 0 and must open a small citation list or source preview. Invalid citations show `引用来源已变更` or `引用来源不可用`.
- RAG unavailable, no-hit, low-score, or scope-denied states must not render empty citation anchors.

## Streaming and UI Race Contract

`WhatToAnswerLLM.generateStream(..., traceSink)` remains the streaming path. `traceSink` fires after final prompt assembly and before token streaming.

Renderer state updates must be gated by `answerId`:

- Streaming text, trace, citations, degraded reasons, and quality events belong to one `answerId`.
- If two realtime answers are requested concurrently, stale results from the older answer must not overwrite the latest answer's trace or citations.
- If a stream is canceled before a persisted trace exists, do not emit `shown`.
- If text arrives before citations, citation UI stays pending for that `answerId`; it must not show anchors from a previous answer.
- `shown` is emitted only after a non-null answer with persisted `contextTrace` is displayed.

## Trace Contract

Every non-null realtime answer persists a trace with this context shape:

```ts
type AnswerContextUsed = {
  currentTranscript: boolean;
  shortTermHistory: boolean;
  uploadedDocumentRag: boolean;
  historicalMeetings: boolean;
  longTermMemory: boolean;
  enterpriseKnowledge: boolean;
  screenContext: boolean;
};
```

Rules:

- A source is true only if its text or image content reached the model.
- `uploadedDocumentRag` is true only when uploaded material citations were injected into the final prompt.
- Old trace rows hydrate missing keys as `false`.

`sourceStatus` is required on every new trace row:

```ts
type AnswerSourceStatus = {
  ragAttempted: boolean;
  ragReady: boolean;
  embeddingReady: boolean;
  uploadedMaterialHitCount: number;
  citationCount: number;
  screenContextStatus: 'not_available' | 'available' | 'failed';
  sttUserStatus?: 'connected' | 'reconnecting' | 'failed';
  sttInterviewerStatus?: 'connected' | 'reconnecting' | 'failed';
  speakerSeparationStatus?: 'off' | 'on' | 'unavailable';
};
```

Trace metadata must also include:

```ts
type AnswerTraceObservability = {
  traceId: string;
  answerId: string;
  retrievalTimingMs: Record<string, number>;
  contextFingerprint: string;
  injectedSourceIds: string[];
  omittedSources: Array<{ source: RealtimeContextSource; reason: AnswerDegradedReason }>;
  promptFingerprint: string;
  provider: string | null;
  model: string | null;
  status: 'generated' | 'generated_with_fallback';
};
```

Do not persist raw prompt bodies, raw transcript text, screenshots, raw uploaded document text, or provider credentials in trace rows.

Trace persistence failure is a confidence feature failure. If `saveAnswerContextTrace` returns null or throws, return `answer=null`, `statusCode='answer-trace-unavailable'`, and do not emit `shown`.

## Failure Semantics

All realtime answer responses must use stable status codes:

```ts
type RealtimeAnswerStatusCode =
  | 'ok'
  | 'invalid-request'
  | 'no-context'
  | 'no-result'
  | 'retrieval-error'
  | 'permission-denied'
  | 'scope-rejected'
  | 'provider-error'
  | 'answer-trace-unavailable';
```

Rules:

- `no-result` means retrieval ran and found no relevant source.
- `retrieval-error` means retrieval failed, timed out, or its dependency failed.
- `permission-denied` means OS/app permission blocks a source such as screenshots.
- `scope-rejected` means provider data-scope policy blocked a source.
- Renderer copy must not conflate `scope-rejected` with `no-result`.

## Degradation Reasons

Use stable machine-readable reason codes and map them to clear Chinese UI labels.

```ts
type AnswerDegradedReason =
  | 'transcript_truncated'
  | 'assistant_history_truncated'
  | 'meeting_history_truncated'
  | 'uploaded_material_context_truncated'
  | 'uploaded_material_rag_failed'
  | 'no_relevant_uploaded_material'
  | 'uploaded_material_low_confidence'
  | 'screen_context_failed'
  | 'screen_context_scope_blocked'
  | 'screen_context_no_vision_provider'
  | 'screen_context_truncated'
  | 'screen_context_dropped'
  | 'mode_context_truncated'
  | 'mode_context_dropped'
  | 'duplicate_context_dropped'
  | 'rag_unavailable'
  | 'embedding_unavailable'
  | 'speaker_separation_unavailable'
  | 'stt_user_failed'
  | 'stt_interviewer_failed'
  | 'context_scope_denied'
  | 'citation_stale'
  | 'citation_missing';
```

Required user-facing examples:

- `上传资料检索失败，本次答案未使用上传资料`
- `没有找到相关上传资料，本次答案仅使用会议上下文`
- `资料引用来源已变更，无法跳回原文`
- `屏幕上下文不可用，本次答案未参考屏幕`
- `说话人分离不可用，发言人归属可能不可靠`

## Quality Events

Persist these events locally:

- `shown`: answer was displayed with a persisted trace.
- `copied`: answer was copied.
- `accepted`: user clicked the explicit accept/useful action.
- `regenerated`: user asked for another answer for the same flow.
- `ignored`: previous shown answer was replaced before copy, accept, or regenerate.

Rules:

- Events are keyed by `answerId + eventType + surface` for metrics dedupe.
- `regenerated` and `ignored` are mutually exclusive terminal outcomes.
- Unknown `answerId` quality events are rejected safely.
- Quality event write failure must not block the meeting flow.

## Metrics

Compute metrics from local SQLite and deterministic eval output:

- answer latency average and p95 from trace `latencyMs`
- citation hit rate: shown answers with `citationCount > 0` divided by shown answers with trace
- citation recall: required evidence chunks cited divided by required chunks in fixture
- groundedness: answer claims supported by injected evidence divided by checked claims
- refusal accuracy: unsupported fixture questions refused or caveated
- user acceptance rate
- regeneration rate
- RAG hit rate: traces with `ragAttempted=true` and `uploadedMaterialHitCount > 0` divided by traces with `ragAttempted=true`
- no-context answer rate: shown traces where only `currentTranscript=true` and `citationCount=0`

Do not use trace count as the display-quality denominator when `shown` is absent. Unshown traces are useful for debugging but not acceptance or citation display rates.

## Offline Eval Harness

The eval harness must run offline with fixed fixtures and no live LLM dependency for deterministic checks.

Fixture set:

- uploaded material hit with exact expected chunk
- uploaded material no-hit
- uploaded material timeout/error
- low-confidence retrieved chunk that must not be cited
- wrong citation offset
- stale citation hash
- provider scope rejection
- transcript noise and empty transcript
- screen context unavailable
- duplicate fact across transcript and material

Required checks:

- metric formulas have independent unit tests
- judge prompt or deterministic judge has fixture tests for supported, unsupported, and ambiguous claims
- changing groundedness, citation recall, or refusal thresholds can make CI fail
- live answer-quality evals may be tagged separately, but they cannot replace deterministic trace and citation tests

Initial rollback gates:

- Any `scope-rejected` case leaking scoped text to a cloud prompt is P0 and blocks release.
- Any stale citation opening a different chunk is P0 and blocks release.
- Citation recall below 0.8 on offline fixtures blocks release.
- Refusal accuracy below 0.9 on unsupported fixtures blocks release.
- More than one P1 degradation UI mismatch in the offline suite blocks release.

## Testing Plan

Prefer behavior tests over source-regex contract tests. Source-regex tests may remain as smoke guards, but they cannot be the only coverage for P0 contracts.

### High ROI Tests

1. `electron/services/__tests__/RealtimeCitationIntegrity.test.mjs`
   - One new file.
   - Mock `KnowledgeMaterialService.search` and a temporary DB.
   - Save citations, mutate chunk text/hash, and assert clickback returns `stale-citation`.
   - Also assert missing chunk returns `missing-citation`.

2. `electron/llm/__tests__/WhatToAnswerScopeDenial.test.mjs`
   - Mock `SettingsManager` and `llmHelper.streamChat`.
   - Set `reference_files=false` with no local fallback.
   - Assert final prompt does not contain uploaded material or mode reference text.
   - Assert trace has `context_scope_denied` and `uploadedDocumentRag=false`.

3. `electron/services/__tests__/AnswerMetricsOfflineHarness.test.mjs`
   - Temporary SQLite fixture.
   - Insert traces, duplicate events, unshown traces, valid citations, stale citations, and unsupported questions.
   - Assert dedupe, denominators, citation recall, groundedness, and refusal accuracy.

### Additional Required Tests

- `generate-what-to-say` invalid renderer payload cannot inject `uploadedMaterialContext`.
- RAG no-hit, low-confidence, timeout, and thrown error produce different `statusCode` and degraded reasons.
- Concurrent answer requests cannot let an older response overwrite the latest answer citations.
- Stream cancel before trace persistence emits no `shown`.
- `redactForLog()` removes citation `title`, `sourceId`, raw file names, raw chunk text, raw prompt, raw transcript, screenshots, and credentials from new logs.
- Old trace rows hydrate missing context and source status fields with conservative defaults.
- Unsupported image path returns a minimal failed screen trace without empty citations.

## Security and Privacy

Do not persist or log:

- raw prompt bodies
- raw transcript text in trace metadata
- screenshots
- raw uploaded document text
- credentials or provider keys

Persist only structured metadata, source booleans, citation pointers, hashes, health status, latency, provider/model names, fingerprints, and degraded reason codes.

All logs in `generate-what-to-say`, `WhatToAnswerLLM`, retrieval, citation clickback, eval, and metrics paths must use `redactForLog()` when they include objects or errors. Logs must not print citation `title`, `sourceId`, raw file names, raw chunk text, or raw metadata without redaction.

## Observability

Each non-null realtime answer trace must carry:

- `traceId`
- `answerId`
- retrieval timing by source
- final context fingerprint
- prompt fingerprint
- injected source ids
- omitted source reasons
- provider/model
- status and degraded reasons

The stored data must be enough to explain source selection and citation validity after the fact without storing raw private content.

## Feature Flag and Rollback

Add a local setting or feature flag:

```ts
realtimeAnswerConfidenceTraceEnabled: boolean
realtimeAnswerTraceStrictMode: boolean
```

Rules:

- Trace and eval code ships behind the enabled flag.
- Strict mode controls whether trace persistence failure blocks answer display.
- During rollout, strict mode may be disabled for local dogfood if trace write failures are noisy, but release criteria require strict mode for production builds.
- Turning the flag off must restore the previous realtime answer behavior without deleting stored traces.

## Implementation Lanes

```text
Lane A: types + DB + citation pointer schema + metrics
Lane B: unified context orchestrator + scope decisions + traceSink metadata
Lane C: IPC response semantics + trace persistence + log redaction
Lane D: renderer citation UI + answerId-gated lifecycle events
Lane E: offline eval harness + rollback gates

Order:
1. Build A and B first.
2. Prove scope denial and citation integrity with behavior tests.
3. Build C and D against stable contracts.
4. Build E before broadening live evals.
```

## Acceptance Criteria

- Every non-null realtime answer has `answerId`, `contextTrace`, `traceId`, and stable `statusCode='ok'`.
- Renderer cannot inject raw uploaded material context.
- Unified context orchestration defines priority, dedupe, budget trimming, fallback, and omitted-source reasons.
- Every citation can open the original chunk or actively fail as stale/missing.
- Uploaded material is marked used only when citation context was actually injected.
- Scope denial cannot leak scoped context to cloud prompts and cannot be displayed as "no result".
- RAG no-hit, RAG failure, low confidence, permission denial, and scope rejection have different machine-readable states.
- RAG, embedding, STT, and speaker separation status are visible near the answer.
- Degraded paths show clear Chinese reasons.
- Quality events persist locally for shown, copied, accepted, ignored, and regenerated.
- `regenerated` and `ignored` are mutually exclusive for the previous answer.
- Metrics use shown answers as user-facing denominators.
- Offline evals cover groundedness, citation recall, refusal accuracy, and rollback thresholds.
- Logs for the new path are redacted and do not include raw user content or citation source text.

## Out of Scope

- New enterprise PLM/QMS MCP connectors.
- New remote telemetry backend.
- Replacing the streaming answer architecture.
- Rewriting upload or indexing pipelines.
- Rewriting RAG retrieval internals beyond adding an orchestration boundary.
- Full document reader UI. Phase 0 needs citation clickback and stale/missing handling, not a complete source browser.
- Improving answer quality beyond making quality measurable and preventing ungrounded citations.
