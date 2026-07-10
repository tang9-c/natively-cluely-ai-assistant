# Dynamic Action Step 3 Step 4 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring FDE mode and Team Meeting mode from "foundation exists" to 100% product DoD completion, with mode-level fixture gates proving recall, false-positive, accepted-output, grounding, missing-field, and post-call carryover quality.

**Architecture:** Reuse the existing dynamic action pipeline: `DynamicActionDetector`, `DynamicActionEngine`, `DynamicActionProductContract`, `DynamicActionArtifacts`, `DynamicActionFixtureRunner`, and `PostCallWorkflow`. Do not add a new feature stack, UI, persistence model, or generic MCP framework. The repair is a tightening pass: make existing fixture schemas executable, reduce false positives, add deterministic accepted-output evaluators, and carry accepted Team Meeting artifacts through post-call notes.

**Tech Stack:** Electron main TypeScript, Node test runner `.mjs`, existing JSON fixtures under `tests/fixtures/dynamic-actions/product`, existing scripts `test:dynamic-actions:product` and `test:dynamic-actions:fde-replay:real-stt`.

## Global Constraints

- Do not create a new worktree unless the user explicitly asks.
- Do not add new product surfaces or a new scene-profile subsystem.
- FDE must remain a manufacturing PLM / QMS / enterprise AI Agent deployment copilot, not a generic field engineer assistant.
- FDE must preserve readonly, human confirmation, no writeback, and no invented business rules.
- Team Meeting must capture meeting commitments, not become a generic summary generator.
- Product runners must expose mode-level metrics, not only aggregate metrics.
- Release gates must run through `DynamicActionEngine.assessSignals()` by default. `detectActions()` is allowed only as a legacy regex smoke path or backcompat test, not as the product-quality gate.
- Accepted-output validation must exercise the real accept/generate/artifact path: action candidate -> accepted usage metadata -> `buildDynamicActionArtifacts()` -> evaluator -> post-call carryover. Fixture-only answer samples are allowed as unit fixtures, but they cannot be the only release gate.
- Fixture schema changes must be explicit TypeScript contract changes in `DynamicActionProductFixtures.ts`; do not rely on ad hoc JSON fields that the runner ignores.
- False-positive fixes must be fixture-root-caused before implementation. Every suppression must name the fixture id, wrong action, reason, fix type, and at least one positive guard fixture that must still pass.
- Completion means all listed gates pass: FDE recall > 75%, FDE false positive < 10%, Team recall > 85%, Team false positive < 10%, Team accepted-card carryover > 90%, and all accepted-output shape tests pass.

---

## Current Verified Gap

- FDE product fixtures: 40 total, 30 positive, 10 negative.
- FDE current product runner result: recall 29/30 = 96.7%, false positive 8/10 = 80.0%.
- Team Meeting product fixtures: 30 total, 22 positive, 8 negative.
- Team current product runner result: recall 16/22 = 72.7%, false positive 3/8 = 37.5%.
- Existing product fixture type supports `requiredAnswerPatterns`, `forbiddenAnswerPatterns`, and `requiredMissingFields`, but it does not yet have typed accepted grounding expectations. `DynamicActionFixtureRunner` currently evaluates only card text patterns.
- Existing product runner still depends on `detectActions()` in the QA path. Production dynamic actions use `assessSignals()`, so release gating can currently pass a regex-only path that the product does not use.
- Existing fixture schema does not define `expected.acceptedAnswer`, accepted grounding sources, accepted missing fields, or assessment context. Any plan step that writes those JSON fields must first add the TypeScript contract and runner support.
- Team post-call carryover currently admits `action_item` and `owner_deadline_check`, but not `decision_point` and `blocker_check`.
- Team post-call carryover should not stuff decisions and blockers into the existing capped action-item list. The carryover metric must count accepted artifacts across dedicated structured sections.

## File Structure

- Modify `electron/services/dynamic-actions/DynamicActionProductFixtures.ts`
  - Add per-mode score structure, assessment context fields, and accepted-output / grounding / missing-field scoring helpers.
- Modify `electron/services/qa/DynamicActionFixtureRunner.ts`
  - Evaluate fixture `requiredAnswerPatterns`, `forbiddenAnswerPatterns`, `requiredMissingFields`, and accepted grounding fields.
  - Run fixtures through `assessSignals()` by default, with a named `regex` compatibility mode only where a test explicitly asks for it.
  - Include per-mode reports in `product-report.json` and `product-report.md`.
- Modify `scripts/run-dynamic-actions-product.mjs`
  - Print per-mode summary and fail when FDE or Team Meeting gates are below target.
- Modify `tests/fixtures/dynamic-actions/product/fde.json`
  - Add card and accepted-output expectations.
  - Keep 40 fixtures.
  - Convert negative fixture expectations into executable false-positive gates.
- Modify `tests/fixtures/dynamic-actions/product/team-meet.json`
  - Add missing-field, decision, blocker, and accepted-output expectations.
  - Keep 30 fixtures.
- Modify `electron/services/dynamic-actions/DynamicActionDetector.ts`
  - Tighten FDE negative suppression and Team deadline/blocker detection.
  - Keep mode isolation strict.
- Modify `electron/services/dynamic-actions/DynamicActionArtifacts.ts`
  - Add Team Meeting decision and blocker artifact field derivation.
  - Add FDE date, test data, and acceptance criteria missing-field derivation.
- Modify `electron/services/post-call/PostCallWorkflow.ts`
  - Carry accepted Team action item, decision, and blocker artifacts into dedicated structured post-call sections.
- Create `electron/services/dynamic-actions/FdeAcceptedOutputEvaluator.ts`
  - Deterministic evaluator for FDE accepted answers.
- Create `electron/services/dynamic-actions/TeamMeetingAcceptedOutputEvaluator.ts`
  - Deterministic evaluator for Team Meeting accepted answers.
- Create or extend tests:
  - `electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs`
  - `electron/services/__tests__/FdeActionAnswerShape.test.mjs`
  - `electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs`
  - `electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs`
  - `electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs`
  - `electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs`
  - `electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs`

