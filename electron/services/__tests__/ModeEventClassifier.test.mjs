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

function policyDefaults(actionType) {
  const highRiskActions = ['pricing_objection', 'pricing_request', 'case_study_request', 'discovery_question', 'technical_requirements', 'buying_signal', 'coding_problem', 'system_design_prompt'];
  const localFallbackByAction = {
    pricing_objection: [{ includeAny: ['太贵', '价格太高', '预算不够', '预算不足', '预算过不了', 'out of budget', 'too expensive'], rejectAny: ['报价表', '价格页', '成本数据'] }],
    pricing_request: [{ includeAny: ['发我报价', '发一版报价', '给客户发一版报价', '报个价格', '给个价格', '报价单', '模块多少钱', 'what does it cost', 'proposal'], rejectAny: ['报价表在这', '内部报价', '价格页'] }],
    buying_signal: [{ includeAny: ['发合同', '法务审核', '放假审核', '准备签', '准备推进', '安排时间', 'send contract', 'legal review'] }],
  };
  const riskLevel = highRiskActions.includes(actionType) ? 'high' : 'medium';
  return {
    riskLevel,
    gateStrategy: riskLevel === 'high' ? 'required' : 'preferred',
    allowLocalFallbackOnCloudFailure: Boolean(localFallbackByAction[actionType]),
    requiredEvidence: [],
    localFallbackEvidence: localFallbackByAction[actionType] ?? [],
  };
}

function candidate(actionType, match, confidence = 0.9, overrides = {}) {
  const policy = { ...policyDefaults(actionType), ...overrides };
  return {
    actionType,
    label: actionType,
    match,
    confidence,
    highRisk: policy.riskLevel === 'high',
    fastPathEligible: false,
    riskLevel: policy.riskLevel,
    gateStrategy: policy.gateStrategy,
    allowLocalFallbackOnCloudFailure: policy.allowLocalFallbackOnCloudFailure,
    requiredEvidence: policy.requiredEvidence,
    localFallbackEvidence: policy.localFallbackEvidence,
  };
}

