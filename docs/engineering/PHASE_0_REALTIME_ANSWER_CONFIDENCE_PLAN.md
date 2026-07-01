# Phase 0: Realtime Answer Confidence Loop

Status: ready for implementation
Scope: 1 week
Branch at review time: `ci/intel-mac-workflow`

## Goal

Make every realtime answer auditable.

For each answer, the app must know:

- which context sources were actually used
- which context sources were unavailable or degraded
- whether the user saw, copied, accepted, ignored, or regenerated the answer
- whether a prompt, RAG, memory, or context-selection change made answer quality better

This phase deliberately ships the feedback loop before expanding context sources. More context without measurement is just a bigger mystery.

## Step 0: Scope Challenge

### What already exists

| Sub-problem | Existing code | Reuse decision |
|---|---|---|
| Answer trace storage | `DatabaseManager.saveAnswerContextTrace()` and `answer_context_traces` | Reuse. Extend the JSON payload and status fields only if needed. |
| Quality event storage | `DatabaseManager.trackAnswerQualityEvent()` and `answer_quality_events` | Reuse. Add missing event emitters in renderer. |
| Renderer API | `trackAnswerQualityEvent`, `getContextHealth`, `generateWhatToSay` types | Reuse. Tighten types instead of adding parallel IPC. |
| Current answer generation | `ipcHandlers.ts` `generate-what-to-say` | Reuse as the trace assembly owner. |
| Prompt/context assembly | `WhatToAnswerLLM.generateStream()` plus `PromptAssembler` metadata | Reuse. Add trace callback, do not rewrite streaming. |
| Context visibility UI | `NativelyInterface` context pill | Extend. It already renders context labels and degraded reasons. |
| RAG/embedding status | `get-context-health` and `RAGManager` readiness/queue APIs | Extend. Do not build a second health service. |
| STT status | Renderer `sttUserStatus`, `sttInterviewerStatus`; main STT events | Reuse. Display alongside answer context health. |
| Speaker separation | Doubao AUC diarization metadata and settings | Reuse. Expose status as "provider diarization available/off/unavailable". |
| Mode evals | `electron/test/modes-live-response-eval.ts` | Extend with Phase 0 scenarios and context-trace assertions. |

### Minimum viable complete version

No new service.
No analytics backend.
No new database.
No new retrieval system.

Use the existing SQLite tables, IPC channels, and renderer state. Add one narrow trace path from `WhatToAnswerLLM` back to `generate-what-to-say`, then persist and display it.

### Complexity check

Target implementation should touch 7 existing areas:

1. `electron/llm/WhatToAnswerLLM.ts`
2. `electron/ipcHandlers.ts`
3. `electron/db/DatabaseManager.ts`
4. `src/types/electron.d.ts`
5. `electron/preload.ts`
6. `src/components/NativelyInterface.tsx`
7. eval/tests under `electron/services/__tests__`, `electron/llm/__tests__`, `electron/test`

If implementation starts creating a new `AnswerObservabilityService`, stop. That is probably accidental complexity for Phase 0.

## Product Contract

### Context sources

Every generated realtime answer must persist this exact shape:

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

Semantics:

- `currentTranscript`: true only when the final prompt contains the current cleaned transcript.
- `shortTermHistory`: true when prior turns or previous assistant responses are included.
- `uploadedDocumentRag`: true only when uploaded material citations were actually retrieved and injected.
- `historicalMeetings`: false in Phase 0 unless the realtime answer path actually injects historical-meeting RAG.
- `longTermMemory`: false in Phase 0 unless profile/history memory is actually injected into this answer path.
- `enterpriseKnowledge`: false in Phase 0 unless the premium knowledge path actually injects a knowledge block.
- `screenContext`: true only when screen understanding status is `available` and a screen block or image input reaches the model.

Do not mark a source true because it exists in the product. Mark it true only if this answer used it.

### Degradation reasons

Use stable machine-readable reason codes:

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

User-facing copy must be explicit. Example:

- Good: `上传资料检索失败，本次答案未使用上传资料。`
- Bad: `上下文已部分裁剪。`

The user should never think uploaded material was used when RAG failed.

## Architecture

### Data flow