---

### Task 1: Make Product Fixture Metrics Mode-Aware

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionProductFixtures.ts`
- Modify: `electron/services/qa/DynamicActionFixtureRunner.ts`
- Modify: `scripts/run-dynamic-actions-product.mjs`
- Test: `electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs`

**Interfaces:**
- Consumes: `DynamicActionProductFixture`, `DynamicActionProductFixtureResult`.
- Produces:
  - `scoreDynamicActionProductFixturesByMode(results): Record<string, DynamicActionProductScore>`
  - `DynamicActionProductFixture.assessment?: DynamicActionFixtureAssessmentContext`
  - `ProductRunnerReport.modeScores`
  - CLI JSON with `modeScores.fde` and `modeScores['team-meet']`.

- [ ] **Step 1: Add failing test for per-mode scores**

Add this test to `electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs`:

```js
test('product runner reports per-mode quality gates', async () => {
  const report = await runDynamicActionProductFixtures({
    fixtureDir,
    outputDir,
  });

  assert.ok(report.modeScores.sales);
  assert.ok(report.modeScores.fde);
  assert.ok(report.modeScores['team-meet']);
  assert.equal(typeof report.modeScores.fde.recallRate, 'number');
  assert.equal(typeof report.modeScores.fde.falsePositiveRate, 'number');
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
rtk npm run build:electron && rtk node --test electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs
```

Expected: FAIL because `modeScores` is undefined.

- [ ] **Step 3: Implement per-mode scoring**

In `DynamicActionProductFixtures.ts`, add the explicit fixture execution contract before changing JSON fixtures:

```ts
export type DynamicActionFixtureRunnerMode = 'assessSignals' | 'regex';

export interface DynamicActionFixtureAssessmentContext {
  runnerMode?: DynamicActionFixtureRunnerMode;
  intentResult?: {
    intent: string;
    confidence: number;
    source?: string;
  } | null;
  recentContextTurns?: Array<{
    speaker?: string;
    text: string;
    timestamp?: number;
  }>;
  providerDataScopes?: {
    transcript?: boolean;
    screenshots?: boolean;
    referenceFiles?: boolean;
    profileHistory?: boolean;
    embeddings?: boolean;
    postCallSummary?: boolean;
  };
}

export interface DynamicActionAcceptedGroundingExpectation {
  type: 'transcript' | 'screen' | 'material' | 'pptx' | 'business_context';
  status: 'used' | 'not_found' | 'scope_denied' | 'failed';
  label?: string;
}
```

Extend `DynamicActionProductFixture.expected` with:

```ts
acceptedAnswer?: string;
acceptedMissingFields?: string[];
acceptedGroundedSources?: DynamicActionAcceptedGroundingExpectation[];
```

Then add:

```ts
export function scoreDynamicActionProductFixturesByMode(
  results: DynamicActionProductFixtureResult[],
): Record<string, DynamicActionProductScore> {
  const grouped = new Map<string, DynamicActionProductFixtureResult[]>();
  for (const result of results) {
    const mode = result.modeTemplateType ?? 'unknown';
    grouped.set(mode, [...(grouped.get(mode) ?? []), result]);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([mode, modeResults]) => [
      mode,
      scoreDynamicActionProductFixtures(modeResults),
    ]),
  );
}
```

If `DynamicActionProductFixtureResult` does not yet include `modeTemplateType`, extend it:

```ts
modeTemplateType?: DynamicActionProductFixture['modeTemplateType'];
```

In `DynamicActionFixtureRunner.ts`, set `modeTemplateType: fixture.modeTemplateType` on each result and add `modeScores` to the report.

- [ ] **Step 4: Make `assessSignals()` the default fixture runner**

In `DynamicActionFixtureRunner.ts`, add a helper with this behavior:

```ts
const runnerMode = fixture.assessment?.runnerMode ?? 'assessSignals';

if (runnerMode === 'assessSignals') {
  const assessed = await engine.assessSignals({
    transcript: fixture.currentTranscript,
    modeTemplateType: fixture.modeTemplateType,
    modeId: fixture.modeTemplateType,
    sessionId: fixture.id,
    speaker: fixture.speaker,
    recentContextTurns: fixture.assessment?.recentContextTurns,
    intentResult: fixture.assessment?.intentResult ?? undefined,
    providerDataScopes: fixture.assessment?.providerDataScopes,
    semanticGateTraceSink: (trace) => traces.push(trace),
  });
  actions = assessed.actions;
} else {
  actions = engine.detectActions({
    transcript: fixture.currentTranscript,
    modeTemplateType: fixture.modeTemplateType,
    modeId: fixture.modeTemplateType,
    sessionId: fixture.id,
    speaker: fixture.speaker,
  });
}
```

The `regex` mode is only for legacy detector tests. Product reports must mark any `regex` fixture with `runnerMode: "regex"` so it cannot be mistaken for a product release gate.

- [ ] **Step 5: Print per-mode CLI output and enforce gates**

In `scripts/run-dynamic-actions-product.mjs`, include:

```js
const fde = report.modeScores.fde;
const team = report.modeScores['team-meet'];
console.log(JSON.stringify({
  totalFixtures: report.totalFixtures,
  recallRate: report.score.recallRate,
  falsePositiveRate: report.score.falsePositiveRate,
  modeScores: report.modeScores,
}, null, 2));

if (fde && (fde.recallRate < 0.75 || fde.falsePositiveRate >= 0.10)) process.exit(1);
if (team && (team.recallRate < 0.85 || team.falsePositiveRate >= 0.10)) process.exit(1);
```

- [ ] **Step 6: Run test and product command**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs
rtk npm run test:dynamic-actions:product
```

Expected: runner test PASS, product command FAIL until Task 3 and Task 6 fix FDE / Team gates.

---

### Task 2: Add Real Accepted-Path Harness

**Files:**
- Modify: `electron/services/qa/DynamicActionFixtureRunner.ts`
- Modify: `electron/services/dynamic-actions/DynamicActionProductFixtures.ts`
- Test: `electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs`

**Interfaces:**
- Consumes: actions returned by `DynamicActionEngine.assessSignals()`, fixture `expected.acceptedAnswer`, fixture `expected.acceptedMissingFields`, fixture `expected.acceptedGroundedSources`.
- Produces:
  - `runAcceptedActionPathForFixture(fixture, action): DynamicActionAcceptedPathResult`
  - fixture result fields `acceptedPathPassed`, `acceptedArtifact`, `acceptedOutputFailures`, `groundingFailures`, `missingFieldFailures`.

- [ ] **Step 1: Add failing runner test for real accepted path**

Add this test to `DynamicActionFixtureRunner.test.mjs`:

```js
test('product runner validates accepted output through artifact builder', async () => {
  const report = await runDynamicActionProductFixtures({
    fixtures: [{
      id: 'team-accepted-path-test',
      modeTemplateType: 'team-meet',
      currentTranscript: 'Maya 负责发布 checklist，周五前发出来。',
      speaker: 'Me',
      expected: {
        shouldEmit: true,
        actionType: 'action_item',
        acceptedAnswer: 'Owner: Maya\nDeliverable: 发布 checklist\nDue: 周五',
        acceptedMissingFields: [],
        acceptedGroundedSources: [{ type: 'transcript', status: 'used' }],
      },
    }],
    outputDir,
  });

  const [entry] = report.results;
  assert.equal(entry.acceptedPathPassed, true);
  assert.equal(entry.acceptedArtifact?.actionType, 'action_item');
  assert.deepEqual(entry.acceptedOutputFailures, []);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
rtk npm run build:electron && rtk node --test electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs
```

Expected: FAIL because accepted-path result fields are undefined.

- [ ] **Step 3: Implement accepted-path harness**

In `DynamicActionFixtureRunner.ts`, add a helper that simulates the product accept lifecycle without opening UI:

```ts
async function runAcceptedActionPathForFixture(
  fixture: DynamicActionProductFixture,
  action: DynamicAction,
): Promise<DynamicActionAcceptedPathResult> {
  const expected = fixture.expected;
  if (!expected.acceptedAnswer) {
    return { acceptedPathPassed: true, acceptedOutputFailures: [], groundingFailures: [], missingFieldFailures: [] };
  }

  const artifact = buildDynamicActionArtifacts({
    actions: [{
      ...action,
      status: 'accepted',
      acceptedAt: 1_000,
      generatedAnswer: expected.acceptedAnswer,
    }],
    usage: [{
      actionId: action.id,
      eventType: 'accepted',
      occurredAt: 1_000,
      generatedAnswer: expected.acceptedAnswer,
      generationStatus: 'completed',
    }],
  })[0];

  const missingFieldFailures = compareExpectedMissingFields(
    artifact?.missingFields ?? [],
    expected.acceptedMissingFields ?? [],
  );
  const groundingFailures = compareExpectedGrounding(
    artifact?.groundedSources ?? [],
    expected.acceptedGroundedSources ?? [],
  );
  const acceptedOutputFailures = evaluateAcceptedOutputForMode(fixture, artifact, expected.acceptedAnswer);

  return {
    acceptedPathPassed: missingFieldFailures.length === 0 && groundingFailures.length === 0 && acceptedOutputFailures.length === 0,
    acceptedArtifact: artifact,
    acceptedOutputFailures,
    groundingFailures,
    missingFieldFailures,
  };
}
```

Use local helper names that match existing runner style, but keep the data flow exactly as above: action -> accepted usage metadata -> `buildDynamicActionArtifacts()` -> evaluator.

- [ ] **Step 4: Connect accepted-path result to reports**

Add accepted-path fields to each fixture result and include counts in `product-report.json` / `product-report.md`:

```ts
answerQualityFailures: results.filter((result) => result.acceptedOutputFailures.length > 0),
groundingFailures: results.filter((result) => result.groundingFailures.length > 0),
missingFieldFailures: results.filter((result) => result.missingFieldFailures.length > 0),
```

- [ ] **Step 5: Run runner test**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs
```

Expected: PASS.

---

### Task 3: Reduce FDE False Positives Below 10%

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionDetector.ts`
- Modify: `tests/fixtures/dynamic-actions/product/fde.json`
- Test: `electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs`

**Interfaces:**
- Consumes: `DynamicActionEngine.assessSignals()` product path and `DynamicActionEngine.detectActions()` legacy smoke path.
- Produces: FDE mode score with `recallRate >= 0.75` and `falsePositiveRate < 0.10`.

- [ ] **Step 1: Add failing assertions for all 40 FDE product fixtures**

Update `FdeDynamicActionProductFixtures.test.mjs` so it loads `tests/fixtures/dynamic-actions/product/fde.json`, not only inline mini-fixtures. Assert:

```js
assert.equal(fixtures.length, 40);
assert.ok(score.recallRate >= 0.75);
assert.ok(score.falsePositiveRate < 0.10);
assert.deepEqual(score.answerQualityFailures, []);
```

- [ ] **Step 2: Run test and verify current failure**

Run:

```bash
rtk npm run build:electron && rtk node --test electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs
```

Expected: FAIL on false positive rate. Current known false positives are `fde-negative-002`, `fde-negative-003`, `fde-negative-004`, `fde-negative-005`, `fde-negative-006`, `fde-negative-007`, `fde-negative-008`, `fde-negative-010`.

- [ ] **Step 3: Create the FDE false-positive root-cause table before changing detection**

Add this table to the test failure output or to the top of `FdeDynamicActionProductFixtures.test.mjs` as executable comments. Fill it from the actual failing report before editing detection logic:

```ts
const FDE_FALSE_POSITIVE_ROOT_CAUSES = [
  {
    fixtureId: 'fde-negative-002',
    transcriptCue: '...',
    actualActionType: '...',
    whyWrong: 'not a customer manufacturing workflow / PLM / QMS / AI Agent deployment moment',
    fixType: 'negative_context_suppression',
    positiveGuardFixtureId: 'fde-positive-...',
  },
];
```

Every new suppression condition must map to one row. The positive guard fixture must still emit after the fix. Do not add broad terms such as `流程`, `权限`, `验证`, or `AI` to a global suppressor without a positive guard.

- [ ] **Step 4: Add explicit FDE suppression helper**

In `DynamicActionDetector.ts`, add a scoped helper:

```ts
function shouldSuppressFdeTrigger(type: string, transcript: string): boolean {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/(午饭|吃什么|天气|闲聊|not about deployment|random chat)/i.test(text)) return true;
  if (/(内部复盘|我们内部|not a customer ask|internal note|draft wording)/i.test(text)) return true;
  if (/(只是提到|file name|材料名|不是要查|没有客户问题)/i.test(text)) return true;
  if (type === 'fde_discovery_probe' && !/(客户|customer|PLM|QMS|BOM|ECO|ECN|CAPA|NCR|8D|流程|权限|验收|集成|AI Agent|智能体)/i.test(text)) {
    return true;
  }
  return false;
}
```

Call it only for `modeTemplateType === 'fde'` before storing an action. Keep the helper local to detector logic; do not affect Sales or Team Meeting. Also run at least one `assessSignals()` fixture and one `detectActions()` smoke fixture through the same suppression path so product and legacy behavior cannot diverge.

- [ ] **Step 5: Tighten FDE negative fixture expectations**

For each FDE negative fixture, add `expected.forbiddenCardCopy` patterns that would catch accidental card text, for example:

```json
"forbiddenCardCopy": ["PLM|QMS|AI Agent|owner|artifact|验证"]
```

Keep positive fixtures unchanged until Task 4 adds accepted-output expectations.

- [ ] **Step 6: Run FDE product test and full product runner**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs
rtk npm run test:dynamic-actions:product
```

Expected: FDE recall >= 0.75 and FDE false positive < 0.10.

---

### Task 4: Add FDE Accepted Output Evaluator and Grounding Gates

**Files:**
- Create: `electron/services/dynamic-actions/FdeAcceptedOutputEvaluator.ts`
- Modify: `tests/fixtures/dynamic-actions/product/fde.json`
- Modify: `electron/services/qa/DynamicActionFixtureRunner.ts`
- Test: `electron/services/__tests__/FdeActionAnswerShape.test.mjs`
- Test: `electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs`

**Interfaces:**
- Produces:
  - `evaluateFdeAcceptedOutput(input): { passed: boolean; failures: string[] }`
  - Input fields: `actionType`, `answerText`, `missingFields`, `groundedSources`.
  - Action-specific checks:
    - `fde_discovery_probe`: 3 manufacturing-process clarification questions. It does not require owner/date/artifact unless the accepted answer claims a next step.
    - `fde_next_step` / `fde_success_check`: owner, date, artifact, test data, and acceptance criteria must be present or explicitly asked for.
    - `fde_risk_blocker`: must split customer process risk, system permission risk, delivery risk, AI Agent false-judgment risk, and information gap.
    - `fde_agent_feasibility`: must include human confirmation and no-writeback / read-only boundary.
    - `fde_integration_check`: must clarify PLM/QMS/ERP/MES/document/SSO boundary and data direction, without promising unverified capability.

- [ ] **Step 1: Write evaluator tests**

Add cases to `FdeActionAnswerShape.test.mjs`:

```js
test('fde discovery output requires three manufacturing clarification questions', () => {
  const result = evaluateFdeAcceptedOutput({
    actionType: 'fde_discovery_probe',
    answerText: '1. ECO 当前谁发起？\n2. BOM 发布权限在哪个角色？\n3. CAPA 是否需要闭环验证？',
    missingFields: [],
    groundedSources: [{ type: 'transcript', status: 'used' }],
  });
  assert.equal(result.passed, true);
});

test('fde agent output rejects automatic PLM QMS writeback promises', () => {
  const result = evaluateFdeAcceptedOutput({
    actionType: 'fde_agent_feasibility',
    answerText: 'AI Agent 可以自动审批并写入 PLM。',
    missingFields: [],
    groundedSources: [{ type: 'transcript', status: 'used' }],
  });
  assert.equal(result.passed, false);
  assert.match(result.failures.join('\\n'), /human confirmation|no writeback|人工确认|不可自动写入/i);
});
```

- [ ] **Step 2: Implement evaluator**

Create `FdeAcceptedOutputEvaluator.ts`:

```ts
export interface FdeAcceptedOutputEvaluationInput {
  actionType: string;
  answerText: string;
  missingFields: string[];
  groundedSources: Array<{ type: string; status: string }>;
}

export function evaluateFdeAcceptedOutput(input: FdeAcceptedOutputEvaluationInput): { passed: boolean; failures: string[] } {
  const text = input.answerText.trim();
  const failures: string[] = [];
  if (text.length > 180 && /[\u4e00-\u9fff]/.test(text)) failures.push('answer_too_long_zh');
  if (text.split(/\s+/).length > 120 && !/[\u4e00-\u9fff]/.test(text)) failures.push('answer_too_long_en');
  if (/自动(?:审批|写入|更新|创建)|auto(?:matically)? (?:approve|write|update|create)|write back without/i.test(text)) failures.push('no_writeback_boundary');
  if (/next|success|integration/.test(input.actionType)) {
    if (!/(缺|missing|需要确认|确认|owner|负责人|date|日期|artifact|验证产物|测试数据|验收标准)/i.test(text)) {
      failures.push('missing_gap_expression');
    }
  }
  if (/agent|AI Agent|智能体/i.test(input.actionType + text)) {
    if (!/(人工确认|human confirmation|人审)/i.test(text)) failures.push('missing_human_confirmation');
    if (!/(只读|read-only|不可自动化|不可自动写入|no writeback)/i.test(text)) failures.push('missing_automation_boundary');
  }
  if (/risk|blocker/.test(input.actionType)) {
    for (const pattern of ['客户流程风险', '系统权限风险', '我们交付风险', 'AI Agent 误判风险', '信息缺失']) {
      if (!text.includes(pattern)) failures.push(`missing_${pattern}`);
    }
  }
  if (input.actionType === 'fde_discovery_probe') {
    const questionCount = (text.match(/[?？]/g) ?? []).length;
    if (questionCount < 3) failures.push('missing_three_questions');
  }
  if (input.groundedSources.length === 0) failures.push('missing_grounding');
  return { passed: failures.length === 0, failures };
}
```

- [ ] **Step 3: Wire runner to evaluate accepted answer fields**

In `DynamicActionFixtureRunner.ts`, evaluate `requiredAnswerPatterns`, `forbiddenAnswerPatterns`, `acceptedMissingFields`, and `acceptedGroundedSources` when fixture expectations include them. For FDE fixtures, call `evaluateFdeAcceptedOutput` against the accepted artifact produced by Task 2. `expected.acceptedAnswer` is only the deterministic generated text used to drive the artifact builder; the gate must fail if the artifact path drops missing fields or grounding.

- [ ] **Step 4: Extend FDE fixtures**

Add these expectation fields to every positive FDE fixture:

```json
"forbiddenAnswerPatterns": ["自动写入|自动审批|auto-write|automatically approve"],
"acceptedGroundedSources": [{ "type": "transcript", "status": "used" }]
```

For `fde_next_step` and `fde_success_check`, require:

```json
"requiredAnswerPatterns": ["owner|负责人", "date|日期|截止", "artifact|验证产物|交付物", "测试数据|test data", "验收标准|acceptance criteria"],
"acceptedMissingFields": []
```

For `fde_discovery_probe`, require three manufacturing clarification questions, but do not require owner/date/artifact unless the fixture is explicitly a next-step fixture:

```json
"requiredAnswerPatterns": ["\\?|？", "ECO|BOM|CAPA|NCR|PLM|QMS|权限|流程"]
```

For `fde_agent_feasibility`, require:

```json
"requiredAnswerPatterns": ["人工确认|human confirmation", "只读|read-only|不可自动写入|no writeback"]
```

For `fde_risk_blocker`, require:

```json
"requiredAnswerPatterns": ["客户流程风险", "系统权限风险", "我们交付风险", "AI Agent 误判风险", "信息缺失"]
```

- [ ] **Step 5: Add screen/material/business-context grounding tests**

In `FdeScreenAndMaterialContext.test.mjs`, add deterministic cases for:

```js
assert.equal(evaluateFdeAcceptedOutput({
  actionType: 'fde_integration_check',
  answerText: '基于屏幕里的 Windchill ECO 页面，只读确认对象编号；缺 owner/date/artifact。',
  missingFields: ['owner', 'date', 'artifact'],
  groundedSources: [{ type: 'screen', status: 'used' }, { type: 'business_context', status: 'used' }],
}).passed, true);
```

Also add fixtures with `acceptedGroundedSources` for each source family:

```json
[
  { "type": "transcript", "status": "used" },
  { "type": "screen", "status": "used" },
  { "type": "material", "status": "used" },
  { "type": "pptx", "status": "used" },
  { "type": "business_context", "status": "used" },
  { "type": "business_context", "status": "not_found" },
  { "type": "business_context", "status": "failed" }
]
```

Add a failure case where `business_context` is `failed` or `not_found` but the accepted answer claims a specific PLM/QMS fact. The passing answer in that case must say the fact is unavailable and ask for a readonly lookup or source material.

- [ ] **Step 6: Run FDE answer and product tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/FdeActionAnswerShape.test.mjs
rtk node --test electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs
rtk npm run test:dynamic-actions:product
```

Expected: all pass, FDE answerQualityFailures / groundingFailures / missingFieldFailures empty.

---

### Task 5: Complete FDE Missing-Field Derivation

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionArtifacts.ts`
- Test: `electron/services/__tests__/FdeActionAnswerShape.test.mjs`

**Interfaces:**
- Consumes: `deriveMissingFields(mode, actionType, text)`.
- Produces: FDE missing fields for `owner`, `date`, `artifact`, `test_data`, `acceptance_criteria`.

- [ ] **Step 1: Add failing artifact test**

Add:

```js
test('fde artifacts expose missing owner date artifact test data and acceptance criteria', async () => {
  const [artifact] = buildDynamicActionArtifacts({
    actions: [{
      id: 'fde1',
      modeTemplateType: 'fde',
      type: 'fde_next_step',
      productContract: { outputType: 'checklist' },
      status: 'accepted',
      createdAt: 1,
      latestTurn: '下一步需要推进验证。',
    }],
    usage: [],
  });
  assert.deepEqual(
    artifact.missingFields.sort(),
    ['acceptance_criteria', 'artifact', 'date', 'owner', 'test_data'].sort(),
  );
});
```

- [ ] **Step 2: Implement missing-field derivation**

In `DynamicActionArtifacts.ts`, extend the FDE block:

```ts
if (mode === 'fde' && /next|success|risk|agent|integration/.test(actionType)) {
  if (!/\bowner\b|负责人/i.test(text)) missing.push('owner');
  if (!/\bdate\b|deadline|by|日期|截止|周[一二三四五六日天]/i.test(text)) missing.push('date');
  if (!/(artifact|验证材料|验证产物|交付物|sample|样本)/i.test(text)) missing.push('artifact');
  if (!/(test data|测试数据|真实 ECO|真实 CAPA|样本数据)/i.test(text)) missing.push('test_data');
  if (!/(acceptance criteria|验收标准|准确率|权限边界|审计可追溯)/i.test(text)) missing.push('acceptance_criteria');
}
```

- [ ] **Step 3: Run artifact-related tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/FdeActionAnswerShape.test.mjs electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs
```

Expected: PASS.

---

### Task 6: Repair Team Meeting Recall and False Positives

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionDetector.ts`
- Modify: `tests/fixtures/dynamic-actions/product/team-meet.json`
- Test: `electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs`

**Interfaces:**
- Consumes: existing Team trigger types.
- Produces: Team Meeting product fixture score with `recallRate > 0.85` and `falsePositiveRate < 0.10`.

- [ ] **Step 1: Load all 30 Team fixtures in the test**

Update `TeamMeetingDynamicActionProductFixtures.test.mjs` to load `team-meet.json`, assert `fixtures.length === 30`, and assert:

```js
assert.ok(score.recallRate > 0.85);
assert.ok(score.falsePositiveRate < 0.10);
```

- [ ] **Step 2: Run test and verify current failure**

Run:

```bash
rtk npm run build:electron && rtk node --test electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs
```

Expected: FAIL. Current known misses are deadline-heavy fixtures and `team-blocker-en-005`; known false positives are `team-negative-004`, `team-negative-005`, `team-negative-006`.

- [ ] **Step 3: Create the Team miss / false-positive root-cause table before changing detection**

Add this table to `TeamMeetingDynamicActionProductFixtures.test.mjs` or the runner report and fill it from the failing product report:

```ts
const TEAM_MEETING_ROOT_CAUSES = [
  {
    fixtureId: 'team-blocker-en-005',
    transcriptCue: '...',
    actualActionType: null,
    expectedActionType: 'blocker_check',
    whyWrong: 'blocker phrasing is dependency-first and current pattern misses it',
    fixType: 'add_blocker_dependency_pattern',
    positiveGuardFixtureId: 'team-blocker-...',
  },
  {
    fixtureId: 'team-negative-004',
    transcriptCue: '...',
    actualActionType: 'decision_point',
    expectedActionType: null,
    whyWrong: 'discussion option was treated as final decision',
    fixType: 'decision_uncertainty_suppression',
    positiveGuardFixtureId: 'team-decision-...',
  },
];
```

Each fix must be tied to a row. The positive guard must prove that a real action item / decision / blocker still emits through `assessSignals()`.

- [ ] **Step 4: Add deadline-specific patterns**

In `TEAM_TRIGGERS.owner_deadline_check.patterns`, include:

```ts
/\b(due by|due on|deadline is|target date|ship date|commit by|before EOD|before end of week)\b/i,
zh('本周内', '这周内', '下周前', '月底前', '今天下班前', '明天中午前', '截止到', '交付时间'),
```

- [ ] **Step 5: Add blocker-specific patterns**

In `TEAM_TRIGGERS.blocker_check.patterns`, include:

```ts
/\b(waiting on|depends on|cannot proceed|blocked until|stalled because|needs approval from)\b/i,
zh('等.*确认', '等.*审批', '没有.*就推进不了', '需要.*支持', '依赖.*完成'),
```

- [ ] **Step 6: Add Team suppression helper**

Add:

```ts
function shouldSuppressTeamTrigger(type: string, transcript: string): boolean {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (/(报价表|pricing sheet|sales quote|客户报价)/i.test(text)) return true;
  if (/(只是讨论|还没决定|方案之一|option only|not decided|brainstorm)/i.test(text) && type === 'decision_point') return true;
  if (/(闲聊|午饭|天气|random chat)/i.test(text)) return true;
  return false;
}
```

Call it only for `modeTemplateType === 'team-meet'`.

- [ ] **Step 7: Run Team and full product tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs
rtk npm run test:dynamic-actions:product
```

Expected: Team recall > 0.85 and false positive < 0.10.

---

### Task 7: Add Team Accepted Output Evaluator

**Files:**
- Create: `electron/services/dynamic-actions/TeamMeetingAcceptedOutputEvaluator.ts`
- Modify: `tests/fixtures/dynamic-actions/product/team-meet.json`
- Modify: `electron/services/qa/DynamicActionFixtureRunner.ts`
- Test: `electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs`

**Interfaces:**
- Produces:
  - `evaluateTeamMeetingAcceptedOutput(input): { passed: boolean; failures: string[] }`.

- [ ] **Step 1: Write evaluator tests**

Add:

```js
test('team action item output requires owner deliverable and due date or explicit missing fields', () => {
  const result = evaluateTeamMeetingAcceptedOutput({
    actionType: 'action_item',
    answerText: 'Owner: Maya\nDeliverable: 发布 checklist\nDue: 周五',
    missingFields: [],
  });
  assert.equal(result.passed, true);
});

test('team decision output requires decision rationale and reversibility', () => {
  const result = evaluateTeamMeetingAcceptedOutput({
    actionType: 'decision_point',
    answerText: 'Decision: 采用 Postgres\nRationale: 团队已有运维经验\nReversibility: 可在试点后回滚',
    missingFields: [],
  });
  assert.equal(result.passed, true);
});

test('team blocker output requires impact dependency and unblock step', () => {
  const result = evaluateTeamMeetingAcceptedOutput({
    actionType: 'blocker_check',
    answerText: 'Blocker: 等安全审批\nImpact: 发布延期\nDependency: 安全团队\nNext unblock step: 今天确认审批 owner',
    missingFields: [],
  });
  assert.equal(result.passed, true);
});
```

- [ ] **Step 2: Implement evaluator**

Create `TeamMeetingAcceptedOutputEvaluator.ts`:

```ts
export function evaluateTeamMeetingAcceptedOutput(input: {
  actionType: string;
  answerText: string;
  missingFields: string[];
}): { passed: boolean; failures: string[] } {
  const text = input.answerText.trim();
  const failures: string[] = [];
  if (input.actionType === 'action_item' || input.actionType === 'owner_deadline_check') {
    if (!/(owner|负责人)/i.test(text) && !input.missingFields.includes('owner')) failures.push('missing_owner');
    if (!/(deliverable|交付物|task|任务)/i.test(text) && !input.missingFields.includes('deliverable')) failures.push('missing_deliverable');
    if (!/(due|deadline|截止|周[一二三四五六日天])/i.test(text) && !input.missingFields.includes('due_date')) failures.push('missing_due_date');
  }
  if (input.actionType === 'decision_point') {
    if (!/(decision|决定)/i.test(text)) failures.push('missing_decision');
    if (!/(rationale|原因|依据)/i.test(text)) failures.push('missing_rationale');
    if (!/(reversibility|可逆|回滚|不可逆)/i.test(text)) failures.push('missing_reversibility');
  }
  if (input.actionType === 'blocker_check') {
    if (!/(blocker|阻塞)/i.test(text)) failures.push('missing_blocker');
    if (!/(impact|影响)/i.test(text)) failures.push('missing_impact');
    if (!/(dependency|依赖)/i.test(text)) failures.push('missing_dependency');
    if (!/(next unblock step|解阻|下一步)/i.test(text)) failures.push('missing_unblock_step');
  }
  return { passed: failures.length === 0, failures };
}
```

- [ ] **Step 3: Wire runner to Team evaluator**

When fixture mode is `team-meet` and `expected.acceptedAnswer` exists, run `evaluateTeamMeetingAcceptedOutput` against the accepted artifact produced by Task 2. Fill `answerQualityPassed` and `missingFieldsPassed`. The test must fail if the accepted answer string passes but `buildDynamicActionArtifacts()` loses owner / deliverable / due date, decision fields, or blocker fields.

- [ ] **Step 4: Extend Team fixtures**

Add `expected.acceptedAnswer`, `requiredAnswerPatterns`, and `requiredMissingFields` to Team positives:

```json
"requiredAnswerPatterns": ["Owner|负责人", "Deliverable|交付物", "Due|截止"]
```

For decision fixtures:

```json
"requiredAnswerPatterns": ["Decision|决定", "Rationale|原因|依据", "Reversibility|可逆|回滚|不可逆"]
```

For blocker fixtures:

```json
"requiredAnswerPatterns": ["Blocker|阻塞", "Impact|影响", "Dependency|依赖", "Next unblock step|解阻|下一步"]
```

- [ ] **Step 5: Run Team tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs
rtk npm run test:dynamic-actions:product
```

Expected: PASS and no Team answerQualityFailures / missingFieldFailures.

---

### Task 8: Carry Team Decisions and Blockers Into Post-Call Notes

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionArtifacts.ts`
- Modify: `electron/services/post-call/PostCallWorkflow.ts`
- Test: `electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs`

**Interfaces:**
- Produces structured post-call carryover for accepted Team artifacts without overloading the existing action-item list:
  - `acceptedActionItems: StructuredActionItem[]`
  - `acceptedDecisionRecords: Array<{ actionId: string; decision: string; rationale?: string; reversibility?: string; sourceActionId: string }>`
  - `acceptedBlockerRecords: Array<{ actionId: string; blocker: string; impact?: string; dependency?: string; nextUnblockStep?: string; sourceActionId: string }>`

- [ ] **Step 1: Add failing post-call tests for decision and blocker**

Add:

```js
test('post-call carryover preserves accepted team decision artifacts', async () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [],
    summaryData: { overview: 'Architecture review.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'decision_1',
      modeTemplateType: 'team-meet',
      actionType: 'decision_point',
      outputType: 'decision_record',
      structuredSummary: 'Decision: 采用 Postgres\nRationale: 团队已有经验\nReversibility: 试点后可回滚',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000,
      generationStatus: 'completed',
    }],
  });
  assert.ok(result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
  assert.equal(result.acceptedDecisionRecords.length, 1);
  assert.match(result.acceptedDecisionRecords[0].decision, /Postgres/);
  assert.ok(result.followUpDraft.includes('Postgres'));
});

test('post-call carryover preserves accepted team blocker artifacts', async () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [],
    summaryData: { overview: 'Launch review.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'blocker_1',
      modeTemplateType: 'team-meet',
      actionType: 'blocker_check',
      outputType: 'checklist',
      structuredSummary: 'Blocker: 等安全审批\nImpact: 发布延期\nDependency: 安全团队\nNext unblock step: 今天确认审批 owner',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000,
      generationStatus: 'completed',
    }],
  });
  assert.ok(result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
  assert.equal(result.acceptedBlockerRecords.length, 1);
  assert.match(result.acceptedBlockerRecords[0].blocker, /安全审批/);
  assert.ok(result.followUpDraft.includes('安全审批'));
});
```

- [ ] **Step 2: Generalize accepted Team artifact carryover**

In `PostCallWorkflow.ts`, change the Team branch to accept:

```ts
const TEAM_CARRYOVER_TYPES = new Set(['action_item', 'owner_deadline_check', 'decision_point', 'blocker_check']);
```

Parse summaries:

```ts
function parseArtifactActionSummary(summary: string): { text: string; owner?: string; deadline?: string } {
  const trimmed = summary.trim();
  const decision = firstLabeledLine(trimmed, /^(decision|决定)\s*[:：]/i);
  const blocker = firstLabeledLine(trimmed, /^(blocker|阻塞)\s*[:：]/i);
  const deliverable = firstLabeledLine(trimmed, /^(deliverable|task|交付物|任务)\s*[:：]/i);
  return { text: deliverable || decision || blocker || trimmed.replace(/\s+/g, ' ').trim() };
}
```

Then route by action type:

```ts
if (artifact.actionType === 'decision_point') {
  enhancements.acceptedDecisionRecords.push(parseAcceptedDecisionRecord(artifact));
} else if (artifact.actionType === 'blocker_check') {
  enhancements.acceptedBlockerRecords.push(parseAcceptedBlockerRecord(artifact));
} else {
  enhancements.acceptedActionItems.push(parseAcceptedActionItem(artifact));
}
```

Keep `summaryData.actionItems` as the existing summary list. Do not force decisions or blockers into that capped list.

- [ ] **Step 3: Add accepted-card preservation metric**

In `PostCallDynamicActionCarryover.test.mjs`, add a case with 10 accepted Team artifacts: 4 action items, 3 decisions, and 3 blockers. Assert at least 9 are preserved across `acceptedActionItems`, `acceptedDecisionRecords`, and `acceptedBlockerRecords` combined:

```js
const preserved =
  result.acceptedActionItems.length +
  result.acceptedDecisionRecords.length +
  result.acceptedBlockerRecords.length;
assert.ok(preserved >= 9);
```

- [ ] **Step 4: Run carryover tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs electron/services/__tests__/PostCallWorkflow.test.mjs
```

Expected: PASS, accepted card preservation > 90%.

---

### Task 9: Add Team Dismissal Cooldown Regression

**Files:**
- Modify: `electron/services/__tests__/DynamicActionEngine.test.mjs`
- Test: `electron/services/__tests__/DynamicActionEngine.test.mjs`

**Interfaces:**
- Consumes: `DynamicActionEngine.dismissAction`, dedupe/cooldown behavior.
- Produces: Team-specific regression coverage for ignored cards reducing repeated prompts.

- [ ] **Step 1: Add Team-specific dismissed action test**

Add:

```js
test('team-meet dismissed action does not immediately resurface the same candidate', async () => {
  const engine = new DynamicActionEngine();
  const now = 10_000;
  const first = await engine.assessSignals({
    transcript: '我来做发布 checklist，周五前发出来。',
    modeTemplateType: 'team-meet',
    modeId: 'team-meet',
    sessionId: 'team-dismissal',
    now,
  });
  assert.equal(first.actions.length, 1);
  engine.dismissAction(first.actions[0].id, { now });

  const second = await engine.assessSignals({
    transcript: '我来做发布 checklist，周五前发出来。',
    modeTemplateType: 'team-meet',
    modeId: 'team-meet',
    sessionId: 'team-dismissal',
    now: now + 60_000,
  });
  assert.equal(second.actions.length, 0);

  const afterCooldown = await engine.assessSignals({
    transcript: '我来做发布 checklist，周五前发出来。',
    modeTemplateType: 'team-meet',
    modeId: 'team-meet',
    sessionId: 'team-dismissal',
    now: now + TEAM_DISMISSAL_COOLDOWN_MS + 1,
  });
  assert.equal(afterCooldown.actions.length, 1);
});
```

- [ ] **Step 2: Run and fix only if it fails**

Run:

```bash
rtk npm run build:electron && rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs
```

Expected: PASS if existing cooldown already covers Team. If it fails, adjust only the existing dedupe/cooldown path; do not create a Team-only store. Use the existing cooldown constant if one exists; otherwise add a named constant:

```ts
const TEAM_DISMISSAL_COOLDOWN_MS = 5 * 60 * 1000;
```

The test must prove both sides of the window: suppressed within 5 minutes, eligible again after 5 minutes.

---

### Task 10: Final Verification and Roadmap Update

**Files:**
- Modify: `docs/engineering/CONTEXT_SYSTEM_ROADMAP.md`
- Modify: `docs/engineering/DYNAMIC_ACTION_STEP3_STEP4_COMPLETION_PLAN.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs
rtk node --test electron/services/__tests__/FdeActionAnswerShape.test.mjs
rtk node --test electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs
rtk node --test electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs
rtk node --test electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs
rtk node --test electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs
rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs
rtk node --test electron/services/__tests__/TestDiscovery.test.mjs
rtk npm run test:dynamic-actions:product
```

Expected:

- FDE recall > 75%.
- FDE false positive < 10%.
- Team recall > 85%.
- Team false positive < 10%.
- No answerQualityFailures, groundingFailures, or missingFieldFailures for FDE or Team.
- Team accepted-card carryover > 90%.

If `QCLOUD_LIVE_API_KEY` or `NATIVELY_API_KEY` is configured in the execution environment, also run:

```bash
rtk npm run test:dynamic-actions:fde-replay:real-stt
```

Expected: PASS. If no live key exists, record "not run: live STT key unavailable" in the implementation notes; do not mark it as passed.

- [ ] **Step 2: Run full default test suite**

Run:

```bash
rtk npm test
```

Expected: exit code 0.

- [ ] **Step 3: Update roadmap from "in progress" to "release-gate complete"**

Only after Step 1 and Step 2 pass, update:

```md
Step 3 状态：已完成 release-gate 级别收口。
Step 4 状态：已完成 release-gate 级别收口。
```

Include the measured per-mode metrics from the passing product report.

- [ ] **Step 4: Commit**

Run:

```bash
git add \
  docs/engineering/CONTEXT_SYSTEM_ROADMAP.md \
  docs/engineering/DYNAMIC_ACTION_STEP3_STEP4_COMPLETION_PLAN.md \
  electron/services/dynamic-actions/DynamicActionProductFixtures.ts \
  electron/services/dynamic-actions/DynamicActionDetector.ts \
  electron/services/dynamic-actions/DynamicActionArtifacts.ts \
  electron/services/dynamic-actions/FdeAcceptedOutputEvaluator.ts \
  electron/services/dynamic-actions/TeamMeetingAcceptedOutputEvaluator.ts \
  electron/services/qa/DynamicActionFixtureRunner.ts \
  electron/services/qa/__tests__/DynamicActionFixtureRunner.test.mjs \
  electron/services/post-call/PostCallWorkflow.ts \
  electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/FdeActionAnswerShape.test.mjs \
  electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs \
  electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs \
  electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs \
  electron/services/__tests__/DynamicActionEngine.test.mjs \
  tests/fixtures/dynamic-actions/product/fde.json \
  tests/fixtures/dynamic-actions/product/team-meet.json \
  scripts/run-dynamic-actions-product.mjs
git commit -m "feat(dynamic-actions): complete fde and team meeting gates"
```

Do not stage `test-reports/`, `reports/`, temporary audio, product report JSON/Markdown, screenshots, or generated debug output unless the user explicitly asks.

---

## Completion Definition

This plan is complete only when all of these are true:

- `rtk npm run test:dynamic-actions:product` fails on regression and passes with:
  - FDE recall > 75%.
  - FDE false positive < 10%.
  - Team Meeting recall > 85%.
  - Team Meeting false positive < 10%.
- FDE accepted outputs are validated for:
  - 3 manufacturing clarification questions.
  - minimal validation step.
  - owner/date/artifact/test data/acceptance criteria missing-field behavior.
  - categorized risk record.
  - human confirmation and no PLM/QMS auto-writeback.
  - grounding from transcript, screen, material/PPTX, or business context when claimed.
- Team Meeting accepted outputs are validated for:
  - action item owner/deliverable/due date.
  - decision/rationale/reversibility.
  - blocker/impact/dependency/next unblock step.
  - post-call accepted-card preservation > 90%.
- `rtk npm test` exits 0.
