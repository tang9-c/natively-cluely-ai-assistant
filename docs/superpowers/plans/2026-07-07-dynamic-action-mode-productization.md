# Dynamic Action Mode Productization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize Sales, FDE, and Team Meeting dynamic actions with mode-specific contracts, deterministic fixture scoring, transient action artifacts, and post-call carryover without adding database schema.

**Architecture:** Keep the existing DynamicActionEngine -> DynamicActionProductContract -> DynamicActionCard path. Add small pure helpers for fixture scoring and transient artifact construction, then pass optional artifacts into PostCallWorkflow. Dynamic action generated answers keep using existing `usage` persistence, with metadata added to the existing usage object rather than new tables.

**Tech Stack:** Electron main TypeScript/CommonJS, React renderer TypeScript, Node `node:test` suites run through Electron, SQLite via existing DatabaseManager only.

## Global Constraints

- Do not add database tables or columns.
- Do not add CRM writeback, automatic email sending, or automatic quote creation.
- Do not write to PLM / QMS or business systems.
- Do not add a new card design system or new meeting modes.
- Do not expand generic MCP behavior.
- Do not implement Step 5 metrics dashboards in this work. Keep event and test anchors only.
- Implementation order is strict: Sales acceptance first, then FDE, then Team Meeting.
- Real LLM, real STT, real PPTX, and real business-system calls are allowed only in gated smoke tests with explicit environment prerequisites.

---

## File Structure

Create:

- `electron/services/dynamic-actions/DynamicActionArtifacts.ts`
  - Pure helper for `ActionArtifact`, `buildDynamicActionArtifacts()`, missing-field derivation, generated-status mapping, and grounded-source extraction from existing usage metadata.
- `electron/services/dynamic-actions/DynamicActionProductFixtures.ts`
  - Shared fixture schema, scoring helpers, and mode product score summaries.
- `electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs`
  - Unit tests for artifact construction, no generated answer fallback, failed generation, missing fields, and grounded source extraction.
- `electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs`
  - Unit tests for recall, false-positive, answer quality, grounding, and missing-field scoring.
- `electron/services/__tests__/DynamicActionNoDbSchema.contract.test.mjs`
  - Contract test that blocks schema changes for action artifacts.
- `electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs`
  - Sales fixture recall and false-positive tests.
- `electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs`
  - Sales generated-answer shape tests.
- `src/components/__tests__/SalesActionCardUx.contract.test.mjs`
  - Sales card UX copy contract.
- `electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs`
  - FDE fixture recall and false-positive tests.
- `electron/services/__tests__/FdeActionAnswerShape.test.mjs`
  - FDE answer shape tests.
- `electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs`
  - FDE grounding and conservative degradation tests.
- `electron/services/__tests__/FdeManufacturingScenarioProfile.test.mjs`
  - FDE default profile/context tests.
- `electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs`
  - Team fixture recall and false-positive tests.
- `electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs`
  - Team missing-field extraction tests.
- `electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs`
  - Post-call artifact carryover tests.

Modify:

- `electron/services/dynamic-actions/DynamicAction.ts`
  - Export artifact-related types if consumers need them.
- `electron/services/dynamic-actions/DynamicActionProductContract.ts`
  - Tighten Sales/FDE/Team copy and output-type mappings.
- `electron/services/dynamic-actions/DynamicActionDetector.ts`
  - Adjust Sales answer styles and add the single allowed new FDE action type `fde_agent_feasibility`.
- `electron/services/dynamic-actions/DynamicActionEngine.ts`
  - Map `fde_agent_feasibility` from intent if needed.
- `electron/llm/IntentClassifier.ts`
  - Add or align FDE AI Agent feasibility candidate.
- `electron/services/post-call/PostCallWorkflow.ts`
  - Accept optional `dynamicActionArtifacts` and merge accepted Team artifacts into post-call enhancements.
- `electron/IntelligenceEngine.ts`
  - Add dynamic-action metadata to existing `session.pushUsage()` entries when `options.modeEvent` is present.
- `electron/MeetingPersistence.ts`
  - Build artifacts from `data.usage` and pass them into `buildPostCallEnhancements()`.
- `src/types/electron.d.ts`
  - Update dynamic-action mode event metadata only if new metadata crosses preload/renderer boundaries.

---

### Task 1: Shared Fixture Schema And Scoring

**Files:**
- Create: `electron/services/dynamic-actions/DynamicActionProductFixtures.ts`
- Test: `electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs`

**Interfaces:**
- Produces:
  - `DynamicActionProductFixture`
  - `DynamicActionProductFixtureResult`
  - `scoreDynamicActionProductFixtures(results): DynamicActionProductScore`
  - `matchesRequiredPatterns(text, patterns)`

- [ ] **Step 1: Write failing scoring tests**

