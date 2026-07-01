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

## Metrics

Compute metrics from local SQLite:

- answer latency
- citation hit rate
- user acceptance rate
- regeneration rate
- RAG hit rate
- no-context answer rate

Metrics should be callable from tests or a local reporting helper. No remote metrics service is part of Phase 0.

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
- raw prompt, raw transcript, screenshots, and raw reference text are not logged or persisted.

### IPC and UI

- `generate-what-to-say` returns `answerId` and `contextTrace`.
- RAG failure sets `uploadedDocumentRag=false`.
- RAG failure displays a clear degraded reason.
- shown, copied, accepted, regenerated, and ignored persist.
- duplicate events do not corrupt metrics.

### Mode Eval

Add or tag eval cases for:

- sales objection handling, must use pricing/context when present
- technical interview, must use screen context when available and avoid invention
- team meeting owners/deadlines, must preserve ambiguity
- resume Q&A, must answer from resume context and avoid overclaiming

Run live evals after prompt, RAG, memory, or context-selection changes.

## Failure Handling

- Material RAG failure: answer can continue, trace marks uploaded material unused, UI explains failure.
- Screen context failure: answer can continue, trace marks screen context unused, UI explains failure.
- STT failure: answer can continue if enough context exists, health status shows degraded channel.
- Speaker separation unavailable: answer can continue, UI warns speaker attribution may be unreliable.
- Trace persistence failure: answer can still display, error is logged safely without raw user content.
- Quality event write failure: UI should not block the meeting flow.

## Security and Privacy

Do not persist or log:

- raw prompt bodies
- raw transcript text in trace metadata
- screenshots
- raw uploaded document text
- credentials or provider keys

Persist only structured metadata, source booleans, citation metadata, health status, latency, provider/model names, and degraded reason codes.

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
- Uploaded material is marked used only when citation context was actually injected.
- RAG, embedding, STT, and speaker separation status are visible near the answer.
- Degraded paths show clear reasons.
- Quality events persist locally for shown, copied, accepted, ignored, and regenerated.
- Metrics can answer whether quality improved after prompt, RAG, memory, or context-selection changes.
- Failures can be attributed to STT, RAG, memory, prompt, model, or context orchestration.

## Out of Scope

- New enterprise PLM/QMS MCP connectors.
- New remote telemetry backend.
- Replacing the streaming answer architecture.
- Rewriting RAG retrieval.
- Full citation snippet UI.
- Improving answer quality beyond making quality measurable.
