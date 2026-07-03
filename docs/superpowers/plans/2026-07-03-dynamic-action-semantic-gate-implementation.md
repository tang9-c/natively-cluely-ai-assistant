# Dynamic Action Semantic Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dynamic-action-specific semantic gate so high-risk actions are triggered by confirmed conversation intent, not raw keyword matches.

**Architecture:** `DynamicActionDetector` remains the regex candidate recall layer. A new `ModeEventClassifier` gates those candidates with local intent signals and a dynamic-action-specific cloud JSON classifier. `DynamicActionEngine.assessSignals()` becomes the production path that calls the gate before `SignalStateTracker`; generated actions carry `semanticGate` trace metadata.

**Tech Stack:** Electron main process TypeScript/CommonJS, Node test runner through Electron, existing dynamic action services, existing `LLMHelper.generateContentStructured()` for cloud JSON classification.

## Global Constraints

- Always communicate with the user in Chinese-simplified.
- Use `rtk` for shell commands.
- Use code-review-graph before manual code exploration.
- Regex must only recall high-risk candidates; it must not directly trigger high-risk dynamic actions.
- Do not expand the public behavior of `classifyIntentWithCloud()` in this version.
- Local intent is a preferred signal only when installed, enabled, available, and high-confidence.
- Cloud action-level confirmation is the required fallback for high-risk candidates when local intent is unavailable or insufficient, subject to provider data-scope policy.
- Default context is current final transcript plus recent 4-6 compact turns.
- Expanded context is capped at 8 turns or 120 seconds.
- Prefer fewer actions over false positives.

---

## File Structure

- Create `electron/services/dynamic-actions/ModeEventClassifier.ts`: owns action-level semantic gate types, high-risk/fast-path policy, deterministic local heuristics, and the dynamic-action-specific cloud confirmation helper.
- Modify `electron/services/dynamic-actions/DynamicAction.ts`: type-import `SemanticGateTrace` from `ModeEventClassifier.ts` and add `semanticGate?: SemanticGateTrace`.
- Modify `src/types/electron.d.ts`: mirror `semanticGate` on `DynamicActionPayload`.
- Modify `electron/services/dynamic-actions/DynamicActionEngine.ts`: inject/use `ModeEventClassifier`, route `assessSignals()` through the gate, add context/cloud options, keep `detectActions()` legacy.
- Modify `electron/IntelligenceEngine.ts`: pass compact recent context turns and a cloud semantic classifier callback into `assessSignals()`.
- Add `electron/services/__tests__/ModeEventClassifier.test.mjs`: deterministic gate tests.
- Modify `electron/services/__tests__/DynamicActionEngine.test.mjs`: migrate high-risk assertions from `detectActions()` to `assessSignals()` and verify trace/degradation.
- Modify `electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs`: verify context propagation and cloud fallback behavior.
- Modify `package.json`: add `test:quality:smoke`.

## Interfaces

Use these exact TypeScript shapes unless an adjacent compiler error forces a narrower import path.

```ts
export type SemanticGateDecision = 'pass' | 'reject' | 'defer' | 'fast_path';
export type SemanticGateProvider = 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable';

export interface ModeEventContextTurn {
    role?: string;
    speaker?: string;
    text: string;
    timestamp?: number;
}

export interface ModeEventCandidate {
    actionType: string;
    label: string;
    match: string;
    confidence: number;
    highRisk: boolean;
    fastPathEligible: boolean;
}

export interface SemanticGateTrace {
    decision: SemanticGateDecision;
    actionType: string;
    semanticIntent?: string;
    confidence: number;
    reasons: string[];
    regexCandidates: string[];
    rejectedCandidates: string[];
    usedLocalIntentModel: boolean;
    usedCloudArbitration: boolean;
    semanticProvider: SemanticGateProvider;
    degradedReason?: string;
    upgradedByRepeatedEvidence: boolean;
}

export interface ModeEventGateDecision {
    candidate: ModeEventCandidate;
    decision: SemanticGateDecision;
    confidence: number;
    semanticIntent?: string;
    reasons: string[];
    rejectedCandidates: string[];
    usedLocalIntentModel: boolean;
    usedCloudArbitration: boolean;
    semanticProvider: SemanticGateProvider;
    degradedReason?: string;
}

export interface CloudSemanticGateInput {
    transcript: string;
    recentContextTurns: ModeEventContextTurn[];
    modeTemplateType: string;
    speaker?: string;
    candidates: ModeEventCandidate[];
    intentResult?: import('../../llm/IntentClassifier').IntentResult;
}

export interface CloudSemanticGateResult {
    actionType: string;
    decision: Extract<SemanticGateDecision, 'pass' | 'reject' | 'defer'>;
    confidence: number;
    semanticIntent?: string;
    reasons?: string[];
    rejectedCandidates?: string[];
}

export type CloudSemanticGateClassifier = (input: CloudSemanticGateInput) => Promise<CloudSemanticGateResult[] | null>;
```

## Task 1: Semantic Gate Core

**Files:**
- Create: `electron/services/dynamic-actions/ModeEventClassifier.ts`
- Test: `electron/services/__tests__/ModeEventClassifier.test.mjs`

**Interfaces:**
- Produces all interfaces listed above.
- Produces `class ModeEventClassifier { assess(input: ModeEventGateInput): Promise<ModeEventGateDecision[]> }`.
- Consumes `ActionTrigger` from `DynamicActionDetector.ts` and `IntentResult` from `IntentClassifier.ts`.

- [ ] **Step 1: Write the failing test file**

Create `electron/services/__tests__/ModeEventClassifier.test.mjs` with these first tests:

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadClassifier() {
  const mod = await import(pathToFileURL(
    path.join(root, 'dist-electron/electron/services/dynamic-actions/ModeEventClassifier.js'),
  ).href);
  return mod;
}

