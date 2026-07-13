import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  SALES_INDUSTRIAL_POSITIVE_FIXTURES,
  SALES_INDUSTRIAL_CONFLICT_FIXTURES,
  NON_SALES_INDUSTRIAL_ISOLATION_FIXTURES,
} from '../../llm/__tests__/SalesIndustrialDiscoveryFixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');

async function loadEngine() {
  const engineMod = await import(`${pathToFileURL(enginePath).href}?t=${Date.now()}`);
  return engineMod.DynamicActionEngine;
}

describe('sales industrial discovery dynamic actions', () => {
  test('sales industrial discovery intents map to one discovery_question card', async () => {
    const DynamicActionEngine = await loadEngine();

    for (const fixture of SALES_INDUSTRIAL_POSITIVE_FIXTURES) {
      const engine = new DynamicActionEngine();
      const actions = await engine.assessSignals({
        transcript: fixture.utterance,
        speaker: 'Customer',
        modeTemplateType: 'sales',
        modeId: 'mode_sales',
        sessionId: `session_${fixture.notes}`,
        intentResult: {
          intent: fixture.expectedIntent,
          confidence: 0.9,
          answerShape: 'ask discovery questions',
        },
      });

      const action = actions.find(item => item.type === fixture.expectedAction);
      assert.ok(action, `${fixture.notes} should emit ${fixture.expectedAction}; got ${actions.map(item => item.type).join(', ')}`);
      assert.equal(action.sourceIntent, fixture.expectedIntent, fixture.notes);
      assert.equal(action.latestTurn, fixture.utterance, fixture.notes);
      assert.equal(action.productContract.userAction, '提出发现问题', fixture.notes);
      assert.equal(action.semanticGate?.decision, 'pass', fixture.notes);
      assert.equal(action.semanticGate?.semanticIntent, fixture.expectedIntent, fixture.notes);
    }
  });

  test('sales conflict fixtures preserve intended action and source intent', async () => {
    const DynamicActionEngine = await loadEngine();

    for (const fixture of SALES_INDUSTRIAL_CONFLICT_FIXTURES) {
      const engine = new DynamicActionEngine();
      const actions = await engine.assessSignals({
        transcript: fixture.utterance,
        speaker: 'Customer',
        modeTemplateType: 'sales',
        modeId: 'mode_sales',
        sessionId: `session_conflict_${fixture.notes}`,
        intentResult: {
          intent: fixture.expectedIntent,
          confidence: 0.9,
          answerShape: 'expected conflict action',
        },
      });

      const action = actions.find(item => item.type === fixture.expectedAction);
      assert.ok(action, `${fixture.notes} should emit ${fixture.expectedAction}; got ${actions.map(item => item.type).join(', ')}`);
      assert.ok(!fixture.mustNotIntent.includes(action.sourceIntent), fixture.notes);
    }
  });

  test('cloud gate can select discovery_question for a mixed sales sentence', async () => {
    const DynamicActionEngine = await loadEngine();
    let cloudCalled = false;
    const engine = new DynamicActionEngine(undefined, undefined, undefined, {
      cloudClassifier: async (input) => {
        cloudCalled = true;
        assert.ok(input.candidates.some(candidate => candidate.actionType === 'discovery_question'));
        return input.candidates.map(candidate => ({
          actionType: candidate.actionType,
          decision: candidate.actionType === 'discovery_question' ? 'pass' : 'reject',
          confidence: candidate.actionType === 'discovery_question' ? 0.91 : 0.7,
          semanticIntent: candidate.actionType === 'discovery_question'
            ? 'sales_contextual_proof_discovery'
            : candidate.actionType,
          reasons: ['cloud_test'],
          rejectedCandidates: candidate.actionType === 'discovery_question' ? [] : ['discovery_question'],
        }));
      },
    });

    const actions = await engine.assessSignals({
      transcript: '先不谈价格，我们要看 PLM/QMS 闭环案例。',
      speaker: 'Customer',
      modeTemplateType: 'sales',
      modeId: 'mode_sales',
      sessionId: 'session_cloud_discovery',
    });

    const action = actions.find(item => item.type === 'discovery_question');
    assert.equal(cloudCalled, true);
    assert.ok(action, `Expected discovery_question; got ${actions.map(item => item.type).join(', ')}`);
    assert.equal(action.semanticGate?.arbitrationStatus, 'cloud_used');
    assert.equal(action.sourceIntent, 'sales_contextual_proof_discovery');
  });

  test('scope-denied unresolved discovery signal does not emit discovery_question', async () => {
    const DynamicActionEngine = await loadEngine();
    const engine = new DynamicActionEngine();

    const actions = await engine.assessSignals({
      transcript: '有没有客户把 PLM、QMS 和 MES 打通的案例？',
      speaker: 'Customer',
      modeTemplateType: 'sales',
      modeId: 'mode_sales',
      sessionId: 'session_scope_denied',
      providerDataScopes: { transcript: false },
    });

    assert.equal(actions.some(item => item.type === 'discovery_question'), false);
  });

  test('non-sales industrial utterances do not emit discovery_question', async () => {
    const DynamicActionEngine = await loadEngine();

    for (const fixture of NON_SALES_INDUSTRIAL_ISOLATION_FIXTURES) {
      const engine = new DynamicActionEngine();
      const actions = await engine.assessSignals({
        transcript: fixture.utterance,
        speaker: 'Speaker',
        modeTemplateType: fixture.modeTemplateType,
        modeId: `mode_${fixture.modeTemplateType}`,
        sessionId: `session_${fixture.modeTemplateType}`,
        intentResult: {
          intent: fixture.expectedIntent,
          confidence: 0.9,
          answerShape: 'mode-specific action',
        },
      });

      assert.equal(actions.some(item => item.type === fixture.mustNotAction), false, fixture.notes);
      assert.ok(actions.some(item => item.type === fixture.expectedAction), `${fixture.notes}; got ${actions.map(item => item.type).join(', ')}`);
    }
  });
});
