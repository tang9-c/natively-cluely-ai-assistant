# Sales Industrial Discovery Design

## Summary

Upgrade sales mode so industrial software sales conversations trigger a single discovery-oriented action card instead of pushing the assistant toward premature product answers.

The goal is to help the seller ask better questions when the customer is describing pain, capability fit, process integration, value pressure, or contextual proof needs in PLM, QMS, ERP, MES, ALM, 3D design software, and AI Agent scenarios.

This design adds five sales semantic intents and maps all five to one dynamic action type: `discovery_question`.

When the user accepts the card, the assistant must output only 1-3 questions that can be asked directly to the customer. It must not answer product capability, invent cases, invent ROI, or wait on slow external context before generating the questions.

## Goals

- Recognize industrial software sales discovery moments in sales mode.
- Keep UI simple by adding only one new action card: `discovery_question`.
- Make accepted output question-first and fact-seeking.
- Preserve existing sales actions for pricing, quote, proof, technical requirements, and buying signals.
- Reuse existing intent classification, semantic gate, dynamic action, product contract, context decision, and accepted-output evaluation paths.
- Avoid new database schema, UI systems, retrieval systems, model providers, or technology stacks.

## Non-Goals

- Do not turn sales mode into an industrial software expert answer bot.
- Do not create separate action cards for each new intent.
- Do not rewrite RAG, Windchill, business-system, STT, summary, or provider routing.
- Do not add PLM/QMS/ERP/MES writeback or automated enterprise-system operations.
- Do not make Material RAG or Windchill required for `discovery_question`.
- Do not claim the product has a capability, case study, ROI metric, or customer reference unless grounded by existing trusted context outside this action.

## Existing Architecture

The current sales path already has the right extension points:

- `IntentClassifier` identifies mode-aware intents.
- `DynamicActionEngine` maps intents to dynamic action types.
- `ModeEventClassifier` gates candidates with local and cloud semantic arbitration.
- `DynamicActionProductContract` defines user-facing card text, output type, risk state, and context need.
- `ContextNeedDecision` tells `generate-what-to-say` whether material, business, or screen context should block, be used if ready, or be skipped.
- Accepted-output evaluators and QA tests validate generated answer shape.

The new design should fit these surfaces instead of adding a parallel sales subsystem.

## New Sales Intents

Add five top-level sales semantic intents:

- `sales_pain_discovery`: customer is describing pain, current-state friction, manual work, process breaks, or operational drag.
- `sales_capability_fit`: customer is asking whether a capability fits a product, process, role, object, workflow, or validation need.
- `sales_process_integration`: customer is discussing cross-system process, data flow, synchronization, handoff, or closed-loop operation.
- `sales_value_discovery`: customer is discussing efficiency, quality, rework, delay, audit pressure, cost of manual work, or success metrics.
- `sales_contextual_proof_discovery`: customer asks for proof, cases, ROI, or similar customers, but with concrete industry, workflow, system, object, or data-context constraints.

These are sales-mode intents. They should not affect general, FDE, team-meet, recruiting, lecture, technical-interview, or looking-for-work behavior.

## Action Mapping

All five new intents map to one dynamic action type:

```text
sales_pain_discovery              -> discovery_question
sales_capability_fit              -> discovery_question
sales_process_integration         -> discovery_question
sales_value_discovery             -> discovery_question
sales_contextual_proof_discovery  -> discovery_question
```

The action card contract:

- `type`: `discovery_question`
- `userAction`: `追问关键问题`
- `outputType`: `spoken_response`
- `outputPromise`: `生成 1-3 个可直接问客户的发现问题`
- `riskState`: existing normal risk handling unless confidence qualifies for existing auto surface policy.

The action should carry the underlying semantic intent through existing mode event, semantic gate, or answer-style fields. Do not add a new UI card per intent.

## Intent Classification Strategy

Use two tiers.