function candidate(actionType, match, confidence = 0.9) {
  return {
    actionType,
    label: actionType,
    match,
    confidence,
    highRisk: ['pricing_objection', 'pricing_request', 'case_study_request', 'technical_requirements', 'buying_signal'].includes(actionType),
    fastPathEligible: false,
  };
}

describe('ModeEventClassifier', () => {
  test('rejects neutral price mention while passing case and technical needs', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier();
    const decisions = await classifier.assess({
      transcript: '价格先放一边，我们想看客户案例和 API 集成要求',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'interviewer',
      candidates: [
        candidate('pricing_objection', '价格'),
        candidate('case_study_request', '客户案例'),
        candidate('technical_requirements', 'API 集成要求'),
      ],
      activeActionTypes: [],
      intentResult: { intent: 'discovery_probe', confidence: 0.7, answerShape: 'brief' },
    });

    assert.equal(decisions.find(d => d.candidate.actionType === 'pricing_objection')?.decision, 'reject');
    assert.equal(decisions.find(d => d.candidate.actionType === 'case_study_request')?.decision, 'pass');
    assert.equal(decisions.find(d => d.candidate.actionType === 'technical_requirements')?.decision, 'pass');
  });

  test('uses cloud confirmation when local intent is unavailable for English high-risk candidates', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const cloudCalls = [];
    const classifier = new ModeEventClassifier({
      cloudClassifier: async input => {
        cloudCalls.push(input);
        return [
          { actionType: 'case_study_request', decision: 'pass', confidence: 0.91, semanticIntent: 'customer_proof', reasons: ['asks for customer proof'] },
          { actionType: 'technical_requirements', decision: 'pass', confidence: 0.9, semanticIntent: 'integration_requirements', reasons: ['asks for SSO integration'] },
          { actionType: 'pricing_objection', decision: 'reject', confidence: 0.83, semanticIntent: 'neutral_pricing_reference', reasons: ['pricing page is neutral'] },
        ];
      },
    });

    const decisions = await classifier.assess({
      transcript: 'The pricing page is fine, but we need customer proof and SSO integration details.',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'interviewer',
      candidates: [
        candidate('pricing_objection', 'pricing page'),
        candidate('case_study_request', 'customer proof'),
        candidate('technical_requirements', 'SSO integration'),
      ],
      activeActionTypes: [],
      providerDataScopes: { transcript: true },
    });

    assert.equal(cloudCalls.length, 1);
    assert.equal(decisions.find(d => d.candidate.actionType === 'pricing_objection')?.decision, 'reject');
    assert.equal(decisions.find(d => d.candidate.actionType === 'case_study_request')?.semanticProvider, 'cloud_llm');
    assert.equal(decisions.find(d => d.candidate.actionType === 'technical_requirements')?.decision, 'pass');
  });

  test('scope denial degrades high-risk candidates instead of pretending semantic confirmation', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({
      cloudClassifier: async () => {
        throw new Error('cloud should not be called when transcript scope is denied');
      },
    });

    const decisions = await classifier.assess({
      transcript: 'This is too expensive.',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'interviewer',
      candidates: [candidate('pricing_objection', 'too expensive')],
      activeActionTypes: [],
      providerDataScopes: { transcript: false },
    });

    assert.equal(decisions[0].decision, 'defer');
    assert.equal(decisions[0].semanticProvider, 'unavailable');
    assert.equal(decisions[0].degradedReason, 'provider_scope_denied');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ModeEventClassifier.test.mjs
```

Expected: fail because `ModeEventClassifier.js` does not exist.

- [ ] **Step 3: Implement `ModeEventClassifier.ts`**

Create `electron/services/dynamic-actions/ModeEventClassifier.ts` with:

```ts
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { IntentResult } from '../../llm/IntentClassifier';

export type SemanticGateDecision = 'pass' | 'reject' | 'defer' | 'fast_path';
export type SemanticGateProvider = 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable';

export interface ModeEventContextTurn {
    role?: string;
    speaker?: string;
    text: string;
    timestamp?: number;
}

export interface ModeEventCandidate {
    actionType: string;
    label: string;
    match: string;
    confidence: number;
    highRisk: boolean;
    fastPathEligible: boolean;
}

export interface SemanticGateTrace {
    decision: SemanticGateDecision;
    actionType: string;
    semanticIntent?: string;
    confidence: number;
    reasons: string[];
    regexCandidates: string[];
    rejectedCandidates: string[];
    usedLocalIntentModel: boolean;
    usedCloudArbitration: boolean;
    semanticProvider: SemanticGateProvider;
    degradedReason?: string;
    upgradedByRepeatedEvidence: boolean;
}

export interface ModeEventGateDecision {
    candidate: ModeEventCandidate;
    decision: SemanticGateDecision;
    confidence: number;
    semanticIntent?: string;
    reasons: string[];
    rejectedCandidates: string[];
    usedLocalIntentModel: boolean;
    usedCloudArbitration: boolean;
    semanticProvider: SemanticGateProvider;
    degradedReason?: string;
}

export interface CloudSemanticGateInput {
    transcript: string;
    recentContextTurns: ModeEventContextTurn[];
    modeTemplateType: string;
    speaker?: string;
    candidates: ModeEventCandidate[];
    intentResult?: IntentResult;
}

export interface CloudSemanticGateResult {
    actionType: string;
    decision: Extract<SemanticGateDecision, 'pass' | 'reject' | 'defer'>;
    confidence: number;
    semanticIntent?: string;
    reasons?: string[];
    rejectedCandidates?: string[];
}

export interface ModeEventGateInput {
    transcript: string;
    recentContextTurns?: ModeEventContextTurn[];
    modeTemplateType: string;
    speaker?: string;
    candidates: ModeEventCandidate[];
    activeActionTypes?: string[];
    intentResult?: IntentResult;
    providerDataScopes?: ProviderDataScopePolicy;
    cloudClassifier?: CloudSemanticGateClassifier;
}

export type CloudSemanticGateClassifier = (input: CloudSemanticGateInput) => Promise<CloudSemanticGateResult[] | null>;

export interface ModeEventClassifierOptions {
    cloudClassifier?: CloudSemanticGateClassifier;
}

const HIGH_RISK_ACTIONS = new Set([
    'pricing_objection',
    'pricing_request',
    'case_study_request',
    'technical_requirements',
    'buying_signal',
]);

const FAST_PATH_ACTIONS = new Set([
    'send_contract',
    'schedule_meeting',
    'coding_problem',
    'action_item',
]);

function includesAny(text: string, terms: string[]): boolean {
    const lower = text.toLowerCase();
    return terms.some(term => lower.includes(term.toLowerCase()));
}

function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function isEnglishOrMixed(text: string): boolean {
    return /[A-Za-z]/.test(text);
}

function localDecisionFor(input: ModeEventGateInput, candidate: ModeEventCandidate): ModeEventGateDecision | null {
    const text = input.transcript;
    const base = {
        candidate,
        rejectedCandidates: [] as string[],
        // Current IntentResult does not expose whether it came from the optional
        // local SLM, regex, or cloud broad intent path. Do not claim the local
        // model was used unless a future explicit source field is added.
        usedLocalIntentModel: false,
        usedCloudArbitration: false,
    };

    if (candidate.actionType === 'pricing_objection') {
        if (includesAny(text, ['price list', 'pricing page', '成本数据', '价格先放一边'])) {
            return {
                ...base,
                decision: 'reject',
                confidence: 0.85,
                semanticIntent: 'neutral_pricing_reference',
                reasons: ['neutral_pricing_reference'],
                semanticProvider: 'local_intent',
            };
        }
        if (includesAny(text, ['too expensive', 'too pricey', 'too high', 'out of budget', '价格太高', '太贵', '超出预算'])) {
            return {
                ...base,
                decision: 'pass',
                confidence: Math.max(candidate.confidence, 0.9),
                semanticIntent: 'pricing_objection',
                reasons: ['explicit_price_pushback'],
                semanticProvider: 'local_intent',
            };
        }
    }

    if (candidate.actionType === 'case_study_request' && includesAny(text, ['case study', 'customer proof', '客户案例', '案例证明', '证明 ROI', '证明roi'])) {
        return {
            ...base,
            decision: 'pass',
            confidence: Math.max(candidate.confidence, 0.88),
            semanticIntent: 'case_or_proof_request',
            reasons: ['case_or_proof_request'],
            semanticProvider: 'local_intent',
        };
    }

    if (candidate.actionType === 'technical_requirements' && includesAny(text, ['API', 'SSO', 'production', 'integration', '技术方案', '生产环境', '部署要求', '集成要求'])) {
        return {
            ...base,
            decision: 'pass',
            confidence: Math.max(candidate.confidence, 0.88),
            semanticIntent: 'technical_requirements',
            reasons: ['technical_or_integration_need'],
            semanticProvider: 'local_intent',
        };
    }

    return null;
}

function shouldUseCloud(input: ModeEventGateInput): boolean {
    if (input.providerDataScopes?.transcript === false) return false;
    const highRiskCount = input.candidates.filter(candidate => candidate.highRisk).length;
    return highRiskCount > 0 && (
        isEnglishOrMixed(input.transcript) ||
        highRiskCount > 1 ||
        includesAny(input.transcript, ['but', 'however', '先放一边', '不是', '不要', '先不'])
    );
}

function shouldUseCloudBeforeLocal(input: ModeEventGateInput, candidate: ModeEventCandidate): boolean {
    if (input.providerDataScopes?.transcript === false) return false;
    if (!(candidate.highRisk || HIGH_RISK_ACTIONS.has(candidate.actionType))) return false;
    const highRiskCount = input.candidates.filter(item => item.highRisk || HIGH_RISK_ACTIONS.has(item.actionType)).length;
    return isEnglishOrMixed(input.transcript) ||
        highRiskCount > 1 ||
        includesAny(input.transcript, ['but', 'however', '先放一边', '不是', '不要', '先不']);
}

export class ModeEventClassifier {
    constructor(private readonly options: ModeEventClassifierOptions = {}) {}

    async assess(input: ModeEventGateInput): Promise<ModeEventGateDecision[]> {
        const decisions = new Map<string, ModeEventGateDecision>();

        for (const candidate of input.candidates) {
            const fastPath = candidate.fastPathEligible || FAST_PATH_ACTIONS.has(candidate.actionType);
            const highRisk = candidate.highRisk || HIGH_RISK_ACTIONS.has(candidate.actionType);

            if (fastPath && !highRisk) {
                decisions.set(candidate.actionType, {
                    candidate,
                    decision: 'fast_path',
                    confidence: clampConfidence(candidate.confidence),
                    semanticIntent: candidate.actionType,
                    reasons: ['rule_fast_path'],
                    rejectedCandidates: [],
                    usedLocalIntentModel: false,
                    usedCloudArbitration: false,
                    semanticProvider: 'rule_fast_path',
                });
                continue;
            }

            if (shouldUseCloudBeforeLocal(input, candidate) && (input.cloudClassifier || this.options.cloudClassifier)) {
                continue;
            }

            const localDecision = localDecisionFor(input, candidate);
            if (localDecision) {
                decisions.set(candidate.actionType, localDecision);
                continue;
            }

            if (!highRisk) {
                decisions.set(candidate.actionType, {
                    candidate,
                    decision: 'pass',
                    confidence: clampConfidence(candidate.confidence),
                    semanticIntent: candidate.actionType,
                    reasons: ['low_risk_candidate'],
                    rejectedCandidates: [],
                    usedLocalIntentModel: false,
                    usedCloudArbitration: false,
                    semanticProvider: 'local_intent',
                });
            }
        }

        const unresolvedHighRisk = input.candidates.filter(candidate =>
            (candidate.highRisk || HIGH_RISK_ACTIONS.has(candidate.actionType)) &&
            !decisions.has(candidate.actionType)
        );

        if (unresolvedHighRisk.length > 0) {
            if (input.providerDataScopes?.transcript === false) {
                for (const candidate of unresolvedHighRisk) {
                    decisions.set(candidate.actionType, this.degraded(candidate, 'provider_scope_denied'));
                }
            } else if (shouldUseCloud({ ...input, candidates: unresolvedHighRisk }) && (input.cloudClassifier || this.options.cloudClassifier)) {
                const cloudClassifier = input.cloudClassifier ?? this.options.cloudClassifier;
                const cloudResults = await cloudClassifier?.({
                    transcript: input.transcript,
                    recentContextTurns: input.recentContextTurns ?? [],
                    modeTemplateType: input.modeTemplateType,
                    speaker: input.speaker,
                    candidates: unresolvedHighRisk,
                    intentResult: input.intentResult,
                }).catch(() => null);
                const validTypes = new Set(unresolvedHighRisk.map(candidate => candidate.actionType));
                for (const result of cloudResults ?? []) {
                    if (!validTypes.has(result.actionType)) continue;
                    const candidate = unresolvedHighRisk.find(item => item.actionType === result.actionType);
                    if (!candidate) continue;
                    decisions.set(result.actionType, {
                        candidate,
                        decision: result.decision,
                        confidence: clampConfidence(result.confidence),
                        semanticIntent: result.semanticIntent,
                        reasons: result.reasons ?? ['cloud_semantic_confirmation'],
                        rejectedCandidates: result.rejectedCandidates ?? [],
                        usedLocalIntentModel: false,
                        usedCloudArbitration: true,
                        semanticProvider: 'cloud_llm',
                    });
                }
                for (const candidate of unresolvedHighRisk) {
                    if (!decisions.has(candidate.actionType)) {
                        decisions.set(candidate.actionType, this.degraded(candidate, 'cloud_semantic_gate_unavailable'));
                    }
                }
            } else {
                for (const candidate of unresolvedHighRisk) {
                    decisions.set(candidate.actionType, this.degraded(candidate, 'local_intent_unavailable'));
                }
            }
        }

        return input.candidates.map(candidate => decisions.get(candidate.actionType) ?? this.degraded(candidate, 'semantic_gate_unavailable'));
    }

    private degraded(candidate: ModeEventCandidate, reason: string): ModeEventGateDecision {
        return {
            candidate,
            decision: 'defer',
            confidence: Math.min(0.7, clampConfidence(candidate.confidence)),
            semanticIntent: candidate.actionType,
            reasons: [reason],
            rejectedCandidates: [],
            usedLocalIntentModel: false,
            usedCloudArbitration: false,
            semanticProvider: 'unavailable',
            degradedReason: reason,
        };
    }
}
```

- [ ] **Step 4: Run the test again**

Run:

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ModeEventClassifier.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit Task 1**

```bash
rtk git add electron/services/dynamic-actions/ModeEventClassifier.ts electron/services/__tests__/ModeEventClassifier.test.mjs
rtk git commit -m "feat: add dynamic action semantic gate"
```

## Task 2: Add Semantic Gate Trace To Action Types

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicAction.ts`
- Modify: `src/types/electron.d.ts`
- Test: `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs`

**Interfaces:**
- Consumes `SemanticGateTrace` exported by `ModeEventClassifier.ts` from Task 1.
- Produces `DynamicAction.semanticGate?: SemanticGateTrace` and renderer mirror `DynamicActionPayload.semanticGate`.

- [ ] **Step 1: Add a contract test**

Append to `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs`:

```js
test('dynamic action payload mirrors semanticGate trace metadata', () => {
  const action = read('electron/services/dynamic-actions/DynamicAction.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(action, /semanticGate\?:/);
  assert.match(action, /semanticProvider/);
  assert.match(action, /degradedReason/);
  assert.match(types, /semanticGate\?:/);
  assert.match(types, /usedCloudArbitration/);
  assert.match(types, /upgradedByRepeatedEvidence/);
});
```

- [ ] **Step 2: Run the failing contract test**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs
```

Expected: fail because `semanticGate` is not mirrored.

- [ ] **Step 3: Update main-process action type**

In `electron/services/dynamic-actions/DynamicAction.ts`, add a type-only import near the top:

```ts
import type { SemanticGateTrace } from './ModeEventClassifier';
```

Then add inside `DynamicAction`:

```ts
    semanticGate?: SemanticGateTrace;
```

- [ ] **Step 4: Update renderer mirror type**

In `src/types/electron.d.ts`, add:

```ts
export interface DynamicActionSemanticGate {
  decision: 'pass' | 'reject' | 'defer' | 'fast_path'
  actionType: string
  semanticIntent?: string
  confidence: number
  reasons: string[]
  regexCandidates: string[]
  rejectedCandidates: string[]
  usedLocalIntentModel: boolean
  usedCloudArbitration: boolean
  semanticProvider: 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable'
  degradedReason?: string
  upgradedByRepeatedEvidence: boolean
}
```

Then add inside `DynamicActionPayload`:

```ts
  semanticGate?: DynamicActionSemanticGate
```

- [ ] **Step 5: Run the contract test**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit Task 2**

```bash
rtk git add electron/services/dynamic-actions/DynamicAction.ts src/types/electron.d.ts electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs
rtk git commit -m "feat: expose dynamic action semantic gate trace"
```

## Task 3: Route `assessSignals()` Through Semantic Gate

**Files:**
- Modify: `electron/services/dynamic-actions/DynamicActionEngine.ts`
- Test: `electron/services/__tests__/DynamicActionEngine.test.mjs`

**Interfaces:**
- Consumes `ModeEventClassifier`, `ModeEventContextTurn`, `CloudSemanticGateClassifier`, `ModeEventGateDecision`.
- Produces async `assessSignals(params): Promise<DynamicAction[]>`.
- Keeps `detectActions()` synchronous legacy behavior for low-risk callers.
- Preserves `synthesizeTrigger()` by sending intent-only synthetic candidates through the semantic gate.

- [ ] **Step 1: Add failing engine tests**

Append to `electron/services/__tests__/DynamicActionEngine.test.mjs`:

```js
describe('DynamicActionEngine semantic gate', () => {
  test('assessSignals rejects price candidate while passing case and technical requirements', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: '价格先放一边，我们想看客户案例和 API 集成要求',
      modeTemplateType: 'sales',
      modeId: 'mode-sales',
      sessionId: 'semantic-sales-1',
      intentResult: { intent: 'discovery_probe', confidence: 0.7, answerShape: 'brief' },
    });

    assert.equal(actions.some(action => action.type === 'pricing_objection' || action.type === 'pricing_request'), false);
    assert.ok(actions.some(action => action.type === 'case_study_request'));
    assert.ok(actions.some(action => action.type === 'technical_requirements'));
    assert.ok(actions.every(action => action.semanticGate?.decision === 'pass'));
  });

  test('assessSignals degrades high-risk candidates when transcript scope is denied', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: 'This is too expensive.',
      modeTemplateType: 'sales',
      modeId: 'mode-sales',
      sessionId: 'semantic-sales-scope-denied',
      providerDataScopes: { transcript: false },
    });

    assert.equal(actions.length, 0);
  });

  test('assessSignals uses injected cloud classifier for English high-risk candidates', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine(undefined, undefined, undefined, {
      cloudClassifier: async () => [
        { actionType: 'pricing_objection', decision: 'reject', confidence: 0.9, semanticIntent: 'neutral_pricing_reference', reasons: ['neutral price'] },
        { actionType: 'case_study_request', decision: 'pass', confidence: 0.92, semanticIntent: 'customer_proof', reasons: ['customer proof'] },
        { actionType: 'technical_requirements', decision: 'pass', confidence: 0.91, semanticIntent: 'integration_requirements', reasons: ['SSO integration'] },
      ],
    });
    const actions = await engine.assessSignals({
      transcript: 'The pricing page is fine, but we need customer proof and SSO integration details.',
      modeTemplateType: 'sales',
      modeId: 'mode-sales',
      sessionId: 'semantic-sales-cloud',
      providerDataScopes: { transcript: true },
    });

    assert.equal(actions.some(action => action.type === 'pricing_objection'), false);
    assert.ok(actions.find(action => action.type === 'case_study_request')?.semanticGate?.usedCloudArbitration);
    assert.ok(actions.find(action => action.type === 'technical_requirements')?.semanticGate?.semanticProvider === 'cloud_llm');
  });
});
```

- [ ] **Step 2: Run the failing engine tests**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/DynamicActionEngine.test.mjs
```

