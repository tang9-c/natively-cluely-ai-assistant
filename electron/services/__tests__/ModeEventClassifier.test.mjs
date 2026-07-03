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