Tier 1 is local high-confidence detection. It should only cover explicit industrial software discovery patterns. It must not treat a single domain token such as `BOM`, `Creo`, `QMS`, or `AI Agent` as enough to trigger the card.

Tier 2 is the existing cloud classifier. It should be the primary path for natural phrasing, mixed Chinese/English, and complex sentences.

Examples that should be recognized:

- `现在 CAPA、NCR 都在 Excel 里跟，审计很痛苦。` -> `sales_pain_discovery`
- `BOM 变更和质量问题能不能关联起来？` -> `sales_capability_fit`
- `ERP 物料主数据和 PLM 的 BOM 经常不一致。` -> `sales_process_integration`
- `现在返工太多，质量闭环周期很长。` -> `sales_value_discovery`
- `有没有类似客户把 Creo 设计变更、Windchill ECO 和 QMS CAPA 打通的案例？` -> `sales_contextual_proof_discovery`

Existing sales intent behavior must remain:

- Clear pricing objection -> `sales_pricing_objection`
- Clear quote or proposal request -> `sales_quote_request`
- Generic case request -> `sales_proof_request`
- Clear API, SSO, security, deployment, or production technical requirements -> `sales_technical_requirements`
- Contract, pilot, legal, procurement, or next-step signal -> `sales_buying_signal`

## Semantic Gate Strategy

`discovery_question` is not a trivial low-risk fast path. It changes what appears in the live meeting UI, so it needs explicit gate behavior.

Rules:

- If the intent result has high confidence and confirms one of the five new discovery intents, local gate may pass.
- If the transcript has negation, contrast, multiple candidates, English/mixed language, or a high-risk old sales action candidate, use cloud semantic gate when provider scope allows transcript.
- If provider scope denies transcript, do not call cloud gate. Use only local high-confidence pass or defer.
- Keep old high-risk sales actions prioritized over discovery when the customer clearly asks for pricing, quote, generic proof, technical requirements, or buying next step.
- The sentence `先不谈价格，我们要看 PLM/QMS 闭环案例` must not trigger pricing. It should trigger `sales_contextual_proof_discovery`.

## ContextNeedDecision

`discovery_question` must not wait on Material RAG, Windchill, business-system context, or screen understanding before generating questions.

The contract should be:

```ts
{
  material: 'use_if_ready',
  business: 'use_if_ready',
  screen: 'not_needed',
  confidence: action.confidence,
  reason: 'Discovery questions should use ready context only and must not wait for external retrieval.',
  decidedBy: 'dynamic_action_contract'
}
```

Meaning:

- Use already-ready material context if it exists.
- Use already-ready business-system context if it exists.
- Do not wait for Material RAG or Windchill queries.
- Do not block generation because RAG, embeddings, or business-system context is unavailable.
- Do not use screen context in the first version unless future evidence explicitly justifies it.

This protects the user experience: clicking the card should quickly produce useful questions, not hang while the client searches documents.

## Accepted Output Contract

When the user accepts `discovery_question`, the generated answer must:

- Contain only 1-3 questions.
- Be directly speakable to the customer.
- Anchor at least one question to a system, process, object, role, or metric from the customer utterance.
- Ask for missing facts instead of supplying them.

It must not:

- State product capability.
- Say `我们支持`, `我们可以`, `产品能够`, or equivalent capability claims.
- Invent customer names, ROI, benchmark metrics, percentages, amounts, dates, industry references, or case-study facts.
- Produce a generic industrial software explanation.
- Turn into an email, checklist, or long answer.

Intent-specific question direction:

- `sales_pain_discovery`: ask about the process break, who fills the gap, current workaround, and impact.
- `sales_capability_fit`: ask about target workflow, required object, acceptance criteria, and validation method.
- `sales_process_integration`: ask about source system, target system, data direction, read/write boundary, and ownership.
- `sales_value_discovery`: ask about cycle time, cost, quality impact, audit pressure, and success metric.
- `sales_contextual_proof_discovery`: ask about industry/process match, system combination, data object, and success metric needed to match a future case.

