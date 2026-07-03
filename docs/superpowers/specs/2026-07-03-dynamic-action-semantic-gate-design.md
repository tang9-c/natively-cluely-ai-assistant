# Dynamic Action Semantic Gate Design

## Purpose

P0-1 upgrades dynamic actions from keyword-triggered behavior to action-level semantic gating.

The user-facing goal is simple: a card should appear because the conversation really asks for that help, not because a word like "price" or "API" appeared nearby.

## Approved Boundary

Use a dynamic-action-specific classifier boundary.

Do not expand the public behavior of `classifyIntentWithCloud()` in this first version. The existing `classifyIntent()` result can be an input signal, but it is not the final gate because it uses broad intent labels such as `handle_objection`, `seize_signal`, and `discovery_probe`.

The new semantic gate lives inside the dynamic-actions subsystem and produces action-level decisions such as:

- `pricing_objection`
- `pricing_request`
- `case_study_request`
- `technical_requirements`
- `buying_signal`

## Current State

`IntelligenceEngine.detectConfirmAndEmitDynamicActions()` already prepares recent transcript context and calls `classifyIntent(..., { cloudFirst: true })`.

`DynamicActionEngine.assessSignals()` currently still starts from regex triggers and then uses `intentResult` only for scoring or synthetic trigger creation. This means regex can still dominate the final action decision.

The optional local intent model is not a dependable default. It requires both:

- local intent enhancement enabled in settings.
- the local model artifact available.

The cloud intent fallback in `classifyIntent()` is also not enough for P0-1 because it is broad intent classification, mainly Chinese-oriented, and not action-level.

## Architecture

Add a dynamic-action-specific semantic gate.

```text
final transcript
-> DynamicActionDetector regex candidate recall
-> ModeEventClassifier action-level semantic gate
   -> allow fast_path only for explicit safe actions
   -> use local intent signal when available and high-confidence
   -> use cloud action classifier for high-risk or ambiguous candidates
   -> reject or defer when semantic confirmation is unavailable
-> SignalStateTracker repeated-evidence assessment
-> DynamicAction with semanticGate trace metadata
```

### Components

`ModeEventClassifier`

- New dynamic-actions service responsible for action-level semantic decisions.
- Input includes the current final transcript, compact recent context, mode/template, speaker/channel, regex candidates, existing `intentResult`, and active dynamic actions.
- Output is one decision per candidate or candidate group.

`DynamicActionCloudSemanticClassifier`

- Dynamic-action-specific cloud classifier implemented as a private helper in `ModeEventClassifier.ts` for the first version.
- Uses strict JSON output.
- Can only choose from the candidate action types provided by regex recall.
- Uses compact context, not an unbounded transcript.
- Uses a short timeout, target 2.5 seconds.

`DynamicActionEngine`

- Continues to own action creation, dedupe, store access, and `SignalStateTracker`.
- Calls the semantic gate before `SignalStateTracker`.
- Stores semantic gate trace metadata on generated actions.

`IntelligenceEngine`

- Continues to orchestrate transcript finalization.
- Passes compact recent context turns into `assessSignals()`.
- Does not expose the new dynamic-action cloud classifier to other intent flows.

## Data Flow

1. `IntelligenceEngine.detectConfirmAndEmitDynamicActions()` receives a final interviewer/user transcript segment.
2. It builds compact context from the current turn plus recent turns.
3. It still computes `intentResult` as a supporting signal.
4. `DynamicActionEngine.assessSignals()` asks `DynamicActionDetector` for regex candidates.
5. Regex candidates enter `ModeEventClassifier`.
6. The gate decides:
   - `fast_path` for explicit safe actions.
   - `pass` when semantic evidence confirms the candidate.
   - `defer` when evidence is plausible but not strong enough.
   - `reject` when the candidate is neutral, contradicted, stale, or unsupported.
7. Only `pass`, `fast_path`, and eligible repeated `defer` decisions reach `SignalStateTracker`.
8. Generated actions include `semanticGate` metadata for traceability.

## Semantic Provider Rules

Fast-path is allowed only for explicit low-ambiguity actions:

- send contract/proposal/quote.
- schedule a meeting/time.
- screen-visible coding problem.
- explicit action item capture.

High-risk actions always require semantic confirmation:

- pricing objection.
- pricing request.
- case/proof request.
- technical/integration requirement.
- next-step/buying signal.

Local intent is preferred only when it is installed, enabled, available, and returns a high-confidence action-relevant signal.

