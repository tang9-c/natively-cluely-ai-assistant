# Phase 4: Short-Term Context and Speaker Stability Plan

Date: 2026-07-02
Branch reviewed: `ci/intel-mac-workflow`
Status: Approved for scoped implementation

## Summary

Phase 4 is partially implemented today. Recent-turn selection and speaker metadata plumbing already exist, but the answer path still needs explicit speaker confidence handling, trace visibility, low-confidence degradation, and a 2-second local pipeline latency gate.

This plan completes Phase 4 with a small policy layer in the existing realtime answer path. It does not introduce long-term memory, a new transcript store, or a parallel context pipeline.

## Approved Scope

Implement only the smallest answer-path change needed for Phase 4. The work adds a deterministic speaker-context policy, wires it into the existing realtime answer path, and adds focused tests. Do not refactor transcript cleaning, STT, speaker verification, provider routing, database schema, or the mode eval framework.

Hard limits:

1. Do not modify `electron/db/DatabaseManager.ts` except if an existing type import forces it. `saveAnswerContextTrace()` already persists `observability` inside `context_used_json`, so no database implementation change is needed.
2. Do not add a new database migration, table, or trace column.
3. Do not change upstream STT or speaker verification services. Phase 4 consumes metadata that already exists.
4. Do not add a live remote-LLM latency requirement. The 2-second gate is for local preprocessing with the LLM stubbed.
5. Do not add broad mode eval coverage unless the narrow unit/contract test cannot prove the acceptance criterion.
6. Do not introduce `speaker_metadata_degraded`. Use only the specific reasons `speaker_metadata_low_confidence` and `speaker_metadata_unavailable`.

Success criteria:

- A low-confidence or malformed `speakerVerification` object cannot cause `[ME]` to appear in the prompt.
- When speaker metadata is present, the saved answer context trace includes `observability.speakerContext`.
- Low-confidence speaker metadata appears in degraded reasons instead of silently changing the answer context.
- The added policy is pure synchronous code and has no network, database, audio, model, or settings dependency.
- New tests fail before the policy and pass after it.

## Goals

1. Keep the current meeting's recent turns stable and relevant for realtime answers.
2. Allow speaker separation and local speaker verification metadata to reach the answer path only as safe metadata.
3. Record speaker confidence and speaker degradation state in answer context trace.
4. Avoid treating low-confidence speaker identity as fact.
5. Keep speaker metadata processing inside the 2-second answer-path target.
6. Add narrow test coverage for at least one case that requires knowing who spoke or what the latest turns said.

## Non-Goals

- Do not introduce long-term memory.
- Do not rewrite STT, Doubao diarization, or local speaker verification.
- Do not add a new database table for speaker trace data.
- Do not expose low-confidence speaker identity as user-visible fact.
- Do not change provider routing or data-scope policy.

## What Already Exists

- `electron/IntelligenceEngine.ts`
  - `runWhatShouldISay()` gets recent context with `session.getContext(180)`.
  - It injects the latest interim interviewer or user transcript before answer generation.
  - It calls `prepareTranscriptForWhatToAnswer(transcriptTurns, 12)`.

- `electron/llm/transcriptCleaner.ts`
  - `sparsifyTranscript()` preserves the newest trigger turn.
  - It keeps latest user, interviewer, and assistant turns.
  - It preserves multiple interviewer voices when `speakerId` or `speakerLabel` is present.
  - `verificationLabel()` only emits `ME` when `speakerVerification.isMe === true`.

- `electron/services/speaker/*`
  - Local speaker verification returns metadata with `confidence` and `threshold`.
  - STT paths can attach `speakerVerification` to final transcript segments.

- `electron/ipcHandlers.ts` and `electron/db/DatabaseManager.ts`
  - Answer context trace already persists `contextUsed`, `sourceStatus`, `latencyMs`, `degradedReason`, and `observability`.
  - The existing `observability` object is enough for Phase 4 speaker trace data. No schema migration required.

