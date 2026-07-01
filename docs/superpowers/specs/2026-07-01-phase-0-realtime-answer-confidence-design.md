# Phase 0 Realtime Answer Confidence Design

Date: 2026-07-01
Status: approved design, ready for implementation planning
Source plan: `docs/engineering/PHASE_0_REALTIME_ANSWER_CONFIDENCE_PLAN.md`

## Goal

Make every realtime answer auditable.

For each generated answer, the app must know:

- which context sources were actually used
- which context sources were unavailable or degraded
- whether the user saw, copied, accepted, ignored, or regenerated the answer
- whether a prompt, RAG, memory, or context-selection change improved answer quality

This phase must ship the complete loop before adding more context sources. More context without measurement makes failures harder to explain.

## Confirmed Product Decisions

- Scope: implement the full Phase 0 loop in one pass.
- `accepted`: explicit small accept/useful action on the latest answer.
- `ignored`: when a shown answer is replaced by a new answer before copy, accept, or regenerate.
- UI: extend the existing answer context pill/banner, not a new large panel.
- Storage: reuse existing local SQLite trace and event tables.
- Telemetry: no remote analytics backend in this phase.

## Architecture

Use the existing realtime answer path and add a narrow confidence trace beside it.

```text
generate-what-to-say
  -> material RAG / screen context / answerId
  -> IntelligenceEngine.runWhatShouldISay
  -> WhatToAnswerLLM.generateStream(..., traceSink)
  -> traceSink captures context actually assembled for the model
  -> saveAnswerContextTrace
  -> renderer shows context + health + degraded reasons
  -> trackAnswerQualityEvent
  -> getAnswerQualityMetrics / eval reads local records
```

`WhatToAnswerLLM.generateStream` gets an optional `traceSink` callback. The callback fires after prompt assembly and before token streaming. This preserves the existing streaming contract and avoids turning answer generation into a new service.

The IPC handler remains the owner of the final trace row because it already has the generated `answerId`, uploaded material result, screen context result, and latency.

## Trace Fallback Contract

The confidence trace must exist for every non-null answer, including degraded answers that do not reach normal prompt assembly.

Required behavior:

- Normal path: `traceSink` emits prompt-derived metadata after `PromptAssembler.assemble()` and before streaming.
- Image early return: if attached images are present but the selected model cannot accept image input, produce a minimal trace with `screenContext=false`, `screenContextStatus='failed'`, and `screen_context_no_vision_provider`.
- LLM stream error with fallback answer: persist a trace with `status='generated_with_fallback'` and the best available context metadata.
- Screen understanding failure: persist a trace with `screenContext=false` and `screen_context_failed`.
- Material RAG failure: persist a trace with `uploadedDocumentRag=false`, `ragAttempted=true`, and `uploaded_material_rag_failed`.
- Invalid request that returns `answer=null`: do not create a trace and do not emit `shown`.

Trace persistence failure is a confidence feature failure. If `saveAnswerContextTrace` returns null or throws, the IPC response must return `answer=null` with a controlled `answer_trace_unavailable` error. Do not display an untraceable answer as a successful realtime answer. This keeps the core invariant true: every non-null realtime answer has a persisted trace.

## Context Contract

Every non-null realtime answer persists this exact shape:

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

- `currentTranscript`: true when cleaned current transcript enters the prompt.
- `shortTermHistory`: true when recent turns or prior answer context enters the prompt.
- `uploadedDocumentRag`: true only when uploaded material RAG hits and citation context is injected.
- `historicalMeetings`: false in Phase 0 unless this answer path actually injects historical meeting context.
- `longTermMemory`: false in Phase 0 unless this answer path actually injects long-term memory.
- `enterpriseKnowledge`: false in Phase 0 unless this answer path actually injects enterprise knowledge.
- `screenContext`: true when screen understanding or image input reaches the model through a vision-capable path.

Do not mark a context source true because it exists in the product. Mark it true only if this answer used it.

Old trace rows that lack newer keys hydrate missing keys as `false`.

## Source Status Contract

`sourceStatus` is required on every new trace row. It gives metrics a denominator, not just a UI label.

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

Rules:

- `ragAttempted`: true when the answer path attempted material or meeting RAG lookup for this answer.
- `uploadedMaterialHitCount`: number of material hits returned before formatting/truncation.
- `citationCount`: number of citations persisted in the trace.
- `ragReady` and `embeddingReady`: health at generation time, not current health when metrics are later read.
- Missing status fields on old trace rows hydrate to conservative defaults: booleans false, counts zero, screen status `not_available`.