Expected: fail because `assessSignals()` is synchronous and does not accept semantic gate options.

- [ ] **Step 3: Update constructor and params**

In `DynamicActionEngine.ts`, import:

```ts
import {
    CloudSemanticGateClassifier,
    ModeEventCandidate,
    ModeEventClassifier,
    ModeEventClassifierOptions,
    ModeEventContextTurn,
    ModeEventGateDecision,
    SemanticGateTrace,
} from './ModeEventClassifier';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
```

Update class fields and constructor:

```ts
    private semanticGate: ModeEventClassifier;

    constructor(
        store: DynamicActionStore = new DynamicActionStore(),
        detector: DynamicActionDetector = new DynamicActionDetector(MODE_TRIGGERS),
        signalTracker: SignalStateTracker = new SignalStateTracker(),
        semanticGateOptions: ModeEventClassifierOptions = {},
    ) {
        this.store = store;
        this.detector = detector;
        this.signalTracker = signalTracker;
        this.semanticGate = new ModeEventClassifier(semanticGateOptions);
    }
```

Change `assessSignals` to return `Promise<DynamicAction[]>` and add params:

```ts
        recentContextTurns?: ModeEventContextTurn[];
        providerDataScopes?: ProviderDataScopePolicy;
        cloudClassifier?: CloudSemanticGateClassifier;
```

