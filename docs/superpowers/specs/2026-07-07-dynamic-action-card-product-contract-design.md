# Dynamic Action Card Product Contract Design

Date: 2026-07-07

## Summary

Step 1 upgrades dynamic action cards from "detected intent" hints into meeting-time next actions. The implementation scope is the product contract layer only: add structured action-promise fields, lifecycle states, and quality metrics around the existing dynamic action pipeline. It does not change trigger packs, mode intent mapping, provider routing, MCP behavior, or the visual design system.

The product contract is generated in the Electron main process and sent through the existing dynamic action payload. The renderer consumes that contract directly and stops deriving primary user-facing copy from intent labels.

## Goals

- Make every visible card answer: what should the user do now, why now, what evidence supports it, and what accepting it will generate.
- Keep internal diagnostics, provider details, prompt wording, raw semantic-gate phrasing, and full transcripts out of normal user-facing card copy.
- Add a strict output type contract with five values:
  - `spoken_response`
  - `checklist`
  - `email_draft`
  - `action_item`
  - `decision_record`
- Normalize card lifecycle around visible product states and metric events.
- Reuse existing diagnostics and answer-quality infrastructure. Do not add a database table in this step.

## Non-Goals

- Do not rewrite dynamic action triggers or mode intent mappings.
- Do not add new modes.
- Do not expand generic MCP.
- Do not add a new card design system.
- Do not use emotion alone to create or surface an action.
- Do not persist raw evidence text, prompt instructions, provider errors, or transcript bodies in quality events.

## Existing Context

Current dynamic actions flow through:

- `electron/services/dynamic-actions/DynamicAction.ts`
- `electron/services/dynamic-actions/DynamicActionEngine.ts`
- `electron/services/dynamic-actions/DynamicActionStore.ts`
- `electron/services/dynamic-actions/SignalStateTracker.ts`
- `src/components/dynamic-actions/DynamicActionBar.tsx`
- `src/components/dynamic-actions/DynamicActionCard.tsx`
- `shared/realtimeAnswerTrustViewModel.ts`
- `electron/services/eval/ContextQualityDiagnostics.ts`

The existing UI already supports display, dismiss, Tab accept, and a five-second auto countdown. The gap is product semantics: the card still reads like "detected intent + confidence + label" instead of a concrete meeting action.

## Product Contract

Add a structured product contract to `DynamicAction`.

```ts
export type DynamicActionOutputType =
    | 'spoken_response'
    | 'checklist'
    | 'email_draft'
    | 'action_item'
    | 'decision_record';

export type DynamicActionRiskState =
    | 'auto_countdown'
    | 'normal'
    | 'silent_diagnostic';

export interface DynamicActionProductContract {
    userAction: string;
    whyNow: string;
    evidenceSummary?: string;
    outputType: DynamicActionOutputType;
    outputPromise: string;
    riskState: DynamicActionRiskState;
}
```

`DynamicAction` exposes this as required `productContract: DynamicActionProductContract` once the implementation lands. Tests may use a temporary fallback during migration, but the shipped payload contract is required. Keeping it as a child object avoids mixing product promise fields with legacy fields such as `label`, `description`, `answerStyle`, and `semanticGate`.

### Field Semantics

- `userAction`: the thing the user should do now, such as "回应价格异议", "锁定集成验证步骤", or "确认负责人和截止时间".
- `whyNow`: one short user-facing reason. It must not expose prompt text, provider errors, raw internal trace labels, or raw semantic-gate wording.
- `evidenceSummary`: at most one short evidence summary. It should be trimmed and capped around 90 Chinese characters or equivalent. If there is no evidence, omit it.
- `outputType`: one of the five strict output types. Legacy `answerStyle.format` is mapped into this product type and is not shown directly.
- `outputPromise`: what accepting generates, such as "生成一段可直接说出口的回应" or "生成验证步骤检查清单".
- `riskState`: how the card should surface:
  - `auto_countdown`: high-confidence action allowed to auto-generate after countdown.
  - `normal`: visible card requiring user action.
  - `silent_diagnostic`: low-confidence diagnostic signal that must not render as a visible card.