describe('ModeEventClassifier', () => {
  test('rejects neutral price mention while passing case and technical needs', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({
      cloudClassifier: async () => [
        { actionType: 'pricing_objection', decision: 'reject', confidence: 0.86, semanticIntent: 'neutral_pricing_reference', reasons: ['neutral_pricing_reference'] },
        { actionType: 'case_study_request', decision: 'pass', confidence: 0.91, semanticIntent: 'case_or_proof_request', reasons: ['case_request'] },
        { actionType: 'technical_requirements', decision: 'pass', confidence: 0.9, semanticIntent: 'technical_requirements', reasons: ['technical_need'] },
      ],
    });
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
      intentResult: { intent: 'discovery_probe', confidence: 0.7, answerShape: 'brief', source: 'context' },
      providerDataScopes: { transcript: true },
    });

    assert.equal(decisions.find(d => d.candidate.actionType === 'pricing_objection')?.decision, 'reject');
    assert.equal(decisions.find(d => d.candidate.actionType === 'case_study_request')?.decision, 'pass');
    assert.equal(decisions.find(d => d.candidate.actionType === 'technical_requirements')?.decision, 'pass');
  });

  test('uses cloud confirmation when local intent is unavailable for English high-risk candidates', async () => {
    const { CloudSemanticGateError, ModeEventClassifier } = await loadClassifier();
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

  test('required sales case study uses cloud before local pass', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const cloudCalls = [];
    const classifier = new ModeEventClassifier({
      cloudClassifier: async input => {
        cloudCalls.push(input);
        return [{ actionType: 'case_study_request', decision: 'pass', confidence: 0.91, reasons: ['customer asks for case'] }];
      },
    });
    const decisions = await classifier.assess({
      transcript: '有没有类似客户案例？',
      modeTemplateType: 'sales',
      candidates: [candidate('case_study_request', '案例')],
      providerDataScopes: { transcript: true },
    });
    assert.equal(cloudCalls.length, 1);
    assert.equal(decisions[0].decision, 'pass');
    assert.equal(decisions[0].semanticProvider, 'cloud_llm');
  });

  test('cloud unavailable without local fallback defers required action', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({ cloudClassifier: async () => null });
    const decisions = await classifier.assess({
      transcript: '有没有类似客户案例？',
      modeTemplateType: 'sales',
      candidates: [candidate('case_study_request', '案例')],
      providerDataScopes: { transcript: true },
    });
    assert.equal(decisions[0].decision, 'defer');
    assert.equal(decisions[0].semanticProvider, 'unavailable');
    assert.equal(decisions[0].degradedReason, 'cloud_provider_unavailable');
  });

  test('explicit pricing request can pass as local_rule when cloud is unavailable', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({ cloudClassifier: async () => null });
    const decisions = await classifier.assess({
      transcript: '这个模块多少钱？请发我报价。',
      modeTemplateType: 'sales',
      candidates: [candidate('pricing_request', '多少钱')],
      providerDataScopes: { transcript: true },
    });
    assert.equal(decisions[0].decision, 'pass');
    assert.equal(decisions[0].semanticProvider, 'local_rule');
    assert.equal(decisions[0].arbitrationStatus, 'local_fallback_cloud_unavailable');
  });

  test('local SLM intent result cannot approve required action', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({ cloudClassifier: async () => null });
    const decisions = await classifier.assess({
      transcript: '你们在跨境电商这个行业有哪些案例？',
      modeTemplateType: 'sales',
      candidates: [candidate('case_study_request', '案例')],
      intentResult: { intent: 'sales_proof_request', confidence: 0.91, answerShape: 'test', source: 'local_slm' },
      providerDataScopes: { transcript: true },
    });
    assert.equal(decisions[0].decision, 'defer');
    assert.ok(decisions[0].reasons.includes('local_zero_shot_intent_not_authoritative'));
  });

  test('only local_slm intent-result passes are marked as local model usage', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier();
    const decisions = await classifier.assess({
      transcript: '请发我报价。',
      modeTemplateType: 'sales',
      candidates: [candidate('pricing_request', '报价', 0.86, {
        riskLevel: 'medium',
        gateStrategy: 'optional',
      })],
      intentResult: { intent: 'sales_quote_request', confidence: 0.91, answerShape: '报价', source: 'local_slm' },
    });

    assert.equal(decisions[0].decision, 'pass');
    assert.equal(decisions[0].semanticProvider, 'intent_result');
    assert.equal(decisions[0].usedLocalIntentModel, true);
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
    assert.equal(decisions[0].arbitrationStatus, 'local_only_by_privacy');
  });

  test('passes explicit Chinese quote requests through local semantic gate', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier();

    for (const transcript of ['发我报价', '给客户发一版报价', '模块多少钱']) {
      const decisions = await classifier.assess({
        transcript,
        recentContextTurns: [],
        modeTemplateType: 'sales',
        speaker: 'interviewer',
        candidates: [candidate('pricing_request', transcript, 0.86)],
        activeActionTypes: [],
      });

      assert.equal(decisions[0].decision, 'pass', transcript);
      assert.equal(decisions[0].semanticProvider, 'local_rule', transcript);
      assert.equal(decisions[0].semanticIntent, 'pricing_request', transcript);
    }
  });

  test('uses cloud for explicit Chinese case requests before allowing required pass', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const cloudCalls = [];
    const classifier = new ModeEventClassifier({
      cloudClassifier: async input => {
        cloudCalls.push(input);
        return [{ actionType: 'case_study_request', decision: 'pass', confidence: 0.91, semanticIntent: 'case_or_proof_request', reasons: ['customer_asks_for_case'] }];
      },
    });

    for (const transcript of ['我们想看案例', '有类似客户吗', '给一个成功案例', '客户要证明材料']) {
      const decisions = await classifier.assess({
        transcript,
        recentContextTurns: [],
        modeTemplateType: 'sales',
        speaker: 'interviewer',
        candidates: [candidate('case_study_request', transcript, 0.87)],
        activeActionTypes: [],
        providerDataScopes: { transcript: true },
      });

      assert.equal(decisions[0].decision, 'pass', transcript);
      assert.equal(decisions[0].semanticProvider, 'cloud_llm', transcript);
    }
    assert.equal(cloudCalls.length, 4);
  });

  test('falls back to clear local English price objection when cloud arbitration is unavailable', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({
      cloudClassifier: async () => null,
    });

    const decisions = await classifier.assess({
      transcript: 'This is too expensive for our budget.',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'interviewer',
      candidates: [candidate('pricing_objection', 'too expensive', 0.9)],
      activeActionTypes: [],
      providerDataScopes: { transcript: true },
    });

    assert.equal(decisions[0].decision, 'pass');
    assert.equal(decisions[0].semanticProvider, 'local_rule');
    assert.equal(decisions[0].semanticIntent, 'pricing_objection');
    assert.equal(decisions[0].arbitrationStatus, 'local_fallback_cloud_unavailable');
    assert.ok(decisions[0].reasons.includes('cloud_provider_unavailable'));
  });

  test('preserves clear local rejection when cloud arbitration returns no usable result', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({
      cloudClassifier: async () => null,
    });

    const decisions = await classifier.assess({
      transcript: 'The pricing page is only a reference; we need customer proof and SSO integration details.',
      recentContextTurns: [
        { role: 'interviewer', speaker: 'buyer-a', text: 'Earlier we said the quote was too high.', timestamp: 1 },
        { role: 'interviewer', speaker: 'buyer-b', text: 'Now let us focus on integration proof.', timestamp: 2 },
      ],
      modeTemplateType: 'sales',
      speaker: 'buyer-b',
      candidates: [
        candidate('pricing_objection', 'pricing page'),
        candidate('pricing_request', 'pricing page'),
        candidate('case_study_request', 'customer proof'),
        candidate('technical_requirements', 'SSO integration'),
      ],
      activeActionTypes: [],
      providerDataScopes: { transcript: true },
    });

    assert.equal(decisions.find(d => d.candidate.actionType === 'pricing_objection')?.decision, 'reject');
    assert.equal(decisions.find(d => d.candidate.actionType === 'pricing_request')?.decision, 'reject');
    assert.equal(decisions.find(d => d.candidate.actionType === 'case_study_request')?.decision, 'defer');
    assert.equal(decisions.find(d => d.candidate.actionType === 'technical_requirements')?.decision, 'defer');
    assert.ok(decisions.find(d => d.candidate.actionType === 'pricing_objection')?.reasons.includes('cloud_unavailable_local_fallback'));
    assert.ok(decisions.find(d => d.candidate.actionType === 'pricing_request')?.reasons.includes('cloud_unavailable_local_fallback'));
  });

  test('degrades every high-risk candidate when transcript scope is denied', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({
      cloudClassifier: async () => {
        throw new Error('cloud should not receive transcript when scope is denied');
      },
    });

    const decisions = await classifier.assess({
      transcript: '这个技术方案怎么对接 SSO 和生产环境，顺便发我报价',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'buyer',
      candidates: [
        candidate('technical_requirements', 'SSO'),
        candidate('pricing_request', '报价'),
      ],
      activeActionTypes: [],
      providerDataScopes: { transcript: false },
    });

    assert.deepEqual(decisions.map(d => d.decision), ['defer', 'defer']);
    assert.deepEqual(decisions.map(d => d.degradedReason), ['provider_scope_denied', 'provider_scope_denied']);
    assert.ok(decisions.every(d => d.semanticProvider === 'unavailable'));
    assert.ok(decisions.every(d => d.arbitrationStatus === 'local_only_by_privacy'));
  });

  test('labels cloud success and local-only-not-needed arbitration states', async () => {
    const { ModeEventClassifier } = await loadClassifier();
    const classifier = new ModeEventClassifier({
      cloudClassifier: async () => [
        {
          actionType: 'case_study_request',
          decision: 'pass',
          confidence: 0.92,
          semanticIntent: 'case_or_proof_request',
          reasons: ['cloud_confirmed_case_request'],
        },
      ],
    });

    const localOnly = await classifier.assess({
      transcript: '我会下周五跟进',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'seller',
      candidates: [{
        actionType: 'action_item',
        label: 'action_item',
        match: '下周五跟进',
        confidence: 0.8,
        highRisk: false,
        fastPathEligible: true,
      }],
      activeActionTypes: [],
    });
    assert.equal(localOnly[0].arbitrationStatus, 'local_only_not_needed');

    const cloudUsed = await classifier.assess({
      transcript: 'not the pricing page, we need proof from a similar customer',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'buyer',
      candidates: [
        candidate('pricing_request', 'pricing page'),
        candidate('case_study_request', 'similar customer'),
      ],
      activeActionTypes: [],
      providerDataScopes: { transcript: true },
    });

    const caseDecision = cloudUsed.find(d => d.candidate.actionType === 'case_study_request');
    assert.equal(caseDecision?.decision, 'pass');
    assert.equal(caseDecision?.semanticProvider, 'cloud_llm');
    assert.equal(caseDecision?.arbitrationStatus, 'cloud_used');
    assert.equal(caseDecision?.usedLocalIntentModel, false);
  });

  test('maps cloud timeout and invalid JSON to degraded reasons while falling back locally', async () => {
    const { CloudSemanticGateError, ModeEventClassifier } = await loadClassifier();
    const timeoutClassifier = new ModeEventClassifier({
      cloudClassifier: async () => {
        throw new CloudSemanticGateError('cloud_timeout');
      },
    });

    const timeoutDecisions = await timeoutClassifier.assess({
      transcript: 'This is too expensive for our budget.',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'buyer',
      candidates: [candidate('pricing_objection', 'too expensive', 0.9)],
      activeActionTypes: [],
      providerDataScopes: { transcript: true },
    });

    assert.equal(timeoutDecisions[0].decision, 'pass');
    assert.equal(timeoutDecisions[0].arbitrationStatus, 'local_fallback_cloud_unavailable');
    assert.ok(timeoutDecisions[0].reasons.includes('cloud_timeout'));
    assert.ok(timeoutDecisions[0].reasons.includes('cloud_unavailable_local_fallback'));

    const invalidJsonClassifier = new ModeEventClassifier({
      cloudClassifier: async () => [
        { actionType: 'pricing_objection', decision: 'approve', confidence: 0.9 },
      ],
    });

    const invalidJsonDecisions = await invalidJsonClassifier.assess({
      transcript: 'The pricing page is only a reference; we need customer proof.',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'buyer',
      candidates: [
        candidate('pricing_objection', 'pricing page'),
        candidate('case_study_request', 'customer proof'),
      ],
      activeActionTypes: [],
      providerDataScopes: { transcript: true },
    });

    const invalidPricing = invalidJsonDecisions.find(d => d.candidate.actionType === 'pricing_objection');
    const invalidCase = invalidJsonDecisions.find(d => d.candidate.actionType === 'case_study_request');
    assert.equal(invalidPricing?.arbitrationStatus, 'local_fallback_cloud_unavailable');
    assert.ok(invalidPricing?.reasons.includes('cloud_invalid_json'));
    assert.equal(invalidCase?.decision, 'defer');
    assert.equal(invalidCase?.degradedReason, 'cloud_invalid_json');

    const noLocalFallbackClassifier = new ModeEventClassifier({
      cloudClassifier: async () => {
        throw new CloudSemanticGateError('cloud_invalid_json');
      },
    });

    const noLocalFallbackDecisions = await noLocalFallbackClassifier.assess({
      transcript: 'We need SOC2 controls for procurement.',
      recentContextTurns: [],
      modeTemplateType: 'sales',
      speaker: 'buyer',
      candidates: [candidate('technical_requirements', 'SOC2 controls', 0.88)],
      activeActionTypes: [],
      providerDataScopes: { transcript: true },
    });

    assert.equal(noLocalFallbackDecisions[0].decision, 'defer');
    assert.equal(noLocalFallbackDecisions[0].degradedReason, 'cloud_invalid_json');
    assert.equal(noLocalFallbackDecisions[0].arbitrationStatus, 'cloud_unavailable');
    assert.equal(noLocalFallbackDecisions[0].reasons.includes('cloud_unavailable_local_fallback'), false);
  });
});