- [ ] **Step 4: Convert regex matches into gate candidates**

Inside `assessSignals()`, replace direct `triggerCandidates` assessment with:

```ts
        const triggerCandidates = matchedTriggers.map(({ trigger, match }) => ({
            trigger,
            match,
            confidence: this.scoreTrigger(trigger, modeTemplateType, params.intentResult),
            confirmationSource: this.confirmationSourceFor(params.intentResult),
            confirmedIntent: params.intentResult?.intent,
        }));
        const synthTrigger = matchedTriggers.length === 0
            ? this.synthesizeTrigger(modeTemplateType, params.intentResult)
            : null;

        if (synthTrigger) {
            triggerCandidates.push({
                trigger: synthTrigger,
                match: params.intentResult?.intent ?? synthTrigger.type,
                confidence: params.intentResult?.confidence ?? synthTrigger.priority,
                confirmationSource: this.confirmationSourceFor(params.intentResult),
                confirmedIntent: params.intentResult?.intent,
            });
        }

        const gateCandidates: ModeEventCandidate[] = triggerCandidates.map(candidate => ({
            actionType: candidate.trigger.type,
            label: candidate.trigger.label,
            match: candidate.match,
            confidence: candidate.confidence,
            highRisk: this.isHighRiskAction(candidate.trigger.type),
            fastPathEligible: this.isFastPathAction(candidate.trigger.type),
        }));

        const gateDecisions = await this.semanticGate.assess({
            transcript,
            recentContextTurns: params.recentContextTurns ?? [],
            modeTemplateType,
            speaker,
            candidates: gateCandidates,
            activeActionTypes: this.store.getActiveActions(sessionId).map(action => action.type),
            intentResult: params.intentResult,
            providerDataScopes: params.providerDataScopes,
            cloudClassifier: params.cloudClassifier,
        });
```