```text
User / dynamic action / screenshot trigger
    |
    v
ipcHandlers.generate-what-to-say
    |
    |-- validate images
    |-- run screen understanding
    |-- run uploaded material RAG
    |-- create answerId
    |
    v
IntelligenceEngine.runWhatShouldISay
    |
    |-- build transcript turns
    |-- classify intent
    |-- call WhatToAnswerLLM.generateStream(traceSink)
    |
    v
WhatToAnswerLLM.generateStream
    |
    |-- retrieve mode/material context
    |-- build PromptAssembler packet
    |-- emit trace metadata through traceSink
    |-- stream answer tokens
    |
    v
ipcHandlers.saveAnswerContextTrace
    |
    v
SQLite answer_context_traces
    |
    v
Renderer NativelyInterface
    |
    |-- show context sources
    |-- show RAG/embedding/STT/speaker-separation health
    |-- emit quality events
    |
    v
SQLite answer_quality_events
```

### Why `traceSink`, not a new return type

`WhatToAnswerLLM.generateStream()` is an async generator. Changing it to return a complex object would ripple through streaming call sites.

Add an optional callback parameter at the end:

```ts
traceSink?: (trace: WhatToAnswerTraceMetadata) => void
```

Call it immediately after `PromptAssembler.assemble()` and before streaming. That gives the caller context metadata without delaying tokens or rewriting streaming.

This is explicit, boring, and low blast radius.

### Trace metadata

```ts
interface WhatToAnswerTraceMetadata {
  contextUsed: AnswerContextUsed;
  degradedReasons: string[];
  promptPacketMetadata: {
    transcriptIncluded: boolean;
    screenContextAvailable: boolean;
    droppedBlocks: string[];
    tokenBudget: number;
  };
  sourceStatus: {
    ragReady: boolean;
    embeddingReady: boolean;
    uploadedMaterialHitCount: number;
    citationCount: number;
    screenContextStatus: 'not_available' | 'available' | 'failed';
    sttUserStatus?: 'connected' | 'reconnecting' | 'failed';
    sttInterviewerStatus?: 'connected' | 'reconnecting' | 'failed';
    speakerSeparationStatus?: 'off' | 'on' | 'unavailable';
  };
}
```

Persist this under `context_used_json`, `citations_json`, and a new or existing `degraded_reason` string. Avoid raw transcript, prompt bodies, screenshots, and raw reference text.

## Implementation Plan

### Step 1: Normalize trace types

Files:

- `src/types/electron.d.ts`
- `electron/db/DatabaseManager.ts`

Tasks:

- Replace loose `Record<string, boolean>` usage with explicit `AnswerContextUsed`.
- Extend `AnswerContextTrace` with `provider`, `model`, `latencyMs`, `sourceStatus`, `degradedReason`.
- Keep DB schema stable if possible by storing new nested fields inside existing JSON columns.
- Add a source-level contract test proving all seven context keys exist.

Acceptance:

- TypeScript callers cannot accidentally omit a context source.
- The DB still reads older rows where `context_used_json` lacks newer keys.

### Step 2: Capture real context use in `WhatToAnswerLLM`

Files:

- `electron/llm/WhatToAnswerLLM.ts`
- `electron/services/context/PromptAssembler.ts` only if existing metadata is insufficient

Tasks:

- Add optional `traceSink` callback to `generateStream`.
- Build `contextUsed` from actual prompt inputs:
  - `currentTranscript`: `workingTranscript.trim().length > 0`
  - `shortTermHistory`: `temporalContext.hasRecentResponses || contextItems.length > 1`
  - `uploadedDocumentRag`: `uploadedMaterialContext` exists and citations exist at IPC level
  - `historicalMeetings`: false for current realtime path
  - `longTermMemory`: true only if profile/history block is actually injected
  - `enterpriseKnowledge`: true only if knowledge block is actually injected
  - `screenContext`: `screenContext` exists or image input is used with a vision-capable path
- Include `packet.metadata.degradedReasons`.
- Do not log raw prompt or transcript.

Acceptance:

- A test can call `generateStream(..., traceSink)` and assert trace metadata without consuming private internals.

### Step 3: Persist answer trace after generation

Files:

- `electron/ipcHandlers.ts`
- `electron/db/DatabaseManager.ts`

Tasks:

- In `generate-what-to-say`, merge:
  - material RAG result
  - screen context result
  - `traceSink` metadata from `WhatToAnswerLLM`
  - provider/model/latency from `LLMHelper`
  - RAG/embedding health from `getContextHealth`
- Persist exactly one trace row per `answerId`.
- If answer returns fallback text because generation failed, still save trace with `status: 'generated_with_fallback'` and degraded reason.
- If answer is null, save no `shown` event.

Acceptance:

- Every non-null `generateWhatToSay` response has `answerId` and `contextTrace`.
- RAG failure never sets `uploadedDocumentRag: true`.

### Step 4: Show context and health in the overlay

Files:

- `src/components/NativelyInterface.tsx`
- `electron/ipcHandlers.ts`
- `src/types/electron.d.ts`
- `electron/preload.ts`

Tasks:

- Extend the existing context pill instead of adding a new panel.
- Show:
  - context sources used
  - degraded reasons
  - RAG status
  - embedding status
  - STT user/interviewer status
  - speaker separation status
- Add clear labels:
  - `RAG 可用`
  - `Embedding 可用`
  - `上传资料未使用`
  - `说话人分离关闭`
  - `屏幕上下文失败`
- Keep it compact. This is an operator console, not a landing page.

Acceptance:

- A user can tell why an answer used only transcript and not uploaded material.
- A user can tell whether STT or speaker separation was degraded.

### Step 5: Complete quality event loop

Files:

- `src/components/NativelyInterface.tsx`
- `electron/ipcHandlers.ts`
- `electron/db/DatabaseManager.ts`

Tasks:

- Existing:
  - `shown`: emitted after `generateWhatToSay` result
  - `copied`: emitted from copy action
- Add:
  - `accepted`: explicit small check action on latest answer
  - `ignored`: when a new answer replaces a previous shown answer with no copy/accept/regenerate after a timeout or meeting end
  - `regenerated`: when user asks for another answer for the same context
- Store event metadata:
  - surface
  - answer age in ms
  - trigger source
  - mode template
  - whether answer had citations

Acceptance:

- Quality events persist locally.
- Eval/report code can read them.
- Duplicate `shown` events for the same answer/surface are either prevented or harmlessly de-duped in metrics.

### Step 6: Product quality metrics

Files:

- `electron/db/DatabaseManager.ts`
- `electron/ipcHandlers.ts` or a local script under `scripts/`
- tests under `electron/services/__tests__/`

Metrics:

- answer latency: `answer_context_traces.latency_ms`
- citation hit rate: answers with `citations.length > 0` / all answers
- user acceptance rate: accepted / shown
- regeneration rate: regenerated / shown
- RAG hit rate: answers with uploaded/historical citations / RAG-attempted answers
- no-context answer rate: answers where only `currentTranscript` is true and citation count is zero

Implementation:

- Add `DatabaseManager.getAnswerQualityMetrics({ sinceMs?, mode? })`.
- Expose a test-only or internal IPC if needed.
- Add a script only if the team needs command-line reporting:
  - `scripts/report-answer-quality.mjs`

Acceptance:

- Team can run one command or test helper and see before/after metrics for a branch.

### Step 7: Small mode eval suite

Files:

- `electron/test/modes-live-response-eval.ts`
- `electron/test/__tests__/evalHarnessPatterns.test.mjs`
- possibly `electron/llm/__tests__/WhatToAnswerContextTrace.test.mjs`

Add or tag these eval cases:

1. Sales objection handling
   - must use uploaded pricing/context when present
   - must not discount when policy says no
2. Technical interview
   - must not invent constraints
   - must use screen context when available
3. Team meeting owners/deadlines
   - must not invent owner/deadline
   - must preserve ambiguity
4. Resume Q&A
   - must answer from resume context
   - must not overclaim missing experience

Each eval should assert both answer behavior and trace behavior:

- expected context source is true
- missing source is false
- degraded reason appears when context is unavailable
- latency under per-case budget

Run command:

```bash
NATIVELY_LIVE_LLM_TESTS=1 rtk tsx electron/test/modes-live-response-eval.ts
```

For non-live CI:

```bash
rtk node --test electron/test/__tests__/evalHarnessPatterns.test.mjs
rtk node --test electron/llm/__tests__/WhatToAnswerContextTrace.test.mjs
```

## Code Path Coverage Diagram

