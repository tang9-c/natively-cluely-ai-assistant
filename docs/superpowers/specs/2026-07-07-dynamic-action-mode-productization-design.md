# Dynamic Action Mode Productization Design

Date: 2026-07-07

## Goal

Turn Sales, FDE, and Team Meeting from generic dynamic-action trigger packs into three productized meeting modes with explicit action contracts, generation shapes, quality gates, and post-call carryover semantics.

This follows the already-shipped dynamic action card product contract. The card surface can show what the user should do, why now, one short evidence summary, the promised output type, and lifecycle states. This design defines what each priority mode means by a good action.

## Scope

This spec covers roadmap Step 2-4:

- Step 2: Sales mode productization.
- Step 3: FDE mode productization for manufacturing PLM / QMS / enterprise AI Agent deployment.
- Step 4: Team Meeting mode productization.

Implementation must be strictly sequential:

1. Sales reaches its acceptance criteria.
2. FDE reaches its acceptance criteria.
3. Team Meeting reaches its acceptance criteria.

## Non-Goals

- Do not add database tables or columns.
- Do not add CRM writeback, automatic email sending, or automatic quote creation.
- Do not write to PLM / QMS or business systems.
- Do not add a new card design system or new meeting modes.
- Do not expand generic MCP behavior.
- Do not implement Step 5 metrics dashboards in this work. Keep event and test anchors only.

## Existing Context

The current product already has:

- `DynamicActionEngine.assessSignals()` with regex candidates, semantic gating, cloud arbitration, local fallback, and traces.
- `DynamicActionDetector` trigger packs for Sales, FDE, and Team Meeting.
- `DynamicActionProductContract` for card copy, output type, risk state, and evidence summary.
- `DynamicActionCard` and `DynamicActionBar` for candidate, countdown, generating, cancelled, expired, and failed states.
- Lifecycle events for shown, accepted, dismissed, auto-generated, expired, and generated-failed.
- Material RAG, PPTX knowledge sources, screen context, business-system context, Windchill read-only facts, speaker policy, and QCLOUD / SenseVoice emotion metadata.

The missing layer is a mode-specific product contract that says what counts as a useful action in each mode.

## Design Summary

Add a Mode Action Contract layer above existing trigger and intent detection.

The contract is a design and implementation boundary for each supported action type:

```text
Mode Action Contract
  -> key moment definition
  -> positive and negative trigger boundaries
  -> card userAction / whyNow / evidence / outputPromise
  -> accepted generation shape
  -> transient post-call artifact shape
  -> grounding and no-invention rules
  -> fixture and quality metrics
```

The runtime flow stays on the existing dynamic-action path:

```text
transcript + recent context + materials + screen + business context
  -> IntentClassifier / DynamicActionDetector / SemanticGate
  -> DynamicActionEngine
  -> DynamicActionProductContract
  -> DynamicActionCard
  -> accept / dismiss / generated_failed metrics
  -> generate-what-to-say
  -> transient ActionArtifact
  -> post-call summary context
```

The key implementation principle is to make existing action types stricter and more useful, not to create a broad new trigger garden.

## Transient Action Artifact

Accepted actions need a structured meaning that post-call summary can consume. This work must not add database schema, so `ActionArtifact` is a transient shape derived from existing dynamic action state, generated content, quality events, and session context.

```ts
interface ActionArtifact {
  actionId: string;
  modeTemplateType: 'sales' | 'fde' | 'team-meet';
  actionType: string;
  outputType: 'spoken_response' | 'checklist' | 'email_draft' | 'action_item' | 'decision_record';
  structuredSummary: string;
  missingFields: string[];
  groundedSources: Array<{
    type: 'material' | 'pptx' | 'screen' | 'business_context' | 'transcript';
    label: string;
    status: 'used' | 'not_found' | 'scope_denied' | 'failed';
  }>;
  acceptedAt: number;
  generationStatus: 'completed' | 'generated_failed' | 'not_generated';
}
```

The artifact is not a persisted database record. It is an internal semantic shape used to:

- Build generation prompts for accepted actions.
- Feed post-call summary context.
- Validate mode-specific answer quality in tests.
- Preserve accepted Team Meeting actions in post-call notes without inventing missing fields.

### Artifact Construction Boundary

The first implementation must add a small helper boundary rather than spreading artifact logic across IPC, renderer, and post-call code:

```ts
interface BuildDynamicActionArtifactsInput {
  actions: Array<{
    id: string;
    modeTemplateType: string;
    type: string;
    productContract: {
      outputType: ActionArtifact['outputType'];
    };
    status: 'accepted' | 'auto_generated' | 'completed' | 'generated_failed' | string;
    createdAt: number;
    latestTurn?: string;
    retrievalQuery?: string;
  }>;
  usage: Array<{
    question?: string;
    answer?: string | string[] | null;
    type?: string;
    timestamp?: number;
    metadata?: unknown;
  }>;
  qualityEvents?: Array<{
    answerId?: string;
    eventType?: string;
    metadata?: unknown;
  }>;
}

function buildDynamicActionArtifacts(input: BuildDynamicActionArtifactsInput): ActionArtifact[];
```