Add helpers:

```ts
    private isHighRiskAction(type: string): boolean {
        return ['pricing_objection', 'pricing_request', 'case_study_request', 'technical_requirements', 'buying_signal'].includes(type);
    }

    private isFastPathAction(type: string): boolean {
        return ['send_contract', 'schedule_meeting', 'coding_problem', 'action_item'].includes(type);
    }
```

- [ ] **Step 5: Filter decisions before `SignalStateTracker`**

Iterate only decisions with `pass` or `fast_path`:

```ts
        const decisionsByType = new Map(gateDecisions.map(decision => [decision.candidate.actionType, decision]));

        for (const candidate of triggerCandidates) {
            const gateDecision = decisionsByType.get(candidate.trigger.type);
            if (!gateDecision || gateDecision.decision === 'reject' || gateDecision.decision === 'defer') {
                continue;
            }
            const semanticGate = this.buildSemanticGateTrace(gateDecision, gateDecisions, false);
            // continue with existing evidenceRef, signalTracker.assess, and buildAction
        }
```

Add helper:

```ts
    private buildSemanticGateTrace(
        decision: ModeEventGateDecision,
        allDecisions: ModeEventGateDecision[],
        upgradedByRepeatedEvidence: boolean,
    ): SemanticGateTrace {
        return {
            decision: decision.decision,
            actionType: decision.candidate.actionType,
            semanticIntent: decision.semanticIntent,
            confidence: decision.confidence,
            reasons: decision.reasons,
            regexCandidates: allDecisions.map(item => item.candidate.actionType),
            rejectedCandidates: allDecisions
                .filter(item => item.decision === 'reject')
                .map(item => item.candidate.actionType),
            usedLocalIntentModel: decision.usedLocalIntentModel,
            usedCloudArbitration: decision.usedCloudArbitration,
            semanticProvider: decision.semanticProvider,
            degradedReason: decision.degradedReason,
            upgradedByRepeatedEvidence,
        };
    }
```