Create `electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const helperPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');

async function loadHelper() {
  return import(pathToFileURL(helperPath).href);
}

test('scores recall and false positives with one shared formula', async () => {
  const { scoreDynamicActionProductFixtures } = await loadHelper();
  const score = scoreDynamicActionProductFixtures([
    { fixtureId: 's1', shouldEmit: true, emitted: true, actionTypeMatched: true, outputTypeMatched: true },
    { fixtureId: 's2', shouldEmit: true, emitted: false, actionTypeMatched: false, outputTypeMatched: false },
    { fixtureId: 'n1', shouldEmit: false, emitted: true, actionTypeMatched: false, outputTypeMatched: false },
    { fixtureId: 'n2', shouldEmit: false, emitted: false, actionTypeMatched: false, outputTypeMatched: false },
  ]);

  assert.equal(score.recallDenominator, 2);
  assert.equal(score.recallNumerator, 1);
  assert.equal(score.falsePositiveDenominator, 2);
  assert.equal(score.falsePositiveNumerator, 1);
  assert.equal(score.recallRate, 0.5);
  assert.equal(score.falsePositiveRate, 0.5);
});

test('checks required and forbidden answer patterns', async () => {
  const { evaluatePatternExpectations } = await loadHelper();
  assert.equal(evaluatePatternExpectations('Use [QUOTE_AMOUNT] after scope is confirmed.', {
    required: ['\\\\[QUOTE_AMOUNT\\\\]', 'scope'],
    forbidden: ['ACME Corp', '\\\\$\\\\d+'],
  }).passed, true);

  assert.equal(evaluatePatternExpectations('The quote is $1000 for ACME Corp.', {
    required: ['quote'],
    forbidden: ['ACME Corp', '\\\\$\\\\d+'],
  }).passed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs
```

Expected: FAIL because `DynamicActionProductFixtures.js` does not exist.

- [ ] **Step 3: Implement fixture scoring helper**

Create `electron/services/dynamic-actions/DynamicActionProductFixtures.ts`:

```ts
import type { DynamicActionOutputType } from './DynamicAction';

export interface DynamicActionProductFixture {
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
    outputType?: DynamicActionOutputType;
    requiredCardCopy?: string[];
    forbiddenCardCopy?: string[];
    requiredAnswerPatterns?: string[];
    forbiddenAnswerPatterns?: string[];
    requiredMissingFields?: string[];
    requiredGrounding?: Array<'material' | 'pptx' | 'screen' | 'business_context' | 'transcript'>;
  };
  negativeReason?: 'wrong_mode' | 'internal_chatter' | 'low_value' | 'missing_evidence' | 'unrelated_small_talk';
}

export interface DynamicActionProductFixtureResult {
  fixtureId: string;
  shouldEmit: boolean;
  emitted: boolean;
  actionTypeMatched: boolean;
  outputTypeMatched: boolean;
  answerQualityPassed?: boolean;
  groundingPassed?: boolean;
  missingFieldsPassed?: boolean;
}

export interface DynamicActionProductScore {
  recallNumerator: number;
  recallDenominator: number;
  recallRate: number;
  falsePositiveNumerator: number;
  falsePositiveDenominator: number;
  falsePositiveRate: number;
  answerQualityFailures: string[];
  groundingFailures: string[];
  missingFieldFailures: string[];
}

export function evaluatePatternExpectations(
  text: string,
  patterns: { required?: string[]; forbidden?: string[] },
): { passed: boolean; missingRequired: string[]; matchedForbidden: string[] } {
  const missingRequired = (patterns.required ?? []).filter((pattern) => !new RegExp(pattern, 'i').test(text));
  const matchedForbidden = (patterns.forbidden ?? []).filter((pattern) => new RegExp(pattern, 'i').test(text));
  return {
    passed: missingRequired.length === 0 && matchedForbidden.length === 0,
    missingRequired,
    matchedForbidden,
  };
}

export function scoreDynamicActionProductFixtures(
  results: DynamicActionProductFixtureResult[],
): DynamicActionProductScore {
  const positives = results.filter((result) => result.shouldEmit);
  const negatives = results.filter((result) => !result.shouldEmit);
  const recallNumerator = positives.filter((result) =>
    result.emitted && result.actionTypeMatched && result.outputTypeMatched
  ).length;
  const falsePositiveNumerator = negatives.filter((result) => result.emitted).length;

  return {
    recallNumerator,
    recallDenominator: positives.length,
    recallRate: positives.length === 0 ? 1 : recallNumerator / positives.length,
    falsePositiveNumerator,
    falsePositiveDenominator: negatives.length,
    falsePositiveRate: negatives.length === 0 ? 0 : falsePositiveNumerator / negatives.length,
    answerQualityFailures: results.filter((result) => result.answerQualityPassed === false).map((result) => result.fixtureId),
    groundingFailures: results.filter((result) => result.groundingPassed === false).map((result) => result.fixtureId),
    missingFieldFailures: results.filter((result) => result.missingFieldsPassed === false).map((result) => result.fixtureId),
  };
}
```

- [ ] **Step 4: Run scoring test**

Run:

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/dynamic-actions/DynamicActionProductFixtures.ts electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs
git commit -m "test: add dynamic action product fixture scoring"
```

---

### Task 2: Transient Dynamic Action Artifact Builder

**Files:**
- Create: `electron/services/dynamic-actions/DynamicActionArtifacts.ts`
- Test: `electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs`

**Interfaces:**
- Consumes: `DynamicActionOutputType`
- Produces:
  - `ActionArtifact`
  - `BuildDynamicActionArtifactsInput`
  - `buildDynamicActionArtifacts(input): ActionArtifact[]`

- [ ] **Step 1: Write failing artifact builder tests**

Create `electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const helperPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js');