## Main Gap

The current code can carry speaker metadata, but it does not have a single policy boundary that decides whether speaker metadata is safe to use in the answer prompt and trace.

Today, low-confidence or partial speaker state may be silently omitted or treated as ordinary label data. That is better than asserting a false identity, but it does not satisfy Phase 4's explicit degradation requirement.

## Proposed Architecture

Add one small policy layer before transcript formatting:

```text
STT final/interim transcript
        |
        v
SessionTracker contextItems
        |
        v
IntelligenceEngine.runWhatShouldISay()
        |
        v
buildTranscriptTurns(contextItems)
        |
        v
SpeakerContextPolicy.evaluate(turns)
        |
        +--> safeTurns -> prepareTranscriptForWhatToAnswer(..., 12) -> WhatToAnswerLLM
        |
        +--> speakerTrace -> answer context trace observability
        |
        +--> degradedReasons -> degradedReason
```

### New Module

Create `electron/services/context/SpeakerContextPolicy.ts`.

Public API:

```ts
export interface SpeakerContextPolicyResult {
  turns: TranscriptTurn[];
  trace: SpeakerContextTrace;
  degradedReasons: AnswerDegradedReason[];
}

export function evaluateSpeakerContextForAnswer(
  turns: TranscriptTurn[],
): SpeakerContextPolicyResult;
```

Trace shape:

```ts
export interface SpeakerContextTrace {
  speakerMetadataUsed: boolean;
  localVerificationUsed: boolean;
  diarizationUsed: boolean;
  degraded: boolean;
  confidenceSummary: {
    verifiedMeCount: number;
    lowConfidenceCount: number;
    unknownCount: number;
    minConfidence: number | null;
    maxConfidence: number | null;
  };
  sources: Array<'local-speaker-verification' | 'doubao-auc'>;
}
```

### Policy Rules

1. Local speaker verification can assert `ME` only when:
   - `speakerVerification.provider === 'local-speaker-verification'`
   - `speakerVerification.isMe === true`
   - `confidence >= threshold`

2. Local speaker verification below threshold:
   - Must not assert `ME`.
   - Must add `speaker_metadata_low_confidence` to degraded reasons.
   - Must increment `lowConfidenceCount`.

3. Missing or malformed verification metadata:
   - Must not assert identity.
   - Must add `speaker_metadata_unavailable` only when speaker metadata was expected or present but unusable.

4. Doubao AUC diarization:
   - Can distinguish voices as `Interviewer 1`, `Interviewer 2`, or provider-backed speaker labels.
   - Must be trace-marked as diarization-only.
   - Must not imply real-world identity.

5. Generic `speakerLabel`:
   - Can be used for grouping only when already present.
   - Must not override local verification.

## Implementation Steps

### Step 1: Add SpeakerContextPolicy

Files:

- `electron/services/context/SpeakerContextPolicy.ts`
- `electron/services/__tests__/SpeakerContextPolicy.test.mjs`

Behavior:

- Take `TranscriptTurn[]`.
- Return sanitized turns.
- Return trace summary.
- Return degraded reasons.

Keep this module pure. No database, no LLM, no SettingsManager, no async calls.

Approval constraint:

- If importing `TranscriptTurn` from `electron/llm/transcriptCleaner.ts` creates awkward dependency direction, use a type-only import or move the policy to `electron/llm/SpeakerContextPolicy.ts`. Do not add a new shared types module just for this.

### Step 2: Wire Policy into Answer Path

File:

- `electron/IntelligenceEngine.ts`

Change:

```ts
const transcriptTurns = this.buildTranscriptTurns(contextItems);
const speakerContext = evaluateSpeakerContextForAnswer(transcriptTurns);
const preparedTranscript = prepareTranscriptForWhatToAnswer(speakerContext.turns, 12);
```

Pass `speakerContext.degradedReasons` into the existing `contextDegradedReasons` path.