## Generation Boundary

The contract is generated in the main process. `DynamicActionEngine.buildAction()` should call a small pure helper, for example:

```ts
buildDynamicActionProductContract(input): DynamicActionProductContract
```

The helper depends only on action draft fields: `type`, `modeTemplateType`, `confidence`, `autoSurfacePolicy`, `evidenceRefs`, `answerStyle`, and trigger metadata. It must not call an LLM, read external services, or mutate store state.

Recommended placement:

- `electron/services/dynamic-actions/DynamicActionProductContract.ts`

This keeps mapping logic out of `DynamicActionEngine` and lets tests exercise the contract directly.

## Output Type Mapping

Initial mapping should be conservative:

- Sales objections, interview answers, technical explanations, and general assistance -> `spoken_response`
- FDE integration, FDE security, FDE risk, FDE success criteria, and checklist-like actions -> `checklist`
- Quote or follow-up email actions -> `email_draft`
- Team action item / owner deadline actions -> `action_item`
- Decision point / decision capture actions -> `decision_record`

If a type is unknown, fall back to `spoken_response` with generic copy. Do not add a sixth visible output type in this step.

## Lifecycle Contract

Normalize backend action statuses around product events while preserving compatibility.

```ts
export type ActionStatus =
    | 'candidate'
    | 'shown'
    | 'accepted'
    | 'auto_generated'
    | 'dismissed'
    | 'expired'
    | 'generated_failed'
    | 'completed';
```

Status meanings:

- `candidate`: the engine created the action but it has not been confirmed as shown.
- `shown`: the action was emitted to the renderer and counts as shown once.
- `accepted`: user clicked or used Tab to accept.
- `auto_generated`: countdown completed and generated without a click.
- `dismissed`: user ignored or cancelled countdown.
- `expired`: card aged out.
- `generated_failed`: accepted or auto-generated action failed to produce an answer.
- `completed`: accepted generation finished successfully.

Renderer display state remains a UI concern:

```ts
export type DynamicActionCardStatus =
    | 'candidate'
    | 'countdown'
    | 'generating'
    | 'cancelled'
    | 'expired'
    | 'failed';
```

Mapping:

- `shown` + `riskState=normal` -> `candidate`
- `shown` + `riskState=auto_countdown` -> `countdown`
- user click or auto countdown trigger -> `generating`
- dismiss/cancel -> `cancelled`
- stale prune -> `expired`
- answer flow failure -> `failed`

`silent_diagnostic` actions must not enter the visible card list.

## Renderer Design

`DynamicActionCard` should stop using intent labels as primary user copy. It should render:

1. Status chip:
   - `candidate`: "建议动作"
   - `countdown`: "5 秒后自动生成"
   - `generating`: "正在生成"
   - `cancelled`: "已取消"
   - `expired`: "已过期"
   - `failed`: "生成失败"
2. Main title: `action.productContract.userAction`
3. Explanation: `action.productContract.whyNow`
4. Evidence line: `action.productContract.evidenceSummary`, only when present
5. Output promise: `action.productContract.outputPromise`
6. CTA by output type:
   - `spoken_response`: "生成回应"
   - `checklist`: "生成清单"
   - `email_draft`: "生成邮件"
   - `action_item`: "记录行动项"
   - `decision_record`: "记录决策"

`INTENT_LABELS` and `ACTION_LABELS` can remain as legacy fallback only. Normal cards should not show raw confidence percentages. Confidence is reflected through `riskState`.

## User-Facing Explanation Helper

Keep existing diagnostic explanation behavior separate from user-facing card copy. Add a user-facing helper rather than overloading the current diagnostic helper.

Recommended shared helper:

```ts
explainDynamicActionForUser(action): { whyNow: string; severity: 'info' | 'ok' | 'warning' }
```

This helper may be used by contract generation, but it must not reveal semantic-gate internals. The existing `explainDynamicAction()` can continue to support diagnostics and current tests.

## Quality Metrics

Reuse existing diagnostics and answer-quality infrastructure. Do not add a table.