Cloud action-level confirmation is required when:

- the local model is missing, disabled, failed, timed out, or low-confidence.
- multiple high-risk candidates are recalled.
- the latest turn contains negation, exclusion, or topic shift.
- the input is English or mixed-language and existing intent classification cannot confirm the action.
- a high-risk action would otherwise auto-surface.

If transcript scope is denied by provider data-scope policy, or no cloud provider is available, high-risk candidates must become `defer` or `reject`. They must not auto-surface.

## Context Window

Default semantic context:

- current final transcript.
- recent 4-6 compact turns.

Expanded context:

- at most 8 turns or 120 seconds.
- only for low confidence, multi-candidate conflict, negation/topic shift, or cloud confirmation.

Do not default to 12 turns. Old context can contaminate the latest intent.

## Trace Metadata

Extend `DynamicAction` with optional `semanticGate` metadata.

Minimum fields:

- `decision`
- `actionType`
- `semanticIntent`
- `confidence`
- `reasons`
- `regexCandidates`
- `rejectedCandidates`
- `usedLocalIntentModel`
- `usedCloudArbitration`
- `semanticProvider`
- `degradedReason`
- `upgradedByRepeatedEvidence`

Generated dynamic actions must be explainable from this metadata.

Rejected candidates do not need to become user-visible cards in the first version, but tests must be able to assert why they were rejected.

## Legacy API Boundary

`DynamicActionEngine.detectActions()` currently returns regex-created actions.

For high-risk action types, this cannot remain a bypass.

First version behavior:

- keep `detectActions()` for legacy low-risk use.
- document it as not safe for high-risk semantic decisions.
- migrate high-risk dynamic-action tests to `assessSignals()`.
- ensure production dynamic action emission goes through `assessSignals()`.

## Error Handling

Local intent model unavailable:

- record `local_intent_unavailable`, `local_intent_disabled`, `local_intent_timeout`, or `local_intent_failed`.
- use cloud action-level confirmation for high-risk candidates when scope allows.

Cloud unavailable:

- record `cloud_semantic_gate_unavailable`.
- high-risk candidates become `defer` or `reject`.

Provider data scope denied:

- record `provider_scope_denied`.
- no cloud transcript payload is sent.
- high-risk candidates do not auto-surface.

Invalid cloud output:

- reject outputs that are not JSON.
- reject action types outside the candidate set.
- reject non-finite confidence.
- record a degraded reason.

Main transcript path:

- semantic gate failure must not break transcript handling.
- dynamic actions are auxiliary; failures should degrade action generation only.

## Testing

Add deterministic tests with fake local and cloud classifiers.

Required scenarios:

- `价格先放一边，我们想看客户案例和 API 集成要求`
  - no pricing action.
  - `case_study_request` passes.
  - `technical_requirements` passes.
- `The pricing page is fine, but we need customer proof and SSO integration details.`
  - no pricing objection.
  - case/proof and technical/integration pass.
- `客户要一个类似 case study 证明 ROI，还想确认 API 和生产环境部署。`
  - case/proof and technical/integration pass.
- `price list`, `pricing page`, `成本数据`
  - no `pricing_objection`.
- `这个价格太高了`, `This is too expensive.`
  - `pricing_objection` passes.
- previous turns discuss price, latest turn shifts to API or case proof.
  - latest semantic intent wins.
- local model not installed, disabled, failed, and timed out.
  - cloud fallback is used for high-risk candidates when scope allows.
- provider data scope denies transcript.
  - high-risk candidates do not auto-surface.
- cloud returns invalid JSON, unknown action type, timeout, or provider failure.
  - high-risk candidates do not auto-surface and include degraded reason.

Verification commands:

```bash
rtk npm run build:electron
rtk npm run typecheck:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ModeEventClassifier.test.mjs electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs electron/llm/__tests__/ModeAwareIntent.test.mjs
rtk npm run test:quality:smoke
```

## Not In Scope

- Rebuilding the general `classifyIntentWithCloud()` API.
- Replacing the optional local intent model.
- Making a user-facing analytics dashboard.
- Changing STT, ASR, VAD, or transcript finalization behavior.
- Generating dynamic actions for rejected candidates as visible cards.

## Open Implementation Defaults

- First implementation should use fake classifiers in tests and avoid real provider calls.
- Cloud confirmation timeout target is 2.5 seconds.
- Default compact context is current turn plus recent 4-6 turns.
- Expanded context is capped at 8 turns or 120 seconds.
- Prefer fewer actions over false positives.