```text
CODE PATH COVERAGE TARGET
========================
[+] electron/ipcHandlers.ts generate-what-to-say
    |
    |-- [★★★] valid no-image answer -> answerId + trace + shown event
    |-- [★★★] uploaded material hits -> uploadedDocumentRag true + citations
    |-- [★★★] uploaded material miss -> uploadedDocumentRag false + no_relevant_uploaded_material
    |-- [★★★] uploaded material throws -> uploadedDocumentRag false + uploaded_material_rag_failed
    |-- [★★★] screen available -> screenContext true + provider/model visible
    |-- [★★★] screen failed/scope blocked -> screenContext false + reason visible
    |-- [★★★] LLM fallback answer -> status generated_with_fallback + degraded reason
    `-- [★★] invalid image path -> no trace, safe error

[+] electron/llm/WhatToAnswerLLM.ts traceSink
    |
    |-- [★★★] PromptAssembler packet metadata captured
    |-- [★★★] transcript truncation adds transcript_truncated
    |-- [★★★] mode RAG block used -> reference context counted
    |-- [★★★] no mode/RAG block -> corresponding context source false
    `-- [★★★] stream error -> fallback text, no raw prompt logged

[+] electron/db/DatabaseManager.ts
    |
    |-- [★★★] saveAnswerContextTrace upserts complete contextUsed shape
    |-- [★★★] old rows hydrate missing context keys as false
    |-- [★★★] trackAnswerQualityEvent rejects unknown answerId
    |-- [★★★] metrics aggregate shown/copied/accepted/ignored/regenerated
    `-- [★★] duplicate events do not corrupt aggregate metrics

[+] src/components/NativelyInterface.tsx
    |
    |-- [★★★] answer shown -> shown event once
    |-- [★★★] copy answer -> copied event
    |-- [★★★] accept answer -> accepted event
    |-- [★★★] regenerate answer -> regenerated event
    |-- [★★★] previous answer abandoned -> ignored event
    `-- [★★★] degraded RAG visible, not shown as used context
```

```text
USER FLOW COVERAGE TARGET
=========================
[+] Live answer from transcript only
    |-- [→UNIT] trace says currentTranscript + shortTermHistory, no citations
    `-- [→E2E optional] overlay shows "仅使用当前输入/当前会议"

[+] Live answer with uploaded material
    |-- [→UNIT] uploaded material hit sets uploadedDocumentRag true
    |-- [→UNIT] uploaded material miss says not used
    `-- [→EVAL] sales objection uses pricing policy

[+] Live answer with screenshot
    |-- [→UNIT] screen available sets screenContext true
    |-- [→UNIT] screen failure shows degraded reason
    `-- [→EVAL] technical interview uses screen when available

[+] Feedback loop
    |-- [→UNIT] shown/copy/accept/regenerate/ignore persisted
    `-- [→UNIT] metrics report acceptance and regeneration rates

COVERAGE TARGET: 100% of Phase 0 branches above.
```

## Failure Modes

| Codepath | Realistic failure | Test | Error handling | User-visible? |
|---|---|---:|---:|---:|
| Material RAG search | embedding unavailable or material DB throws | yes | yes | yes, "上传资料检索失败" |
| Screen understanding | provider lacks vision or scope denied | yes | yes | yes, screen context reason |
| STT channel | mic or system STT failed | source-level + UI | existing | yes, status indicator |
| Speaker separation | provider diarization off/unavailable | source-level + UI | existing | yes, status indicator |
| Trace persistence | SQLite write fails | unit | yes, log safe error and return answer | partial, answer still shown |
| Quality event | answerId missing | unit | yes, returns `answer_id_not_found` | silent is acceptable for event write |
| Eval harness | live API disabled | existing | yes, requires env var | CLI message |

Critical silent gap before implementation: `ignored` has no reliable event source today. The implementation must add one, either timeout-based or replacement-based.

## Test Plan

### Required tests

```bash
rtk npm run typecheck:electron
rtk node --test electron/services/__tests__/contextVisibilityMaterialRag.contract.test.mjs
rtk node --test electron/services/__tests__/AnswerQualityMetrics.test.mjs
rtk node --test electron/llm/__tests__/WhatToAnswerContextTrace.test.mjs
rtk node --test electron/test/__tests__/evalHarnessPatterns.test.mjs
```