Pass `speakerContext.trace` through the existing `traceSink` path by adding one optional trace field, not by creating a new persistence path:

```ts
traceSink?.({
  ...trace,
  observability: {
    ...(trace.observability ?? {}),
    speakerContext: speakerContext.trace,
  },
});
```

Implementation rules:

- Extend the options object passed to `WhatToAnswerLLM.generateStream()` only if necessary.
- Do not add a second trace sink.
- Do not change LLM prompt assembly beyond receiving the sanitized transcript.

### Step 3: Persist Speaker Trace

Files:

- `electron/ipcHandlers.ts`
- `src/types/electron.d.ts`
- `electron/llm/WhatToAnswerLLM.ts` only for the optional trace metadata type, if TypeScript requires it

Use existing `observability`:

```ts
observability: {
  retrievalTimingMs,
  contextFingerprint,
  injectedSourceIds,
  omittedSources,
  promptFingerprint,
  speakerContext: speakerContextTrace,
}
```

No migration. No new table.

Approval constraint:

- `electron/db/DatabaseManager.ts` already stores `observability`; do not edit it for persistence. Update renderer-facing types only if the returned trace type needs to expose `observability`.

### Step 4: Add Degraded Reasons

Files:

- `electron/db/DatabaseManager.ts` type union only, if strict typing requires it
- `src/types/electron.d.ts`
- `electron/services/context/RealtimeAnswerRequest.ts` only if status typing already references the same union

Add conservative enum/string support for:

- `speaker_metadata_low_confidence`
- `speaker_metadata_unavailable`

If `AnswerDegradedReason` is string-literal typed in only one place, update that central type and reuse it.

Do not add a generic catch-all degraded reason. Specific reasons are easier to review and safer for downstream UI.

### Step 5: Add Phase 4 Test Coverage

Files:

- `electron/llm/__tests__/TranscriptCleaner.test.mjs`
- `electron/services/__tests__/SpeakerContextPolicy.test.mjs`
- `electron/llm/__tests__/WhatToAnswerContextTrace.test.mjs`

Required cases:

1. High-confidence local verification:
   - Input has `speakerVerification.isMe === true`, `confidence >= threshold`.
   - Prompt can show `[ME]`.
   - Trace records confidence and `localVerificationUsed: true`.

2. Low-confidence local verification:
   - Input has `confidence < threshold`.
   - Prompt must not assert `[ME]` based on verification.
   - Trace includes `speaker_metadata_low_confidence`.

3. Diarization-only multi-speaker context:
   - Input includes two interviewer speaker ids.
   - Recent-turn selection preserves both when possible.
   - Trace records `diarizationUsed: true`.

4. Recent-turn correctness:
   - Older stale meeting history contains a conflicting instruction.
   - Latest turns contain the current instruction.
   - Prepared transcript includes the current instruction and excludes stale history.

5. Phase 4 answer-path contract:
   - Scenario requires knowing that Jordan asked for legal next steps while Priya raised security.
   - Expected answer references the correct latest speaker context.

6. 2-second local pipeline gate:
   - Stub LLM streaming.
   - Run speaker policy, transcript preparation, prompt assembly, and trace construction.
   - Assert local preprocessing is under 2000ms.

Do not change `electron/test/modes-live-response-eval.ts` for this phase. The acceptance criterion can be proven with unit or contract tests.

## Test Coverage Diagram