Rules:

- Use existing dynamic action state as the source of truth for `actionId`, `modeTemplateType`, `actionType`, `outputType`, `acceptedAt`, and `generationStatus`.
- Use existing `usage` records as the source of truth for generated answer text. Do not add database fields.
- If the usage record cannot be matched to an accepted action, still produce a conservative artifact from the action itself with `generationStatus: 'not_generated'`.
- Match usage to actions by the dynamic-action source metadata when available; otherwise use the nearest dynamic-action usage item in the same session after `acceptedAt`.
- Derive `missingFields` with deterministic text helpers per mode. Do not ask the LLM to infer whether fields are missing.
- Derive `groundedSources` from existing citations, context trace, degraded reason, and mode event metadata when present. If not present, use `transcript` with status `used` only when the artifact is based on the accepted action text.

### Post-Call Integration Boundary

`PostCallWorkflow.buildPostCallEnhancements()` should accept artifacts as an optional input:

```ts
buildPostCallEnhancements({
  transcript,
  modeTemplateType,
  summaryData,
  dynamicActionArtifacts,
});
```

Rules:

- Existing callers without `dynamicActionArtifacts` must behave exactly as they do today.
- Team Meeting summaries must preserve accepted action, decision, deadline, and blocker artifacts in the matching post-call sections.
- Sales and FDE summaries may use artifacts as follow-up and coaching context, but they must not invent facts that are absent from `structuredSummary` or trusted grounding.
- If an artifact is `generated_failed` or `not_generated`, post-call may mention the accepted action only as a pending/missing item. It must not fabricate the generated content.
- This boundary keeps the "no new database schema" decision honest: the bridge is existing dynamic actions + existing usage + optional quality events + post-call input.

### No-Database Contract

This work must include contract tests that fail if implementation adds schema for dynamic action artifacts:

- No new migration version solely for action artifacts.
- No `dynamic_action_artifacts` table.
- No new dynamic-action artifact columns on `meetings` or `ai_interactions`.
- No renderer localStorage persistence for artifacts.

If later product work needs durable editable artifacts, that must be a separate spec because it changes data retention and user-visible editing behavior.

## Sales Mode

### Product Goal

Sales mode should become the first clearly sellable sample: it helps a seller win the next step in a real customer call without inventing facts.

### Key Moments

| Moment | Action Type | Card Promise | Accepted Output |
| --- | --- | --- | --- |
| Pricing objection | `pricing_objection` | Respond to pricing objection | Spoken short response |
| Quote request | `pricing_request` | Draft quote follow-up | Email draft with placeholders |
| Case / proof request | `case_study_request`, `roi_question` | Provide grounded proof points | Grounded proof points |
| Technical / integration requirement | `technical_requirements` | Clarify validation path | Checklist |
| Buying / advancement signal | `buying_signal` | Lock next step | Owner / date / artifact checklist |

### Product Rules

- `pricing_objection` output must be a spoken response, not a value-point list. Its answer style should converge on `short_script`.
- `pricing_request` must not invent customer names, prices, contract terms, or quote numbers. Missing values use placeholders such as `[CUSTOMER_NAME]`, `[QUOTE_AMOUNT]`, and `[NEXT_STEP]`.
- `case_study_request` and `roi_question` must prefer uploaded materials, PPTX sales decks, FAQ, pricing policy, security notes, or other material RAG sources. If no relevant source is found, the output must say that no citeable case or proof point was found.
- `technical_requirements` must ask clarifying questions about systems, APIs, auth, SSO, deployment environment, security constraints, owner, and the smallest validation step. It must not promise unsupported capabilities.
- `buying_signal` must lock or ask for next step, owner, date, and artifact. It must not only congratulate the prospect.
- Internal seller-side discussion in Sales mode can inform context but must not be treated as customer demand unless the speaker or wording makes that clear.

### Quality Gates

- 50 Sales fixtures across Chinese, English, and mixed Chinese-English.
- High-value Sales moment recall greater than 80%.
- Pricing false positive rate below 10%.
- At least 80% of accepted Sales outputs should be directly speakable or sendable with minimal editing in fixture review.
- Every Sales action must have accepted, dismissed, and generated_failed lifecycle coverage.

### Tests

- `SalesDynamicActionProductFixtures.test.mjs`
- `SalesDynamicActionAnswerQuality.test.mjs`
- `SalesActionCardUx.contract.test.mjs`