Without `ragAttempted`, RAG hit rate cannot be trusted. "Did not try RAG" and "tried RAG but got no hit" are different product states.

## Degradation Reasons

Use stable machine-readable reason codes and map them to clear Chinese UI labels.

Initial codes:

```ts
type AnswerDegradedReason =
  | 'transcript_truncated'
  | 'assistant_history_truncated'
  | 'meeting_history_truncated'
  | 'uploaded_material_context_truncated'
  | 'uploaded_material_rag_failed'
  | 'no_relevant_uploaded_material'
  | 'screen_context_failed'
  | 'screen_context_scope_blocked'
  | 'screen_context_no_vision_provider'
  | 'rag_unavailable'
  | 'embedding_unavailable'
  | 'speaker_separation_unavailable'
  | 'stt_user_failed'
  | 'stt_interviewer_failed'
  | 'context_scope_denied';
```

Required user-facing examples:

- `上传资料检索失败，本次答案未使用上传资料`
- `没有找到相关上传资料，本次答案仅使用会议上下文`
- `屏幕上下文不可用，本次答案未参考屏幕`
- `说话人分离不可用，发言人归属可能不可靠`

RAG unavailable or no-hit states must never be displayed as uploaded material usage.

## UI Design

Extend the existing realtime answer context area.

Show:

- context sources used by this answer
- degraded reasons
- RAG status
- embedding status
- user STT status
- interviewer/system STT status
- speaker separation status

Keep the UI compact. This is an operator surface inside a meeting, not a dashboard. The user should be able to answer two questions at a glance:

1. What did this answer use?
2. Why did it not use the thing I expected?

Health data is merged from these sources:

- `get-context-health`: RAG readiness, embedding readiness, material count, material indexing queue.
- renderer local state: user STT status and interviewer/system STT status.
- speaker separation status: derived from existing speaker/diarization settings and provider capability. If the implementation cannot derive a reliable value, show `unavailable`, not `on`.

Do not create a second health service in Phase 0.

## Quality Events

Persist these events locally:

- `shown`: answer was displayed.
- `copied`: answer was copied.
- `accepted`: user clicked the explicit accept/useful action.
- `regenerated`: user asked for another answer for the same flow.
- `ignored`: previous shown answer was replaced before copy, accept, or regenerate.

Recommended metadata:

```ts
type AnswerQualityEventMetadata = {
  surface: 'overlay' | 'launcher';
  answerAgeMs: number;
  triggerSource: string;
  modeTemplate?: string;
  hadCitations: boolean;
};
```

Deduplication:

- UI should avoid sending duplicate events.
- Metrics must tolerate duplicate events by treating `answerId + eventType + surface` as one logical event.

`copied` and `accepted` remain separate. Copying is not proof the answer was useful.

### Answer Lifecycle State Machine

Quality events must follow one lifecycle per `answerId`.

```text
shown
  |
  |-- copied      (can coexist with accepted)
  |-- accepted    (explicit user action)
  |-- regenerated (terminal for the previous answer)
  `-- ignored     (terminal for the previous answer)