async function loadHelper() {
  return import(pathToFileURL(helperPath).href);
}

function action(overrides = {}) {
  return {
    id: 'action_1',
    modeTemplateType: 'team-meet',
    type: 'action_item',
    productContract: { outputType: 'action_item' },
    status: 'completed',
    createdAt: 1000,
    latestTurn: 'Maya will send the launch checklist by Friday.',
    ...overrides,
  };
}

test('builds artifact from completed dynamic action and nearest usage answer', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({
    actions: [action()],
    usage: [{
      type: 'assist',
      timestamp: 1200,
      question: 'dynamic action',
      answer: 'Owner: Maya\\nDeliverable: launch checklist\\nDue: Friday',
      metadata: { source: 'dynamic_action', actionId: 'action_1', groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }] },
    }],
  });

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].actionId, 'action_1');
  assert.equal(artifacts[0].generationStatus, 'completed');
  assert.match(artifacts[0].structuredSummary, /Owner: Maya/);
  assert.deepEqual(artifacts[0].missingFields, []);
  assert.equal(artifacts[0].groundedSources[0].type, 'transcript');
});

test('builds conservative not_generated artifact when usage is missing', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({ actions: [action({ status: 'accepted' })], usage: [] });
  assert.equal(artifacts[0].generationStatus, 'not_generated');
  assert.match(artifacts[0].structuredSummary, /Maya will send/);
});