Pass `semanticGate` into `buildAction()` and add it to the returned action.

- [ ] **Step 6: Fix sales intent-to-action mapping**

In `mapIntentToActionType()`, change the `sales` table from:

```ts
            sales: {
                handle_objection: 'pricing_objection',
                seize_signal: 'buying_signal',
                discovery_probe: 'pricing_request',
            },
```

to:

```ts
            sales: {
                handle_objection: 'pricing_objection',
                seize_signal: 'buying_signal',
            },
```

Do not map `discovery_probe` to `pricing_request`. Case study and technical requirements should come from regex candidates plus semantic gate decisions, not broad discovery intent.

- [ ] **Step 7: Adjust callers and tests to await `assessSignals()`**

Update every test call that uses `engine.assessSignals(...)` to `await engine.assessSignals(...)`.

Run:

```bash
rtk rg -n "assessSignals\\(" electron/services/__tests__ electron
```

Expected: all non-definition call sites either `await` or return the promise.

- [ ] **Step 8: Run the engine tests**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ModeEventClassifier.test.mjs electron/services/__tests__/DynamicActionEngine.test.mjs
```

Expected: pass.

- [ ] **Step 9: Commit Task 3**

```bash
rtk git add electron/services/dynamic-actions/DynamicActionEngine.ts electron/services/__tests__/DynamicActionEngine.test.mjs
rtk git commit -m "feat: gate dynamic actions before signal tracking"
```

## Task 4: Audit Async `assessSignals()` Migration

**Files:**
- Modify: `electron/services/__tests__/DynamicActionEngine.test.mjs`
- Modify: any additional test file reported by the audit command.

**Interfaces:**
- Consumes async `DynamicActionEngine.assessSignals()`.
- Produces no new runtime interface; this task only prevents stale synchronous call sites from treating a `Promise<DynamicAction[]>` like an array.

- [ ] **Step 1: Find all call sites**

Run:

```bash
rtk rg -n "assessSignals\\(" electron src
```

Expected: one definition in `DynamicActionEngine.ts`, one production call in `IntelligenceEngine.ts`, and test call sites.

- [ ] **Step 2: Convert test call sites to await**

For each test call, change patterns like:

```js
const actions = engine.assessSignals({
  transcript,
  modeTemplateType,
  modeId,
  sessionId,
});
```

to:

```js
const actions = await engine.assessSignals({
  transcript,
  modeTemplateType,
  modeId,
  sessionId,
});
```

For multi-turn variables, change:

```js
const first = engine.assessSignals(firstParams);
const second = engine.assessSignals(secondParams);
```

to:

```js
const first = await engine.assessSignals(firstParams);
const second = await engine.assessSignals(secondParams);
```

- [ ] **Step 3: Verify there are no synchronous array reads from `assessSignals()`**

Run:

```bash
rtk rg -n "const .* = engine\\.assessSignals|engine\\.assessSignals\\([\\s\\S]{0,120}\\)\\.some|engine\\.assessSignals\\([\\s\\S]{0,120}\\)\\[" electron/services/__tests__ electron
```

Expected: no stale synchronous usage. If this command prints matches, convert those call sites to `await`.

- [ ] **Step 4: Run affected tests**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/DynamicActionEngine.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit Task 4**

```bash
rtk git add electron/services/__tests__/DynamicActionEngine.test.mjs
rtk git commit -m "test: await async dynamic action signal assessment"
```

## Task 5: Pass Compact Context And Cloud Callback From IntelligenceEngine

**Files:**
- Modify: `electron/IntelligenceEngine.ts`
- Test: `electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs`

**Interfaces:**
- Consumes async `dynamicActionEngine.assessSignals()`.
- Produces `buildDynamicActionContextTurns(transcriptTurns): ModeEventContextTurn[]`.
- Produces a private `classifyDynamicActionWithCloud(input): Promise<CloudSemanticGateResult[] | null>` callback.

- [ ] **Step 1: Add failing IntelligenceEngine tests**

Append to `IntelligenceEngineDynamicActions.test.mjs`:

```js
test('dynamic actions pass compact recent context into semantic gate', async () => {
  const { engine, session } = await makeEngine();
  const calls = [];
  engine._setDynamicActionEngineForTest({
    assessSignals: async input => {
      calls.push(input);
      return [];
    },
  });
  engine.setDynamicActionContext({ sessionId: 'sess-context', modeId: 'mode-sales', modeTemplateType: 'sales' });

  for (let i = 0; i < 8; i += 1) {
    session.handleTranscript({ speaker: 'interviewer', text: `历史上下文 ${i}`, timestamp: Date.now() + i, final: true });
  }

  engine.handleTranscript({ speaker: 'interviewer', text: '客户想看 API 集成要求', timestamp: Date.now() + 20, final: true }, true);
  await waitForAsyncSignals();

  assert.equal(calls.length, 1);
  assert.ok(calls[0].recentContextTurns.length <= 6);
  assert.ok(calls[0].recentContextTurns.some(turn => turn.text.includes('客户想看 API 集成要求')));
});