Add lifecycle event aggregation for:

```ts
export type DynamicActionQualityEvent =
    | 'shown'
    | 'accepted'
    | 'dismissed'
    | 'auto_generated'
    | 'expired'
    | 'generated_failed';
```

Safe event payload:

- `actionType`
- `modeTemplateType`
- `outputType`
- `riskState`
- `status`

Unsafe payload, not allowed:

- `evidenceRefs.text`
- full transcript
- `promptInstruction`
- provider error
- raw prompt or screenshots

Recording points:

- `shown`: main process when action is emitted to renderer. This avoids multi-window duplicate counting.
- `accepted`: `acceptDynamicAction()` updates status.
- `dismissed`: `dismissDynamicAction()` updates status.
- `auto_generated`: renderer countdown accept path calls the existing accept flow with an explicit `triggerSource: 'auto_countdown'` option, and the main process records `auto_generated` once for that action id.
- `expired`: backend stale expiry records once.
- `generated_failed`: dynamic action answer flow catches generation failure.

## Error Handling

- If contract generation fails, fall back to a safe generic contract:
  - `userAction`: "生成下一步回应"
  - `whyNow`: "当前会议出现了可处理的下一步。"
  - `outputType`: `spoken_response`
  - `outputPromise`: "生成一段可直接说出口的回应"
  - `riskState`: `normal`
- If evidence is empty, omit `evidenceSummary`.
- If an action has `riskState=silent_diagnostic`, renderer ignores it for visible UI while diagnostics may still record the safe event.
- If generation fails after accept, card should enter `failed` and diagnostics should record `generated_failed`.

## Tests

### Contract Tests

- `DynamicAction` and renderer types expose `productContract`.
- `DynamicActionOutputType` contains exactly five values.
- `DynamicActionRiskState` contains exactly three values.
- `DynamicActionCard` primary copy uses `productContract.userAction`, `whyNow`, and `outputPromise`.
- `DynamicActionCard` does not show raw confidence percentages.
- `silent_diagnostic` actions do not render visible cards.

### Engine Tests

- `pricing_objection` -> `spoken_response`
- FDE integration or security action -> `checklist`
- quote email action -> `email_draft`
- team action item -> `action_item`
- decision point -> `decision_record`
- empty evidence omits `evidenceSummary`
- long evidence is truncated

### Lifecycle Tests

- `shown`, `accepted`, `dismissed`, `auto_generated`, `expired`, and `generated_failed` are recorded in diagnostics aggregation.
- Dismissing an action still uses `SignalStateTracker.dismiss()` cooldown.
- Auto countdown cancel records `dismissed`, not `generated_failed`.

### UI Tests

- Candidate/countdown/generating/cancelled/expired/failed copy exists.
- Evidence line is hidden when no evidence summary is present.
- Internal terms do not appear in card UI:
  - `semantic gate`
  - provider names/errors
  - `triggered by`
  - raw internal field names

## Acceptance Criteria

- A visible card reads like a next action, not a trigger report.
- Every visible action has a product contract from the backend.
- The renderer can display cards without knowing action-specific intent labels.
- Metrics capture lifecycle counts without storing user content.
- Existing dynamic action trigger behavior remains unchanged.
- Existing accept/dismiss/countdown behavior continues to work.

## Implementation Scope

Files expected to change during implementation:

- `electron/services/dynamic-actions/DynamicAction.ts`
- `electron/services/dynamic-actions/DynamicActionProductContract.ts`
- `electron/services/dynamic-actions/DynamicActionEngine.ts`
- `electron/services/dynamic-actions/DynamicActionStore.ts`
- `electron/services/eval/ContextQualityDiagnostics.ts`
- `electron/ipcHandlers.ts`
- `electron/preload.ts`
- `src/types/electron.d.ts`
- `src/components/dynamic-actions/DynamicActionBar.tsx`
- `src/components/dynamic-actions/DynamicActionCard.tsx`
- Dynamic action tests under `electron/services/__tests__`

Do not include unrelated roadmap, mode, provider, or MCP changes in this implementation.