test('derives missing fields deterministically for team actions', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({
    actions: [action({ latestTurn: 'Someone should follow up.' })],
    usage: [],
  });
  assert.ok(artifacts[0].missingFields.includes('owner'));
  assert.ok(artifacts[0].missingFields.includes('due_date'));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement artifact builder**

Create `electron/services/dynamic-actions/DynamicActionArtifacts.ts`:

```ts
import type { DynamicActionOutputType } from './DynamicAction';

export interface ActionArtifact {
  actionId: string;
  modeTemplateType: 'sales' | 'fde' | 'team-meet';
  actionType: string;
  outputType: DynamicActionOutputType;
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

export interface BuildDynamicActionArtifactsInput {
  actions: Array<{
    id: string;
    modeTemplateType: string;
    type: string;
    productContract: { outputType: DynamicActionOutputType };
    status: string;
    createdAt: number;
    latestTurn?: string;
    retrievalQuery?: string;
  }>;
  usage: Array<{
    question?: string;
    answer?: string | string[] | null;
    type?: string;
    timestamp?: number;
    metadata?: any;
  }>;
}

const ARTIFACT_MODES = new Set(['sales', 'fde', 'team-meet']);

export function buildDynamicActionArtifacts(input: BuildDynamicActionArtifactsInput): ActionArtifact[] {
  return input.actions
    .filter((action) => ARTIFACT_MODES.has(action.modeTemplateType))
    .filter((action) => ['accepted', 'auto_generated', 'completed', 'generated_failed'].includes(action.status))
    .map((action) => {
      const usage = findUsageForAction(action.id, action.createdAt, input.usage);
      const answer = normalizeAnswer(usage?.answer);
      const structuredSummary = answer || action.latestTurn || action.retrievalQuery || action.type;
      return {
        actionId: action.id,
        modeTemplateType: action.modeTemplateType as ActionArtifact['modeTemplateType'],
        actionType: action.type,
        outputType: action.productContract.outputType,
        structuredSummary,
        missingFields: deriveMissingFields(action.modeTemplateType, action.type, structuredSummary),
        groundedSources: normalizeGroundedSources(usage?.metadata, structuredSummary),
        acceptedAt: action.createdAt,
        generationStatus: action.status === 'generated_failed'
          ? 'generated_failed'
          : answer
            ? 'completed'
            : 'not_generated',
      };
    });
}

function findUsageForAction(actionId: string, acceptedAt: number, usage: BuildDynamicActionArtifactsInput['usage'][number][]) {
  const direct = usage.find((item) => item.metadata?.source === 'dynamic_action' && item.metadata?.actionId === actionId);
  if (direct) return direct;
  return usage
    .filter((item) => item.metadata?.source === 'dynamic_action' || item.type === 'assist')
    .filter((item) => typeof item.timestamp !== 'number' || item.timestamp >= acceptedAt)
    .sort((a, b) => (a.timestamp ?? Number.MAX_SAFE_INTEGER) - (b.timestamp ?? Number.MAX_SAFE_INTEGER))[0];
}

function normalizeAnswer(answer: unknown): string {
  if (Array.isArray(answer)) return answer.join('\n').trim();
  return typeof answer === 'string' ? answer.trim() : '';
}

function deriveMissingFields(mode: string, actionType: string, text: string): string[] {
  const missing: string[] = [];
  if (mode === 'team-meet' && ['action_item', 'owner_deadline_check'].includes(actionType)) {
    if (!/(owner|负责人|Maya|Me|I will|我来|我负责)/i.test(text)) missing.push('owner');
    if (!/(deliverable|task|checklist|proposal|发|send|prepare|review|完成)/i.test(text)) missing.push('deliverable');
    if (!/(due|deadline|by|Friday|Monday|周[一二三四五六日天]|今天|明天|下周)/i.test(text)) missing.push('due_date');
  }
  if (mode === 'fde' && /next|success|risk|agent|integration/.test(actionType)) {
    if (!/(owner|负责人)/i.test(text)) missing.push('owner');
    if (!/(artifact|验证材料|交付物|测试数据|sample|样本)/i.test(text)) missing.push('artifact');
  }
  if (mode === 'sales' && actionType === 'buying_signal') {
    if (!/(owner|负责人|who)/i.test(text)) missing.push('owner');
    if (!/(date|when|by|截止|时间|周[一二三四五六日天])/i.test(text)) missing.push('date');
  }
  return Array.from(new Set(missing));
}

function normalizeGroundedSources(metadata: any, fallbackText: string): ActionArtifact['groundedSources'] {
  if (Array.isArray(metadata?.groundedSources)) {
    return metadata.groundedSources.filter((item: any) =>
      ['material', 'pptx', 'screen', 'business_context', 'transcript'].includes(item?.type) &&
      ['used', 'not_found', 'scope_denied', 'failed'].includes(item?.status)
    );
  }
  return fallbackText ? [{ type: 'transcript', label: 'accepted action', status: 'used' }] : [];
}
```

- [ ] **Step 4: Run artifact tests**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/dynamic-actions/DynamicActionArtifacts.ts electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs
git commit -m "feat: build transient dynamic action artifacts"
```

---

### Task 3: Persist Dynamic Action Metadata Into Existing Usage

**Files:**
- Modify: `electron/IntelligenceEngine.ts`
- Test: `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs`

**Interfaces:**
- Consumes: existing `modeEvent` passed to `runWhatShouldISay()`
- Produces: existing `session.pushUsage()` entry with `metadata.source === 'dynamic_action'`, `metadata.actionType`, `metadata.outputType`, and grounding metadata when available.

- [ ] **Step 1: Add failing contract test**

Append to `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs`:

```js
test('dynamic action usage entries preserve action metadata for post-call artifacts', () => {
  const source = read('electron/IntelligenceEngine.ts');
  assert.match(source, /metadata:\s*\{/);
  assert.match(source, /source:\s*['"]dynamic_action['"]/);
  assert.match(source, /actionType:\s*options\.modeEvent\?\.sourceIntent/);
  assert.match(source, /outputType:\s*options\.modeEvent\?\.productContract\?\.outputType/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs
```

Expected: FAIL because usage metadata is not stamped.

- [ ] **Step 3: Update usage persistence**

In `electron/IntelligenceEngine.ts`, update the `this.session.pushUsage({ ... })` block inside `runWhatShouldISay()`:

```ts
const usageEntry: any = {
  type: 'assist',
  timestamp: Date.now(),
  question: usageQuestion,
  answer: fullAnswer,
};

if (options?.source === 'dynamic_action' || options?.modeEvent) {
  usageEntry.metadata = {
    source: 'dynamic_action',
    actionType: options?.modeEvent?.sourceIntent,
    outputType: (options?.modeEvent as any)?.productContract?.outputType,
    modeTemplateType: options?.modeEvent?.modeTemplateType,
    retrievalQuery: options?.modeEvent?.retrievalQuery,
    groundedSources: [],
  };
}

this.session.pushUsage(usageEntry);
```

If `ModeEventContext` does not currently include `productContract`, add only the minimal optional type field needed in the existing shared type. Do not add new IPC channels.

- [ ] **Step 4: Run targeted tests**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/IntelligenceEngine.ts electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs src/types/electron.d.ts electron/preload.ts
git commit -m "feat: stamp dynamic action usage metadata"
```

---

### Task 4: Wire Artifacts Into PostCallWorkflow Without Schema Changes

**Files:**
- Modify: `electron/services/post-call/PostCallWorkflow.ts`
- Modify: `electron/MeetingPersistence.ts`
- Test: `electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs`
- Test: `electron/services/__tests__/PostCallWorkflow.test.mjs`

**Interfaces:**
- Consumes: `buildDynamicActionArtifacts({ actions, usage })`
- Produces: `buildPostCallEnhancements({ ..., dynamicActionArtifacts })`

- [ ] **Step 1: Write failing post-call carryover test**

Create `electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const workflowPath = path.join(root, 'dist-electron/electron/services/post-call/PostCallWorkflow.js');

async function loadWorkflow() {
  return import(pathToFileURL(workflowPath).href);
}

test('post-call summary preserves accepted team action artifacts', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [{ speaker: 'Maya', text: 'I can send the checklist.', timestamp: 1 }],
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'action_1',
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: 'Owner: Maya\\nDeliverable: launch checklist\\nDue: Friday',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000,
      generationStatus: 'completed',
    }],
  });

  assert.ok(result.actionItemsStructured.some((item) => /launch checklist/i.test(item.text)));
  assert.ok(result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs
```

Expected: FAIL because `dynamicActionArtifacts` input is ignored.

- [ ] **Step 3: Update PostCallWorkflow**

In `electron/services/post-call/PostCallWorkflow.ts`, import the artifact type and extend params:

```ts
import type { ActionArtifact } from '../dynamic-actions/DynamicActionArtifacts';
```

Add optional input:

```ts
dynamicActionArtifacts?: ActionArtifact[];
```

After `extractStructuredActionItems(...)`, merge Team artifacts:

```ts
const actionItemsStructured = mergeAcceptedActionArtifacts(
  extractStructuredActionItems(params.transcript, params.summaryData?.actionItems ?? []),
  params.dynamicActionArtifacts ?? [],
);
```

Add helper:

```ts
function mergeAcceptedActionArtifacts(
  existing: StructuredActionItem[],
  artifacts: ActionArtifact[],
): StructuredActionItem[] {
  const merged = [...existing];
  const seen = new Set(existing.map((item) => item.text.toLowerCase()));
  for (const artifact of artifacts) {
    if (artifact.modeTemplateType !== 'team-meet') continue;
    if (!['action_item', 'owner_deadline_check'].includes(artifact.actionType)) continue;
    if (artifact.generationStatus === 'generated_failed') continue;
    const text = artifact.structuredSummary.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    merged.push({
      id: `action_${merged.length + 1}`,
      text,
      sourceTimestamp: artifact.acceptedAt,
    });
  }
  return merged.slice(0, 8);
}
```

In `generateCoachingInsights()`, append one insight for completed accepted artifacts:

```ts
if (params.dynamicActionArtifacts?.some((artifact) => artifact.modeTemplateType === 'team-meet' && artifact.generationStatus === 'completed')) {
  add('accepted_dynamic_action', 'Accepted meeting action preserved', 'A meeting action accepted during the call was carried into the post-call notes.', 'info');
}
```

If helper structure makes this awkward, pass artifacts into `generateCoachingInsights()` as an additional optional parameter. Keep existing callers unchanged.

- [ ] **Step 4: Wire MeetingPersistence**

In `electron/MeetingPersistence.ts`, import:

```ts
import { buildDynamicActionArtifacts } from './services/dynamic-actions/DynamicActionArtifacts';
```

Before `buildPostCallEnhancements()`, construct artifacts from usage only for now:

```ts
const dynamicActionArtifacts = buildDynamicActionArtifacts({
  actions: data.usage
    .map((item: any) => item?.metadata?.dynamicAction)
    .filter(Boolean),
  usage: data.usage,
});
```

If Task 3 stores action metadata directly under `metadata`, map it into the `actions` shape here. Do not read or write a new table.

Pass:

```ts
dynamicActionArtifacts,
```

- [ ] **Step 5: Run post-call tests**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs electron/services/__tests__/PostCallWorkflow.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/post-call/PostCallWorkflow.ts electron/MeetingPersistence.ts electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs electron/services/__tests__/PostCallWorkflow.test.mjs
git commit -m "feat: carry accepted dynamic actions into post-call notes"
```

---

### Task 5: Sales Mode Product Contract And Fixtures

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionProductContract.ts`
- Modify: `electron/services/dynamic-actions/DynamicActionDetector.ts`
- Test: `electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs`
- Test: `electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs`
- Test: `src/components/__tests__/SalesActionCardUx.contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 fixture scoring
- Produces: Sales fixtures that prove five key moments and false-positive boundaries.

- [ ] **Step 1: Write Sales product fixture tests**

Create `electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs` with a small representative set first:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
const scoringPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');

async function load() {
  return {
    ...(await import(pathToFileURL(enginePath).href)),
    ...(await import(pathToFileURL(scoringPath).href)),
  };
}

const fixtures = [
  { id: 'sales-price-zh', text: '这个价格太高了，我们预算不够。', shouldEmit: true, actionType: 'pricing_objection', outputType: 'spoken_response' },
  { id: 'sales-quote-en', text: 'Can you send me a proposal and commercial terms?', shouldEmit: true, actionType: 'pricing_request', outputType: 'email_draft' },
  { id: 'sales-case-mixed', text: '有没有 similar customer 的落地案例或者 ROI proof?', shouldEmit: true, actionType: 'case_study_request', outputType: 'spoken_response' },
  { id: 'sales-tech-en', text: 'What are the API and SSO requirements for production?', shouldEmit: true, actionType: 'technical_requirements', outputType: 'checklist' },
  { id: 'sales-buying-zh', text: '下一步我们可以让法务看合同，先安排 pilot。', shouldEmit: true, actionType: 'buying_signal', outputType: 'spoken_response' },
  { id: 'sales-internal-price-sheet', text: '我们的报价表在这，等客户问再发。', shouldEmit: false },
];

test('sales fixtures emit only high-value sales actions', async () => {
  const { DynamicActionEngine, scoreDynamicActionProductFixtures } = await load();
  const engine = new DynamicActionEngine();
  const results = fixtures.map((fixture) => {
    const actions = engine.detectActions({
      transcript: fixture.text,
      modeTemplateType: 'sales',
      modeId: 'sales',
      sessionId: fixture.id,
    });
    const action = actions[0];
    return {
      fixtureId: fixture.id,
      shouldEmit: fixture.shouldEmit,
      emitted: actions.length > 0,
      actionTypeMatched: fixture.actionType ? action?.type === fixture.actionType : false,
      outputTypeMatched: fixture.outputType ? action?.productContract?.outputType === fixture.outputType : false,
    };
  });

  const score = scoreDynamicActionProductFixtures(results);
  assert.equal(score.falsePositiveNumerator, 0);
  assert.ok(score.recallRate >= 0.8);
});
```

- [ ] **Step 2: Add answer quality contract tests**

Create `electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');

test('sales pricing objection asks for spoken response rather than value bullet list', () => {
  const block = detector.match(/type:\s*'pricing_objection'[\s\S]*?answerStyle:\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(block, /format:\s*'short_script'/);
  assert.doesNotMatch(block, /format:\s*'bullets'/);
});

test('sales quote prompt forbids invented commercial terms', () => {
  const block = detector.match(/type:\s*'pricing_request'[\s\S]*?answerStyle:\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(block, /Do not invent customer names, account numbers, specific pricing, or contract terms/);
  assert.match(block, /\[CUSTOMER_NAME\]/);
  assert.match(block, /\[QUOTE_AMOUNT\]/);
});
```

- [ ] **Step 3: Run Sales tests to verify failures**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs
```

Expected: pricing objection output format test fails until detector is tightened.

- [ ] **Step 4: Tighten Sales contracts**

In `DynamicActionDetector.ts`:

- Change `pricing_objection.answerStyle.format` from `'bullets'` to `'short_script'`.
- Keep `pricing_request` email prompt placeholder rules.
- Ensure `case_study_request` prompt says no customer names, metrics, or outcomes without trusted context.
- Ensure `technical_requirements` answer style remains `'checklist'`.

In `DynamicActionProductContract.ts`:

- Ensure `pricing_objection` maps to `userAction: '回应价格异议'`.
- Ensure `pricing_request` maps to `email_draft`.
- Ensure `technical_requirements` maps to `checklist`.
- Ensure `buying_signal` uses `userAction: '锁定下一步'` or equivalent.

- [ ] **Step 5: Add Sales card UX contract**

Create `src/components/__tests__/SalesActionCardUx.contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

test('sales product contract exposes action promises instead of intent labels', () => {
  const source = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionProductContract.ts'), 'utf8');
  assert.match(source, /回应价格异议/);
  assert.match(source, /生成后续邮件草稿|生成报价跟进邮件|生成一封可发送的邮件草稿/);
  assert.doesNotMatch(source, /Handle pricing objection/);
});
```

- [ ] **Step 6: Run Sales tests**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs src/components/__tests__/SalesActionCardUx.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/dynamic-actions/DynamicActionDetector.ts electron/services/dynamic-actions/DynamicActionProductContract.ts electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs src/components/__tests__/SalesActionCardUx.contract.test.mjs
git commit -m "feat: productize sales dynamic actions"
```

---

### Task 6: FDE Manufacturing Contracts

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionDetector.ts`
- Modify: `electron/services/dynamic-actions/DynamicActionEngine.ts`
- Modify: `electron/services/dynamic-actions/DynamicActionProductContract.ts`
- Modify: `electron/llm/IntentClassifier.ts`
- Modify: `electron/services/ModesManager.ts`
- Test: `electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs`
- Test: `electron/services/__tests__/FdeActionAnswerShape.test.mjs`
- Test: `electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs`
- Test: `electron/services/__tests__/FdeManufacturingScenarioProfile.test.mjs`

**Interfaces:**
- Consumes: Task 1 fixture scoring
- Produces: FDE manufacturing and AI Agent action contracts, including the only allowed new action type `fde_agent_feasibility`.

- [ ] **Step 1: Add failing FDE fixture and answer-shape tests**

Create fixtures that assert:

- PLM/BOM/ECO workflow emits `fde_discovery_probe` or `fde_integration_check`.
- CAPA/NCR quality workflow emits `fde_discovery_probe` or `fde_risk_blocker`.
- AI Agent automation boundary emits `fde_agent_feasibility`.
- Generic technical small talk does not emit.

Use the same pattern as Task 5 with `DynamicActionEngine.detectActions()` and `scoreDynamicActionProductFixtures()`.

Create `electron/services/__tests__/FdeActionAnswerShape.test.mjs` as a source contract:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

test('fde agent feasibility prompt requires human confirmation and no-write boundary', () => {
  const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
  const block = detector.match(/type:\s*'fde_agent_feasibility'[\s\S]*?answerStyle:\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(block, /human confirmation|人工确认/i);
  assert.match(block, /must not write|不能.*写入|read-only/i);
});
```

- [ ] **Step 2: Run FDE tests to verify failures**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs electron/services/__tests__/FdeActionAnswerShape.test.mjs
```

Expected: FAIL because `fde_agent_feasibility` is missing.

- [ ] **Step 3: Add FDE trigger and mappings**

In `DynamicActionDetector.ts`, add `fde_agent_feasibility` to the FDE trigger pack:

```ts
{
  type: 'fde_agent_feasibility',
  patterns: [
    /\b(agent|AI agent|automation|human in the loop|approval flow|tool call|read only|write back)\b/i,
    zh('AI Agent', '智能体', '自动化', '人审', '人工确认', '审批流', '工具调用', '只读', '写回'),
  ],
  priority: 0.87,
  label: 'Assess AI Agent feasibility',
  promptInstruction:
    'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Identify what can be suggested by AI, what requires human confirmation, and what must remain read-only. Do not imply automatic writes to PLM or QMS.',
  answerStyle: { maxWords: 120, format: 'checklist', tone: 'conservative' },
}
```

In `DynamicActionEngine.mapIntentToActionType()`, add:

```ts
fde_agent_feasibility: 'fde_agent_feasibility',
```

In `syntheticTriggerFor()`, add label:

```ts
fde_agent_feasibility: '判断 AI Agent 可行性',
```

In `DynamicActionProductContract.ts`:

- Add `fde_agent_feasibility` to checklist output types.
- Return `userAction: '判断 AI Agent 可行性边界'`.
- Return `whyNow` that mentions automation boundary and human confirmation.

- [ ] **Step 4: Update FDE default profile**

In `ModesManager.ts`, update the FDE default/custom context text to include:

```text
熟悉制造业研发流程：物料、BOM、图纸、ECR / ECO / ECN、变更评审、发布、版本、权限。
熟悉质量流程：NCR、CAPA、8D、客诉、审计、检验、追溯、偏差、闭环验证。
熟悉企业 AI Agent 部署：知识源接入、权限边界、工具调用、审批流、人机协同、评测和上线治理。
不替客户做流程承诺，不替系统写入数据，不把未知的业务规则说成事实。
```

- [ ] **Step 5: Add FDE grounding contract tests**

Create `electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs` with source-level assertions:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

test('fde plan preserves read-only business context language', () => {
  const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
  assert.match(detector, /read-only|只读/);
  assert.match(detector, /Do not imply automatic writes|不能.*写入|PLM.*QMS/s);
});
```

Create `electron/services/__tests__/FdeManufacturingScenarioProfile.test.mjs` to assert `ModesManager.ts` includes PLM/QMS/AI Agent profile terms.

- [ ] **Step 6: Run FDE tests**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs electron/services/__tests__/FdeActionAnswerShape.test.mjs electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs electron/services/__tests__/FdeManufacturingScenarioProfile.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/dynamic-actions/DynamicActionDetector.ts electron/services/dynamic-actions/DynamicActionEngine.ts electron/services/dynamic-actions/DynamicActionProductContract.ts electron/llm/IntentClassifier.ts electron/services/ModesManager.ts electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs electron/services/__tests__/FdeActionAnswerShape.test.mjs electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs electron/services/__tests__/FdeManufacturingScenarioProfile.test.mjs
git commit -m "feat: productize manufacturing fde dynamic actions"
```

---

### Task 7: Team Meeting Completeness And Carryover

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionProductContract.ts`
- Modify: `electron/services/post-call/PostCallWorkflow.ts`
- Test: `electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs`
- Test: `electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs`
- Test: `electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs`

**Interfaces:**
- Consumes: `buildDynamicActionArtifacts()`
- Produces: Team action completeness checks and post-call accepted-card preservation.

- [ ] **Step 1: Add Team fixture tests**

Create `electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs` using the Task 5 fixture pattern with:

- `我来负责，周五前完成发布 checklist` -> `action_item`, output `action_item`.
- `最终决定用 Postgres` -> `decision_point`, output `decision_record`.
- `现在卡在前端依赖` -> `blocker_check`, output `checklist`.
- `我们的报价表在这` in `team-meet` -> no Sales quote action.

- [ ] **Step 2: Add completeness tests**

Create `electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const artifactPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js');

test('team action artifacts expose missing owner deliverable and due date', async () => {
  const { buildDynamicActionArtifacts } = await import(pathToFileURL(artifactPath).href);
  const [artifact] = buildDynamicActionArtifacts({
    actions: [{
      id: 'a1',
      modeTemplateType: 'team-meet',
      type: 'action_item',
      productContract: { outputType: 'action_item' },
      status: 'accepted',
      createdAt: 1,
      latestTurn: 'Someone should follow up.',
    }],
    usage: [],
  });
  assert.deepEqual(artifact.missingFields.sort(), ['deliverable', 'due_date', 'owner'].sort());
});
```

- [ ] **Step 3: Run Team tests to verify failures**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs
```

Expected: fixture tests may fail until product contract copy/output mappings are tightened.

- [ ] **Step 4: Tighten Team contracts**

In `DynamicActionProductContract.ts`:

- `action_item` -> `userAction: '确认负责人和截止时间'`, `outputType: 'action_item'`.
- `owner_deadline_check` -> `outputType: 'action_item'`.
- `decision_point` -> `outputType: 'decision_record'`.
- `blocker_check` -> `outputType: 'checklist'`.
- `whyNow` for action item should mention owner/deadline signal.
- `whyNow` for decision should mention decision signal.
- `whyNow` for blocker should mention blocker/dependency.

In `PostCallWorkflow.ts`, make sure accepted artifacts are capped and deduped against extracted transcript action items.

- [ ] **Step 5: Run Team tests**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/dynamic-actions/DynamicActionProductContract.ts electron/services/post-call/PostCallWorkflow.ts electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs
git commit -m "feat: productize team meeting dynamic actions"
```

---

### Task 8: No-DB Contract And Final Verification

**Files:**
- Create: `electron/services/__tests__/DynamicActionNoDbSchema.contract.test.mjs`
- Modify: `package.json` only if adding a productization test script is desired after all tests pass.

**Interfaces:**
- Produces: contract that this work does not add durable artifact schema.

- [ ] **Step 1: Add no-DB contract test**

Create `electron/services/__tests__/DynamicActionNoDbSchema.contract.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('dynamic action artifacts remain transient and do not add database schema', () => {
  const db = read('electron/db/DatabaseManager.ts');
  const artifact = read('electron/services/dynamic-actions/DynamicActionArtifacts.ts');
  const rendererFiles = [
    'src/components/NativelyInterface.tsx',
    'src/components/dynamic-actions/DynamicActionBar.tsx',
  ].map(read).join('\n');

  assert.doesNotMatch(db, /dynamic_action_artifacts/i);
  assert.doesNotMatch(db, /action_artifact/i);
  assert.doesNotMatch(db, /ALTER TABLE\s+(meetings|ai_interactions)[\s\S]{0,160}(artifact|dynamic_action)/i);
  assert.doesNotMatch(rendererFiles, /localStorage\.(setItem|getItem)[\s\S]{0,160}(artifact|dynamic_action)/i);
  assert.match(artifact, /not a persisted database record|transient/i);
});
```

- [ ] **Step 2: Run no-DB contract**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionNoDbSchema.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run focused productization suite**

```bash
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test \
  electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs \
  electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs \
  electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs \
  src/components/__tests__/SalesActionCardUx.contract.test.mjs \
  electron/services/__tests__/FdeDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/FdeActionAnswerShape.test.mjs \
  electron/services/__tests__/FdeScreenAndMaterialContext.test.mjs \
  electron/services/__tests__/FdeManufacturingScenarioProfile.test.mjs \
  electron/services/__tests__/TeamMeetingDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/TeamMeetingActionItemCompleteness.test.mjs \
  electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs \
  electron/services/__tests__/DynamicActionNoDbSchema.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run existing regression suite**

```bash
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test \
  electron/services/__tests__/DynamicActionEngine.test.mjs \
  electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs \
  electron/services/__tests__/DynamicActionProductContract.test.mjs \
  electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs \
  electron/services/__tests__/PostCallWorkflow.test.mjs \
  electron/services/eval/__tests__/ContextQualityDiagnostics.test.mjs \
  src/components/__tests__/DynamicActionTrustUx.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

```bash
rtk npm run build:electron
rtk npm run typecheck:electron
rtk npm run build
rtk npm test
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add electron/services/__tests__/DynamicActionNoDbSchema.contract.test.mjs package.json
git commit -m "test: guard dynamic action mode productization contracts"
```

---

## Failure Modes To Cover

```text
Detection -> Card -> Accept -> Generate -> Artifact -> Post-call
  |
  +-- no card for positive fixture          -> fixture recall test
  +-- card emitted for wrong mode           -> false-positive fixture test
  +-- answer invents price/case/capability  -> answer quality test
  +-- material/business context unavailable -> grounding degradation test
  +-- generation fails after accept         -> artifact generated_failed test
  +-- usage metadata missing                -> artifact not_generated fallback test
  +-- post-call omits accepted Team action  -> carryover test
  +-- implementation adds DB schema         -> no-DB contract test
```

## Parallelization Strategy

Sequential implementation is recommended for behavior changes because each mode depends on shared scoring/artifact helpers and the same dynamic action files.

After Task 1 and Task 2 land, limited parallelization is possible:

| Step | Modules touched | Depends on |
| --- | --- | --- |
| Sales productization | `electron/services/dynamic-actions/`, `src/components/__tests__/` | Task 1 |
| FDE productization | `electron/services/dynamic-actions/`, `electron/llm/`, `electron/services/` | Task 1 |
| Team carryover | `electron/services/dynamic-actions/`, `electron/services/post-call/` | Task 2, Task 3, Task 4 |

Conflict flag: Sales and FDE both touch `DynamicActionDetector.ts`, `DynamicActionEngine.ts`, and `DynamicActionProductContract.ts`. Keep them sequential unless separate agents coordinate carefully.

Recommended order:

```text
Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7 -> Task 8
```

## Plan Self-Review Checklist

- Spec coverage: Sales, FDE, Team, transient artifacts, no-DB rule, fixture scoring, and post-call carryover are all mapped to tasks.
- Placeholder scan: no task uses TBD/TODO/fill-in wording.
- Type consistency: `ActionArtifact`, `buildDynamicActionArtifacts`, and `DynamicActionProductFixture` names are stable across tasks.
- Scope check: no database schema, no new UI, no CRM/email/PLM writes.