test('dynamic action cloud semantic classifier returns strict action-level results', async () => {
  const helper = new StubLLMHelper({
    structuredResponses: ['{"actions":[{"actionType":"technical_requirements","decision":"pass","confidence":0.93,"semanticIntent":"integration_requirements","reasons":["SSO integration"]}]}'],
  });
  const { engine } = await makeEngine(helper);
  const emitted = [];
  engine.on('dynamic_action_emitted', action => emitted.push(action));
  engine.setDynamicActionContext({ sessionId: 'sess-cloud-action', modeId: 'mode-sales', modeTemplateType: 'sales' });

  engine.handleTranscript({ speaker: 'interviewer', text: 'We need SSO integration details.', timestamp: Date.now(), final: true }, true);
  await waitForAsyncSignals();

  assert.ok(helper.structuredCalls.some(call => call.options?.taskLabel === 'dynamic-action-semantic-gate'));
});
```

- [ ] **Step 2: Run failing IntelligenceEngine tests**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
```

Expected: fail because `assessSignals()` is not awaited/passed compact turns/cloud callback.

- [ ] **Step 3: Import semantic gate types**

In `IntelligenceEngine.ts`, import:

```ts
import type {
    CloudSemanticGateInput,
    CloudSemanticGateResult,
    ModeEventContextTurn,
} from './services/dynamic-actions/ModeEventClassifier';
```

- [ ] **Step 4: Add compact context helper**

Add private helper:

```ts
    private buildDynamicActionContextTurns(turns: TranscriptTurn[]): ModeEventContextTurn[] {
        return turns
            .slice(-6)
            .map(turn => ({
                role: turn.role,
                speaker: turn.speakerLabel ?? turn.speakerId ?? turn.role,
                text: turn.text,
                timestamp: turn.timestamp,
            }))
            .filter(turn => turn.text.trim().length > 0);
    }
```

- [ ] **Step 5: Add cloud action classifier helper**

Add private helper:

```ts
    private async classifyDynamicActionWithCloud(
        input: CloudSemanticGateInput,
    ): Promise<CloudSemanticGateResult[] | null> {
        const candidateSet = new Set(input.candidates.map(candidate => candidate.actionType));
        const prompt = [
            '你是会议实时助手的动态动作语义门控，只返回 JSON，不生成回答建议。',
            '根据最新一句、最近短上下文、当前模式和候选 actionType，判断哪些候选动作应该通过。',
            '只能从 candidates.actionType 中选择 actionType。不能创造新 actionType。',
            'decision 只能是 pass、reject 或 defer。confidence 必须是 0 到 1 的数字。',
            '如果只是中性提及、否定、转折或证据不足，使用 reject 或 defer。',
            '',
            `modeTemplateType: ${input.modeTemplateType}`,
            `speaker: ${input.speaker ?? 'unknown'}`,
            `candidates: ${JSON.stringify(input.candidates.map(candidate => ({ actionType: candidate.actionType, match: candidate.match, confidence: candidate.confidence })))}`,
            `latestTurn: ${JSON.stringify(input.transcript)}`,
            `recentContextTurns: ${JSON.stringify(input.recentContextTurns.slice(-8))}`,
            `intentResult: ${JSON.stringify(input.intentResult ?? null)}`,
            '',
            '返回格式: {"actions":[{"actionType":"...","decision":"pass|reject|defer","confidence":0.0,"semanticIntent":"...","reasons":["..."],"rejectedCandidates":["..."]}]}',
        ].join('\n');

        try {
            const raw = await this.llmHelper.generateContentStructured(prompt, {
                taskLabel: 'dynamic-action-semantic-gate',
                maxOutputTokens: 256,
                perProviderTimeoutMs: 2500,
                maxRotations: 1,
            });
            const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
            if (!jsonText) return null;
            const parsed = JSON.parse(jsonText) as { actions?: CloudSemanticGateResult[] };
            if (!Array.isArray(parsed.actions)) return null;
            return parsed.actions.filter(action =>
                candidateSet.has(action.actionType) &&
                ['pass', 'reject', 'defer'].includes(action.decision) &&
                Number.isFinite(Number(action.confidence))
            ).map(action => ({
                ...action,
                confidence: Math.max(0, Math.min(1, Number(action.confidence))),
                reasons: Array.isArray(action.reasons) ? action.reasons : [],
                rejectedCandidates: Array.isArray(action.rejectedCandidates) ? action.rejectedCandidates : [],
            }));
        } catch (error) {
            console.warn('[IntelligenceEngine] Dynamic action semantic gate failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
```