## Output Evaluation

Prompting is not enough. The implementation must add or extend accepted-output evaluation for `discovery_question`.

Evaluator requirements:

- Pass if output contains 1-3 customer-facing questions.
- Pass only if at least one question references a concrete object from the source utterance when available.
- Fail if output contains capability claims.
- Fail if output contains invented customer names, ROI values, percentages, amounts, or benchmark metrics not present in input.
- Fail if output is a product explanation instead of questions.
- Fail if output is empty or only meta commentary.

This evaluator should be covered by tests with representative generated outputs.

## Test Matrix

Create a structured fixture matrix with fields:

- `domain`
- `utterance`
- `expectedIntent`
- `expectedAction`
- `mustNotIntent`
- `notes`

Minimum domain coverage:

- PLM
- QMS
- ERP
- MES
- ALM
- 3D design software / Creo / CAD
- AI Agent

Each domain must include at least one positive fixture for every new intent:

- `sales_pain_discovery`
- `sales_capability_fit`
- `sales_process_integration`
- `sales_value_discovery`
- `sales_contextual_proof_discovery`

This creates at least 35 positive fixtures.

Each domain must include at least one negative fixture, for at least 7 negative fixtures.

Add 8-12 conflict regression fixtures covering:

- `先不谈价格...` should not trigger pricing.
- Generic case request should still trigger `sales_proof_request`.
- Contextual case request should trigger `sales_contextual_proof_discovery`.
- API/SSO/security/deployment should still trigger `sales_technical_requirements`.
- Quote/proposal request should still trigger `sales_quote_request`.
- Contract/legal/pilot/next step should still trigger `sales_buying_signal`.
- Internal material names, pricing docs, meeting titles, or uploaded file titles should not trigger customer-need discovery by themselves.

## Test Files

Add or update:

- `electron/llm/__tests__/SalesIndustrialIntent.test.mjs`
- `electron/services/__tests__/SalesIndustrialDiscoveryActions.test.mjs`
- `electron/services/__tests__/SalesIndustrialDiscoveryOutput.test.mjs`
- Existing sales intent tests.
- Existing dynamic action product contract tests.
- Existing mode event classifier tests.
- Existing accepted-output evaluator tests.

Do not isolate all coverage in new test files if existing regression suites already own part of the behavior.

## Acceptance Criteria

- All 35 positive fixtures classify to the expected new sales intent.
- All new sales intents map to `discovery_question`.
- `discovery_question` product contract returns `追问关键问题`.
- `discovery_question` context need uses ready-only material/business context and does not require screen.
- Accepted output contains only 1-3 questions.
- Accepted output does not include capability claims or invented cases/ROI.
- Pricing, quote, generic proof, technical requirements, and buying signal regressions still pass.
- No database schema, provider routing, STT, summary, RAG algorithm, or renderer layout changes are required.

## Suggested Implementation Surfaces

The plan should inspect and update these files as needed:

- `electron/llm/IntentClassifier.ts`
- `electron/llm/IntentClassifierShared.ts`
- `electron/llm/IntentKeywordDefaults.ts`
- `electron/services/dynamic-actions/DynamicActionDetector.ts`
- `electron/services/dynamic-actions/DynamicActionEngine.ts`
- `electron/services/dynamic-actions/ModeEventClassifier.ts`
- `electron/services/dynamic-actions/DynamicActionProductContract.ts`
- `electron/services/context/ContextNeedDecision.ts`
- `electron/services/dynamic-actions/DynamicActionAcceptedOutputEvaluator.ts`
- `src/types/electron.d.ts` only if exposed action payload typing requires an update.

## Validation Commands

The implementation plan should include at least:

```bash
rtk npm run build:electron
rtk npm run typecheck:electron
rtk npm run test:dynamic-actions:product
rtk npm run test:quality:gate:no-build
```

It should also include the new targeted sales industrial discovery tests once created.