The tests should cover positive and negative examples, including pricing objections, quote requests, proof requests without material grounding, technical requirement clarification, and buying signals.

## FDE Mode

### Product Goal

FDE mode should focus on manufacturing PLM / QMS / enterprise AI Agent deployment. It is not a generic technical support mode.

The mode helps a field engineer turn customer-site discussion into a verifiable delivery plan across process, data, permissions, quality loop, AI Agent feasibility, and launch governance.

### Default FDE Profile

The default FDE context must describe a user who:

- Understands manufacturing R&D flows: part, BOM, drawing, ECR, ECO, ECN, review, release, version, and permissions.
- Understands quality flows: NCR, CAPA, 8D, complaint, audit, inspection, traceability, deviation, and closure verification.
- Understands enterprise AI Agent deployment: knowledge sources, permission boundaries, tool calls, approval flows, human-in-the-loop controls, evaluation, and launch governance.
- Does not commit to customer processes, write to business systems, or present unknown business rules as facts.

### Key Moments

| Moment | Action Type | Card Promise | Accepted Output |
| --- | --- | --- | --- |
| Business process discovery | `fde_discovery_probe` | Clarify manufacturing process | 3 process questions |
| System object clarification | `fde_integration_check` | Confirm business objects and boundaries | Object / system / permission checklist |
| Integration and permission clarification | `fde_integration_check` | Lock integration validation step | Minimum validation step |
| AI Agent feasibility | `fde_agent_feasibility` | Identify automation boundary | Human confirmation points and non-automation boundary |
| Risk / compliance / validation | `fde_security_review`, `fde_risk_blocker` | Record delivery risk | Risk record |
| Next step lock | `fde_next_step`, `fde_success_criteria` | Lock delivery next step | Owner / date / artifact checklist |

### Product Rules

- FDE cards must be organized around manufacturing process progress, not technical keywords.
- System object clarification should reuse `fde_integration_check` in the first implementation phase. Do not add a separate persisted concept for it.
- `fde_agent_feasibility` may be added as an action type because AI Agent automation boundary is a distinct key moment with distinct answer requirements. It must not require new UI or database schema.
- Outputs should be short, concrete, and sayable in the meeting.
- Every FDE output must express what information is missing when critical details are absent.
- Security and compliance cards must be conservative. They cannot promise quality, audit, permission, or data residency capabilities without trusted context.
- Risk cards must distinguish customer process risk, system permission risk, delivery risk, AI Agent misjudgment risk, and missing information.
- Next-step cards must ask for owner, date, artifact, test data, validation object, and acceptance criteria when missing.
- AI Agent cards must include human confirmation points and non-automation boundaries. They must not imply automatic PLM / QMS writes.
- Windchill, PLM, QMS, or business-system context is read-only grounding. Missing or failed lookups must degrade explicitly instead of inventing facts.
- Scenario profile and custom context should be reused through existing profile, mode context, material, and retrieval paths. No new UI is required in this scope.

### Quality Gates

- 40 FDE fixtures.
- Recall greater than 75% across PLM process, QMS process, AI Agent feasibility, permission / compliance, and risk / next-step moments.
- False positive rate below 10% for unrelated technical small talk.
- Accepted output average length below 120 English words or 180 Chinese characters.
- Every AI Agent deployment suggestion contains human confirmation points and non-automation boundaries.

### Tests

- `FdeDynamicActionProductFixtures.test.mjs`
- `FdeActionAnswerShape.test.mjs`
- `FdeScreenAndMaterialContext.test.mjs`
- `FdeManufacturingScenarioProfile.test.mjs`

The tests should cover screen and PPTX grounding, Windchill read-only facts, conservative fallback when business context is unavailable, and manufacturing-specific scenario profile use.

## Team Meeting Mode

### Product Goal

Team Meeting mode should turn meeting-time verbal commitments into clear actions, decisions, and blockers. It is not a Sales assistant and not only a post-call summarizer.

### Key Moments

| Moment | Action Type | Card Promise | Accepted Output |
| --- | --- | --- | --- |
| Action item | `action_item` | Confirm owner and deadline | Owner / deliverable / due date |
| Deadline | `owner_deadline_check` | Complete task timeline | Missing-field follow-up |
| Decision | `decision_point` | Record current decision | Decision / rationale / reversibility |
| Blocker | `blocker_check` | Clarify blocker and unblock path | Blocker / impact / dependency / next unblock step |

### Product Rules