test('selectPassedGateDecisions keeps one exclusive decision by cloud confidence, priority, then action type', async () => {
  const { selectPassedGateDecisions } = await loadClassifier();
  const decisions = [
    {
      candidate: { actionType: 'candidate_experience_probe', exclusiveGroup: 'recruiting_live_assist', selectionPriority: 80 },
      decision: 'pass', confidence: 0.96,
    },
    {
      candidate: { actionType: 'candidate_concern', exclusiveGroup: 'recruiting_live_assist', selectionPriority: 100 },
      decision: 'pass', confidence: 0.96,
    },
    {
      candidate: { actionType: 'strong_fit_signal', exclusiveGroup: 'recruiting_live_assist', selectionPriority: 60 },
      decision: 'pass', confidence: 0.99,
    },
    {
      candidate: { actionType: 'pricing_request' },
      decision: 'pass', confidence: 0.91,
    },
  ];

  const selected = selectPassedGateDecisions(decisions);
  assert.deepEqual(selected.map((item) => item.candidate.actionType), [
    'strong_fit_signal',
    'pricing_request',
  ]);

  const priorityTie = selectPassedGateDecisions(decisions.slice(0, 2));
  assert.deepEqual(priorityTie.map((item) => item.candidate.actionType), ['candidate_concern']);

  const actionTypeTie = selectPassedGateDecisions([
    { candidate: { actionType: 'candidate_alpha', exclusiveGroup: 'tie', selectionPriority: 80 }, decision: 'pass', confidence: 0.96 },
    { candidate: { actionType: 'candidate_beta', exclusiveGroup: 'tie', selectionPriority: 80 }, decision: 'pass', confidence: 0.96 },
  ]);
  assert.deepEqual(actionTypeTie.map((item) => item.candidate.actionType), ['candidate_alpha']);
});