- [ ] **Step 6: Await `assessSignals()` and pass context/cloud**

In `detectConfirmAndEmitDynamicActions()`, use:

```ts
        const recentContextTurns = this.buildDynamicActionContextTurns(transcriptTurns);
        const newActions = await this.dynamicActionEngine.assessSignals({
            transcript: text,
            speaker: segment.speaker,
            modeTemplateType: this.currentDynamicActionTemplateType,
            modeId: this.currentDynamicActionModeId,
            sessionId: this.currentSessionId,
            emotion: segment.emotion,
            emotionSource: segment.emotionSource,
            intentResult,
            recentContextTurns,
            providerDataScopes: this.buildIntentClassificationOptions().providerDataScopes,
            cloudClassifier: input => this.classifyDynamicActionWithCloud(input),
        });
```

If constructing intent options twice feels noisy, assign it before `classifyIntent()`:

```ts
        const intentOptions = {
            ...this.buildIntentClassificationOptions(),
            cloudFirst: true,
        };
```

Then use `intentOptions.providerDataScopes`.

- [ ] **Step 7: Run IntelligenceEngine tests**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
```

Expected: pass.

- [ ] **Step 8: Commit Task 5**

```bash
rtk git add electron/IntelligenceEngine.ts electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
rtk git commit -m "feat: add cloud semantic fallback for dynamic actions"
```

## Task 6: High-Risk Test Migration And Legacy Guard

**Files:**
- Modify: `electron/services/__tests__/DynamicActionEngine.test.mjs`
- Modify: `electron/services/dynamic-actions/DynamicActionEngine.ts`

**Interfaces:**
- Consumes async `assessSignals()`.
- Produces documented legacy boundary for `detectActions()`.

- [ ] **Step 1: Find high-risk `detectActions()` tests**

Run:

```bash
rtk rg -n "detectActions\\(|pricing_objection|pricing_request|case_study_request|technical_requirements|buying_signal" electron/services/__tests__/DynamicActionEngine.test.mjs
```

Expected: list high-risk tests that still call `detectActions()`.

- [ ] **Step 2: Convert high-risk tests to `assessSignals()`**

For every high-risk semantic behavior test, change:

```js
const actions = engine.detectActions({
  transcript,
  modeTemplateType: 'sales',
  modeId: 'm_s',
  sessionId: 's_s_example',
});
```

to:

```js
const actions = await engine.assessSignals({
  transcript,
  modeTemplateType: 'sales',
  modeId: 'm_s',
  sessionId: 's_s_example',
  providerDataScopes: { transcript: true },
});
```

Keep low-risk pack smoke tests on `detectActions()` if they only prove trigger pack existence.

- [ ] **Step 3: Add legacy comment to `detectActions()`**

Above `detectActions()` in `DynamicActionEngine.ts`, add:

```ts
    /**
     * Legacy synchronous regex detector used by older tests and low-risk trigger
     * pack smoke checks. Production dynamic action emission must use
     * assessSignals(), which applies action-level semantic gating before storing
     * or emitting high-risk actions.
     */
```

- [ ] **Step 4: Run migrated tests**

```bash
rtk npm run build:electron && rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/DynamicActionEngine.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit Task 6**

```bash
rtk git add electron/services/dynamic-actions/DynamicActionEngine.ts electron/services/__tests__/DynamicActionEngine.test.mjs
rtk git commit -m "test: migrate high-risk dynamic actions to semantic gate"
```

## Task 7: Quality Smoke Command

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces `npm run test:quality:smoke`.

- [ ] **Step 1: Add the script**

In `package.json`, add this script near the other test scripts:

```json
"test:quality:smoke": "npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ModeEventClassifier.test.mjs electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs electron/llm/__tests__/ModeAwareIntent.test.mjs electron/services/__tests__/AnswerTracePersistence.contract.test.mjs electron/services/__tests__/AnswerContextTraceContract.test.mjs"
```

- [ ] **Step 2: Run the smoke command**

```bash
rtk npm run test:quality:smoke
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

```bash
rtk npm run typecheck:electron
```

Expected: pass.

- [ ] **Step 4: Commit Task 7**

```bash
rtk git add package.json
rtk git commit -m "chore: add quality smoke test command"
```

## Final Verification

Run:

```bash
rtk npm run build:electron
rtk npm run typecheck:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ModeEventClassifier.test.mjs electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs electron/llm/__tests__/ModeAwareIntent.test.mjs
rtk npm run test:quality:smoke
```

Expected: all commands pass.

## Self-Review Checklist

- Spec coverage: all approved design sections map to tasks above.
- Open-ended requirement scan: no vague implementation gaps are allowed in this plan.
- Type consistency: `SemanticGateTrace`, `ModeEventGateDecision`, and `CloudSemanticGateResult` names are consistent across tasks.
- Scope control: this plan does not change STT, ASR, VAD, the public `classifyIntentWithCloud()` behavior, or user-facing analytics dashboards.