- `action_item` must extract owner, deliverable, and due date. If any field is missing, both card copy and generated content must say what is missing rather than guessing.
- `decision_point` must separate a real decision from discussion options. Brainstorming, tentative preference, or unresolved debate must not be recorded as a decision.
- `blocker_check` must include blocker, impact, dependency, and next unblock step.
- Mode isolation must remain strict. Team Meeting text such as "our pricing sheet is here" must not trigger Sales quote actions.
- Accepted Team actions must be available to post-call summary as transient artifacts derived from existing data. The summary should preserve accepted action items, decisions, and blockers without inventing missing fields.

### Quality Gates

- 30 Team Meeting fixtures.
- Action item recall greater than 85%.
- Action item owner / deliverable / due date completeness greater than 70%.
- Decision false positive rate below 10%.
- Post-call summary preserves accepted card artifacts greater than 90%.

### Tests

- `TeamMeetingDynamicActionProductFixtures.test.mjs`
- `TeamMeetingActionItemCompleteness.test.mjs`
- `PostCallDynamicActionCarryover.test.mjs`

The tests should cover explicit action items, missing-field prompts, decisions versus discussion, blockers, and cross-mode isolation.

## Fixture Schema And Scoring

All mode product tests should use one shared fixture shape so recall and false-positive numbers mean the same thing across Sales, FDE, and Team Meeting.

```ts
interface DynamicActionProductFixture {
  id: string;
  modeTemplateType: 'sales' | 'fde' | 'team-meet';
  language: 'zh' | 'en' | 'mixed';
  transcriptTurns: Array<{
    speaker: 'user' | 'customer' | 'teammate' | 'internal' | string;
    text: string;
    final?: boolean;
  }>;
  expected: {
    shouldEmit: boolean;
    actionType?: string;
    outputType?: ActionArtifact['outputType'];
    requiredCardCopy?: string[];
    forbiddenCardCopy?: string[];
    requiredAnswerPatterns?: string[];
    forbiddenAnswerPatterns?: string[];
    requiredMissingFields?: string[];
    requiredGrounding?: Array<'material' | 'pptx' | 'screen' | 'business_context' | 'transcript'>;
  };
  negativeReason?: 'wrong_mode' | 'internal_chatter' | 'low_value' | 'missing_evidence' | 'unrelated_small_talk';
}
```

Scoring:

- Recall denominator: fixtures with `expected.shouldEmit === true`.
- Recall numerator: expected action type emitted, survives semantic gate, and product contract output type matches.
- False positive denominator: fixtures with `expected.shouldEmit === false`.
- False positive numerator: any visible card emitted for the forbidden scenario.
- Answer quality pass: all `requiredAnswerPatterns` match and no `forbiddenAnswerPatterns` match.
- Grounding pass: required grounding sources are present, or the answer explicitly reports no citeable source when grounding is unavailable.
- Missing-field pass: all `requiredMissingFields` appear in the artifact and generated output.

Deterministic unit tests should own threshold math. Real LLM, real STT, real PPTX, and real business-system calls are allowed only in gated smoke tests with explicit environment prerequisites.

## Error Handling and Degradation

- Material, PPTX, RAG, Windchill, PLM, QMS, or business context not found: say no citeable source or read-only fact was found.
- Scope denied: do not use restricted context; surface the degradation through existing context health and answer status paths.
- Generation failed: keep the card in failed state and record `generated_failed`.
- Low-confidence or recently dismissed similar candidates: stay silent and record diagnostics only.
- Emotion metadata may boost or qualify an existing signal but cannot trigger an action alone.
- Post-call carryover without completed generation may use the accepted action's structured summary, but must not invent missing details.

## Acceptance Commands

Core commands:

```bash
rtk npm run test:quality:gate
rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs
rtk node --test electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
```

New mode productization tests:

```bash
rtk node --test electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs
rtk node --test electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs
rtk node --test src/components/__tests__/SalesActionCardUx.contract.test.mjs
rtk node --test electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs
rtk node --test electron/services/__tests__/FdeActionAnswerShape.test.mjs
rtk node --test electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs
rtk node --test electron/services/__tests__/FdeManufacturingScenarioProfile.test.mjs
rtk node --test electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs
rtk node --test electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs
rtk node --test electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs
rtk node --test electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs
rtk node --test electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs
rtk node --test electron/services/__tests__/DynamicActionNoDbSchema.contract.test.mjs
```

Full verification should still run the project build and type checks before landing implementation:

```bash
rtk npm run build:electron
rtk npm run typecheck:electron
rtk npm run build
```

## Implementation Order

1. Sales mode contract and fixtures.
2. Sales answer quality and card UX tests.
3. FDE default profile and manufacturing action contracts.
4. FDE screen, material, and business-context grounding tests.
5. Team Meeting action artifact semantics.
6. Post-call carryover tests for accepted Team actions.
7. Shared fixture scoring and no-database contract tests.
8. Final quality gate and full build verification.

Each phase should be shippable on its own and should not rely on unfinished later phases.