test('partial invalid cloud JSON defers every required recruiting candidate without fallback', async () => {
  const { ModeEventClassifier } = await loadClassifier();
  const classifier = new ModeEventClassifier({
    cloudClassifier: async () => [
      { actionType: 'candidate_concern', decision: 'pass', confidence: 0.95, reasons: ['policy_question'] },
      { actionType: 'candidate_experience_probe', decision: 'approve', confidence: 0.9 },
    ],
  });

  const decisions = await classifier.assess({
    transcript: '我担心签证政策，也想补充个人贡献。',
    modeTemplateType: 'recruiting',
    candidates: [
      candidate('candidate_concern', '签证政策', 0.9, {
        riskLevel: 'high', gateStrategy: 'required', allowLocalFallbackOnCloudFailure: false,
      }),
      candidate('candidate_experience_probe', '个人贡献', 0.88, {
        riskLevel: 'high', gateStrategy: 'required', allowLocalFallbackOnCloudFailure: false,
      }),
    ],
    providerDataScopes: { transcript: true },
  });

  assert.deepEqual(decisions.map((decision) => decision.decision), ['defer', 'defer']);
  assert.deepEqual(decisions.map((decision) => decision.degradedReason), ['cloud_invalid_json', 'cloud_invalid_json']);
});

test('partial invalid cloud JSON preserves valid required sales decisions', async () => {
  const { ModeEventClassifier } = await loadClassifier();
  const classifier = new ModeEventClassifier({
    cloudClassifier: async () => [
      { actionType: 'case_study_request', decision: 'pass', confidence: 0.95, reasons: ['customer_proof'] },
      { actionType: 'pricing_request', decision: 'approve', confidence: 0.9 },
    ],
  });

  const decisions = await classifier.assess({
    transcript: '我们想看一个类似客户案例。',
    modeTemplateType: 'sales',
    candidates: [candidate('case_study_request', '类似客户案例')],
    providerDataScopes: { transcript: true },
  });

  assert.equal(decisions[0].decision, 'pass');
  assert.equal(decisions[0].semanticProvider, 'cloud_llm');
});