```text
CODE PATH COVERAGE
==================
[+] SpeakerContextPolicy
    |
    +-- [NEW] high-confidence ME
    |       assert: prompt may use ME, trace has confidence
    |
    +-- [NEW] low-confidence ME
    |       assert: prompt does not assert ME, trace degraded
    |
    +-- [NEW] diarization-only speaker labels
    |       assert: grouping allowed, no real identity assertion
    |
    +-- [NEW] malformed speaker metadata
            assert: safe fallback, no throw

[+] IntelligenceEngine.runWhatShouldISay
    |
    +-- [EXISTING] gets 180s context
    +-- [EXISTING] injects newest interim turn
    +-- [EXISTING] keeps max 12 prepared turns
    +-- [NEW] applies speaker policy before transcript formatting

[+] Answer Trace
    |
    +-- [EXISTING] contextUsed/sourceStatus/latency persist
    +-- [NEW] observability.speakerContext persists
    +-- [NEW] degradedReason includes speaker confidence degradation

USER CONTRACT COVERAGE
======================
[+] Who spoke
    |
    +-- [NEW] Jordan vs Priya speaker-sensitive scenario

[+] Recent turns
    |
    +-- [NEW] stale history conflict excluded from answer context

[+] Latency
    |
    +-- [NEW] local Phase 4 preprocessing <= 2000ms with stub LLM
```

## Performance Plan

The policy must be O(n) over selected turns. In practice, `n` is bounded by session context and then by the 12-turn formatter. Do not call async speaker verification here. Verification already happened upstream.

Latency assertions:

- Unit-level speaker policy execution should be under 10ms for 500 turns.
- End-to-end local preprocessing with stub LLM should be under 2000ms.
- Existing real LLM eval budgets can stay 12000ms or 15000ms because they include provider latency. Phase 4's 2-second target is for local answer-path preparation, not a remote model SLA.

## Security and Privacy

- Do not log raw transcript text while recording speaker trace.
- Do not log embeddings, audio samples, or raw confidence vectors.
- Trace can store numeric confidence summary and source type.
- Keep existing `redactForLog()` requirements for any log touched in this work.

## Failure Modes

| Failure | Expected Behavior | Test |
|---|---|---|
| Speaker verification missing | Use role-only prompt labels, trace unavailable/degraded if metadata was expected | SpeakerContextPolicy missing metadata test |
| Speaker confidence below threshold | Do not assert identity, add degraded reason | Low-confidence test |
| Doubao speaker id changes | Treat as diarization-only grouping, not identity | Diarization-only test |
| Malformed metadata | Ignore metadata, no throw | Malformed metadata test |
| Trace persistence fails | Existing partial trace fallback still returns answer | Existing answer trace persistence test |
| Speaker policy becomes slow | Latency test fails before ship | 2-second local gate |
| Policy strips useful diarization labels | Keep diarization grouping labels, strip only unsafe identity assertions | Diarization-only test |

## Acceptance Criteria

- Answer path uses recent turns and does not pull stale or unrelated meeting history into the prompt.
- Speaker metadata is included only when confidence is high enough for the intended use.
- Low-confidence speaker state is explicitly degraded in trace.
- Context trace records speaker confidence summary when speaker metadata is present.
- At least one unit or contract test requires speaker attribution or recent-turn context to pass.
- Local Phase 4 preprocessing stays under 2 seconds with a stubbed LLM.

## Review Checklist

- [ ] `SpeakerContextPolicy` is pure and synchronous.
- [ ] No new long-term memory dependency.
- [ ] No database migration for speaker trace.
- [ ] No database persistence code change.
- [ ] Prompt labels do not assert low-confidence identity.
- [ ] Trace observability includes speaker confidence summary.
- [ ] Degraded reasons include low-confidence speaker metadata.
- [ ] Tests cover high confidence, low confidence, diarization-only, malformed metadata, recent-turn conflict, and latency.
- [ ] Existing transcript cleaner tests still pass.
- [ ] Existing answer trace tests still pass.

## Suggested Verification Commands

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/SpeakerContextPolicy.test.mjs
rtk node --test electron/llm/__tests__/TranscriptCleaner.test.mjs
rtk node --test electron/llm/__tests__/WhatToAnswerContextTrace.test.mjs
rtk node --test electron/services/__tests__/SpeakerVerificationMetadata.test.mjs
```

## Parallelization

Sequential implementation, no parallelization opportunity.

Reason: the changes touch one answer path and nearby tests. Splitting across worktrees would create more merge coordination than saved time.