```

Rules:

- `shown` is emitted once after a response with a persisted trace is displayed.
- `copied` can be emitted at most once per answer/surface.
- `accepted` can be emitted at most once per answer/surface.
- `regenerated` is emitted for the previous shown answer when the user explicitly requests another answer.
- `ignored` is emitted only when a previous shown answer is replaced by a new answer and the previous answer has no copied, accepted, or regenerated event.
- `regenerated` and `ignored` are mutually exclusive terminal outcomes for the previous answer.
- If an answer has no `answerId`, no quality events are emitted.

The renderer should track the latest answer lifecycle locally, and metrics must still dedupe by `answerId + eventType + surface`.

## Metrics

Compute metrics from local SQLite:

- answer latency
- citation hit rate
- user acceptance rate
- regeneration rate
- RAG hit rate
- no-context answer rate

Metrics should be callable from tests or a local reporting helper. No remote metrics service is part of Phase 0.

Metric definitions:

- answer latency: average and p95 of trace `latencyMs`.
- citation hit rate: answers with `citationCount > 0` divided by shown answers with a trace.
- user acceptance rate: answers with accepted divided by shown answers.
- regeneration rate: answers with regenerated divided by shown answers.
- RAG hit rate: traces with `ragAttempted=true` and `uploadedMaterialHitCount > 0` divided by traces with `ragAttempted=true`.
- no-context answer rate: traces where only `currentTranscript=true` and `citationCount=0` divided by shown answers with a trace.

Metrics must treat duplicate events as one logical event per `answerId + eventType + surface`.

## Testing

### Type and DB Contract

- `AnswerContextUsed` always contains all seven keys.
- old trace rows with missing keys hydrate safely.
- one generated answer creates one trace row.
- unknown `answerId` quality events are rejected safely.

### LLM Trace

- `generateStream(..., traceSink)` emits trace metadata before streaming.
- transcript, screen context, uploaded material, and degraded reasons are represented in trace metadata.
- stream failure still returns fallback trace where possible.
- trace persistence failure returns `answer=null` and `answer_trace_unavailable`.
- raw prompt, raw transcript, screenshots, and raw reference text are not logged or persisted.

### IPC and UI

- `generate-what-to-say` returns `answerId` and `contextTrace`.
- RAG failure sets `uploadedDocumentRag=false`.
- RAG failure displays a clear degraded reason.
- shown, copied, accepted, regenerated, and ignored persist.
- duplicate events do not corrupt metrics.

### Mode Eval

Split evaluation into deterministic trace tests and live answer-quality evals.

Deterministic trace tests must not depend on a live LLM response. They should cover:

- `traceSink` normal path
- image/model unsupported early return
- material RAG hit, miss, and failure
- screen context success and failure
- event lifecycle dedupe and terminal outcomes
- metrics aggregation with duplicate events

Live answer-quality evals add or tag cases for:

- sales objection handling, must use pricing/context when present
- technical interview, must use screen context when available and avoid invention
- team meeting owners/deadlines, must preserve ambiguity
- resume Q&A, must answer from resume context and avoid overclaiming

Live evals may assert high-level trace expectations only if the harness actually runs through the trace path. Trace correctness must be proven by deterministic tests.

Run live evals after prompt, RAG, memory, or context-selection changes.

## Failure Handling

- Material RAG failure: answer can continue, trace marks uploaded material unused, UI explains failure.
- Screen context failure: answer can continue, trace marks screen context unused, UI explains failure.
- STT failure: answer can continue if enough context exists, health status shows degraded channel.
- Speaker separation unavailable: answer can continue, UI warns speaker attribution may be unreliable.
- Trace persistence failure: answer is not displayed as a successful realtime answer; return `answer_trace_unavailable` and log safely without raw user content.
- Quality event write failure: UI should not block the meeting flow.

## Security and Privacy

Do not persist or log:

- raw prompt bodies
- raw transcript text in trace metadata
- screenshots
- raw uploaded document text
- credentials or provider keys

Persist only structured metadata, source booleans, citation metadata, health status, latency, provider/model names, and degraded reason codes.

Citation metadata can still contain sensitive file names or source identifiers. It may be persisted locally and shown in UI, but logs must not print citation `title`, `sourceId`, raw file names, or raw metadata without `redactForLog()`.

## Implementation Lanes

```text
Lane A: types + DB + metrics
Lane B: WhatToAnswerLLM traceSink + IPC trace assembly
Lane C: renderer context health UI + quality event controls
Lane D: eval/test harness additions

Order:
1. Build A and B first.
2. Merge A/B contracts.
3. Build C and D against stable contracts.
```

## Acceptance Criteria

- Every non-null realtime answer has `answerId` and `contextTrace`.
- Every trace has all seven `context_used` keys.
- Every new trace has required `sourceStatus`, including `ragAttempted`.
- Uploaded material is marked used only when citation context was actually injected.
- RAG, embedding, STT, and speaker separation status are visible near the answer.
- Degraded paths show clear reasons.
- Quality events persist locally for shown, copied, accepted, ignored, and regenerated.
- `regenerated` and `ignored` are mutually exclusive for the previous answer.
- Metrics can answer whether quality improved after prompt, RAG, memory, or context-selection changes.
- Failures can be attributed to STT, RAG, memory, prompt, model, or context orchestration.

## Out of Scope

- New enterprise PLM/QMS MCP connectors.
- New remote telemetry backend.
- Replacing the streaming answer architecture.
- Rewriting RAG retrieval.
- Full citation snippet UI.
- Improving answer quality beyond making quality measurable.