### Live eval gate

Run after any prompt, RAG, memory, or context-selection change:

```bash
NATIVELY_LIVE_LLM_TESTS=1 rtk tsx electron/test/modes-live-response-eval.ts
```

Gate:

- no new must-not-include failures
- latency within existing per-case budget
- Phase 0 trace assertions pass for tagged cases
- no-context answer rate does not increase unless expected by the fixture

## Performance Review

Expected overhead:

- one trace row write per generated answer
- one quality event row per interaction
- one context health read per generation or overlay refresh

This is fine for local SQLite. Do not query aggregate metrics on every render. Metrics should be requested on demand or in eval/report flows.

Avoid:

- saving raw prompt bodies
- saving raw transcript text inside trace JSON
- polling `getContextHealth` at high frequency
- blocking token streaming on metrics aggregation

## Worktree Parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| Trace typing + DB hydration | `src/types`, `electron/db` | none |
| WhatToAnswer traceSink | `electron/llm`, `electron/services/context` | trace typing |
| IPC trace assembly | `electron/ipcHandlers` | traceSink |
| Renderer context/quality UI | `src/components`, `electron/preload` | trace typing, IPC response |
| Metrics aggregation | `electron/db`, `electron/ipcHandlers` or `scripts` | trace/event storage |
| Eval suite | `electron/test`, `electron/llm/__tests__` | traceSink, IPC trace shape |

Parallel lanes:

- Lane A: trace typing + DB hydration -> metrics aggregation
- Lane B: WhatToAnswer traceSink -> IPC trace assembly
- Lane C: renderer context/quality UI
- Lane D: eval suite

Execution:

1. Start Lane A and Lane B in parallel.
2. Merge A + B.
3. Run Lane C and Lane D in parallel.
4. Run full targeted tests and live eval gate.

Conflict flags:

- Lane A and Metrics both touch `DatabaseManager.ts`; keep them in one lane.
- Lane B and eval both touch `WhatToAnswerLLM` contract expectations; merge B before final eval assertions.

## NOT in scope

- Expanding new context sources. Phase 0 measures the current answer path first.
- Building a remote telemetry backend. Local SQLite is enough.
- Replacing the streaming architecture. Use `traceSink`.
- Building full citation UI with expandable snippets. Show source counts and titles only.
- Rewriting RAG retrieval. Only report whether it hit, missed, failed, or was unavailable.
- Fixing answer quality itself. Phase 0 makes quality measurable; later phases improve it.
- Building enterprise PLM/QMS MCP connectors. That belongs after the confidence loop.

## Acceptance Checklist

- Every realtime answer has `answerId` and `contextTrace`.
- Every `contextTrace.contextUsed` contains all seven required context keys.
- Uploaded material is marked used only when citations exist.
- RAG, embedding, STT, and speaker-separation status are visible near the answer.
- Degraded paths show clear reasons.
- Quality events persist for shown, copied, accepted, ignored, regenerated.
- Metrics can answer latency, citation hit rate, acceptance rate, regeneration rate, RAG hit rate, and no-context answer rate.
- Mode evals cover sales, technical interview, team meeting, resume Q&A.
- Eval gate is documented and run after prompt/RAG/memory/context-selection changes.

## Completion Summary

- Step 0: Scope Challenge — scope accepted as minimal reuse of existing trace/event infrastructure.
- Architecture Review: 1 major issue resolved by `traceSink` instead of new service.
- Code Quality Review: 1 issue, keep trace shape explicit and typed.
- Test Review: coverage diagram produced, 12 required paths identified.
- Performance Review: no blocking issue if metrics are on-demand.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: no TODO proposed for Phase 0; this plan is direct implementation scope.
- Failure modes: 1 critical silent gap identified and turned into a required implementation item, ignored-event capture.
- Outside voice: skipped.
- Parallelization: 4 lanes, 2 early parallel and 2 late parallel.
- Lake Score: 5/5 recommendations choose the complete but still boring option.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES OPEN | 5 scope proposals, 0 accepted, 0 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 12 issues/test gaps shaped into implementation constraints, 0 unresolved critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**VERDICT:** ENG CLEARED — ready to implement Phase 0. CEO review has open strategic questions, but they do not block this Phase 0 engineering start.
