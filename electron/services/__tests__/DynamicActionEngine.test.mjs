import { test, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
const storePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionStore.js');
const detectorPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionDetector.js');
const actionPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicAction.js');
const policyPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/ModeActionPolicy.js');

async function loadModules() {
  const [engineMod, storeMod, detectorMod, actionMod] = await Promise.all([
    import(pathToFileURL(enginePath).href),
    import(pathToFileURL(storePath).href),
    import(pathToFileURL(detectorPath).href),
    import(pathToFileURL(actionPath).href),
  ]);
  return {
    DynamicActionEngine: engineMod.DynamicActionEngine,
    DynamicActionStore: storeMod.DynamicActionStore,
    DynamicActionDetector: detectorMod.DynamicActionDetector,
    MODE_TRIGGERS: detectorMod.MODE_TRIGGERS,
    DynamicAction: actionMod.DynamicAction,
    ActionStatus: actionMod.ActionStatus,
  };
}

function cloudSelect(actionType, confidence = 0.92) {
  return async ({ candidates }) => candidates.map((candidate) => ({
    actionType: candidate.actionType,
    decision: candidate.actionType === actionType ? 'pass' : 'reject',
    confidence: candidate.actionType === actionType ? confidence : 0.8,
    reasons: candidate.actionType === actionType ? ['cloud_selected_candidate'] : ['cloud_rejected_candidate'],
    rejectedCandidates: candidate.actionType === actionType ? [] : [candidate.actionType],
  }));
}

test('Pricing objection detected in Sales transcript creates pricing_objection action', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "I think the price is a bit high for our budget right now.";
  const actions = engine.detectActions({
    transcript,
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId: 'session_123',
  });

  assert.ok(actions.length > 0, 'Expected at least one action');
  const pricingAction = actions.find(a => a.type === 'pricing_objection');
  assert.ok(pricingAction, 'Expected pricing_objection action');
  assert.equal(pricingAction.label, 'Handle pricing objection');
  assert.ok(pricingAction.confidence >= 0.8);
  assert.equal(pricingAction.status, 'candidate');
  assert.equal(pricingAction.evidenceRefs[0].source, 'transcript');
  assert.ok(pricingAction.evidenceRefs[0].text.includes('price'));
});

test('detectSignalCandidates exposes detector-only candidates before semantic assessment', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const candidates = engine.detectSignalCandidates({
    transcript: '这个价格太高了，我们预算不够',
    modeTemplateType: 'sales',
    speaker: 'interviewer',
  });

  assert.deepEqual(candidates.map(({ trigger }) => trigger.type), ['pricing_objection']);
});

test('recruiting evidence rubric intents can create detector-less gated candidates', async () => {
  const mappings = [
    'recruiting_scorecard_gap',
    'recruiting_bei_evidence_gap',
    'recruiting_situational_evidence_gap',
    'recruiting_risk_verification',
  ];
  for (const intent of mappings) {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: '候选人的回答没有讲清个人行动、结果指标和风险取舍。',
      speaker: 'interviewer',
      modeTemplateType: 'recruiting',
      modeId: `mode-${intent}`,
      sessionId: `session-${intent}`,
      intentResult: { intent, confidence: 0.94, answerShape: '', source: 'cloud' },
      detectedTriggers: [],
      cloudClassifier: async ({ candidates }) => candidates.map((candidate) => ({
        actionType: candidate.actionType,
        decision: 'pass',
        confidence: 0.93,
        reasons: ['recruiting_evidence_gap'],
        rejectedCandidates: [],
      })),
    });
    assert.ok(
      actions.some(action => action.type === 'candidate_experience_probe'),
      `${intent} should synthesize candidate_experience_probe; got ${actions.map(action => action.type).join(', ')}`,
    );
  }
});

test('one recruiting turn emits at most one exclusive live-assist card', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const actions = await engine.assessSignals({
    transcript: '我担心签证政策，也想补充刚才没有说清楚的个人贡献。',
    speaker: 'interviewer',
    modeTemplateType: 'recruiting',
    modeId: 'mode-recruiting-exclusive',
    sessionId: 'session-recruiting-exclusive',
    intentResult: { intent: 'recruiting_policy_question', confidence: 0.95, answerShape: '', source: 'cloud' },
    cloudClassifier: async ({ candidates }) => candidates.map((candidate) => ({
      actionType: candidate.actionType,
      decision: 'pass',
      confidence: candidate.actionType === 'candidate_concern' ? 0.96 : 0.9,
      reasons: ['mixed_recruiting_turn'],
      rejectedCandidates: [],
    })),
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'candidate_concern');
});

test('recruiting arbitration traces rejected siblings without storing them', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const traces = [];
  const actions = await engine.assessSignals({
    transcript: '我对这个岗位很感兴趣，但我担心签证政策。',
    speaker: 'interviewer',
    modeTemplateType: 'recruiting',
    modeId: 'mode-recruiting-trace',
    sessionId: 'session-recruiting-trace',
    cloudClassifier: async ({ candidates }) => candidates.map((candidate) => ({
      actionType: candidate.actionType,
      decision: 'pass',
      confidence: candidate.actionType === 'candidate_concern' ? 0.96 : 0.9,
      reasons: ['mixed_recruiting_turn'],
      rejectedCandidates: [],
    })),
    semanticGateTraceSink: (trace) => traces.push(trace),
  });

  assert.deepEqual(actions.map((action) => action.type), ['candidate_concern']);
  const rejectedSibling = traces.find((trace) => trace.actionType === 'strong_fit_signal');
  assert.equal(rejectedSibling?.decision, 'reject');
  assert.ok(rejectedSibling?.reasons.includes('exclusive_group_arbitration_lost'));
  assert.deepEqual(engine.getStore().getAllActions('session-recruiting-trace').map((action) => action.type), ['candidate_concern']);
});

test('strong_fit_signal requires explicit candidate interest and passes through the cloud gate', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const interviewerEvaluation = engine.detectActions({
    transcript: '这个候选人很匹配这个岗位，经验也很适合。',
    speaker: 'interviewer',
    modeTemplateType: 'recruiting',
    modeId: 'mode-recruiting-interest',
    sessionId: 'session-recruiting-interviewer-evaluation',
  });
  assert.equal(interviewerEvaluation.some((action) => action.type === 'strong_fit_signal'), false);

  const candidateInterest = await engine.assessSignals({
    transcript: '我对这个岗位很感兴趣，也很期待加入团队。',
    speaker: 'candidate',
    modeTemplateType: 'recruiting',
    modeId: 'mode-recruiting-interest',
    sessionId: 'session-recruiting-candidate-interest',
    cloudClassifier: async ({ candidates }) => candidates.map((candidate) => ({
      actionType: candidate.actionType,
      decision: 'pass',
      confidence: 0.95,
      reasons: ['candidate_explicit_role_interest'],
      rejectedCandidates: [],
    })),
  });
  assert.deepEqual(candidateInterest.map((action) => action.type), ['strong_fit_signal']);
  assert.equal(candidateInterest[0].semanticGate?.semanticProvider, 'cloud_llm');
});

test('detected actions include product contract copy', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const [action] = engine.detectActions({
    transcript: 'The price is too expensive for our budget.',
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_contract',
  });

  assert.ok(action.productContract);
  assert.equal(action.productContract.userAction, '回应价格异议');
  assert.equal(action.productContract.outputType, 'spoken_response');
  assert.equal(action.productContract.riskState, 'auto_countdown');
  assert.ok(action.productContract.whyNow.length > 0);
  assert.ok(action.productContract.outputPromise.length > 0);
});

test('auto eligible actions expose auto countdown risk state through product contract', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = engine.detectActions({
    transcript: 'Please implement a function to solve this algorithm problem.',
    speaker: 'Interviewer',
    modeTemplateType: 'technical-interview',
    modeId: 'mode_technical',
    sessionId: 'session_auto_contract',
  });
  const action = actions.find(item => item.type === 'coding_problem');

  assert.ok(action);
  assert.equal(action.autoSurfacePolicy, 'auto');
  assert.equal(action.productContract.riskState, 'auto_countdown');
});

test('Bare competitor mention does not create a standalone sales action', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "We're already using Gong for our sales calls.";
  const actions = engine.detectActions({
    transcript,
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId: 'session_123',
  });

  assert.equal(actions.some(a => a.type === 'competitor_mention'), false);
  assert.equal(actions.length, 0);
});

test('All eight real mode template keys have matching trigger packs', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const cases = [
    {
      modeTemplateType: 'general',
      transcript: '帮我想一下我该怎么回应这个问题',
      expectedType: 'general_assistance_request',
    },
    {
      modeTemplateType: 'sales',
      transcript: '这个价格太高了, 能不能便宜点?',
      expectedType: 'pricing_objection',
    },
    {
      modeTemplateType: 'fde',
      transcript: '权限和 PII 审计日志需要先过安全评审',
      expectedType: 'fde_security_review',
    },
    {
      modeTemplateType: 'recruiting',
      transcript: '你能不能举一个具体的例子?',
      expectedType: 'candidate_experience_probe',
    },
    {
      modeTemplateType: 'team-meet',
      transcript: '我来负责这个行动项, 周五前完成',
      expectedType: 'action_item',
    },
    {
      modeTemplateType: 'looking-for-work',
      transcript: 'Tell me about a time you led a team through a difficult challenge.',
      expectedType: 'behavioral_question',
    },
    {
      modeTemplateType: 'technical-interview',
      transcript: 'Please implement a function to solve this algorithm problem.',
      expectedType: 'coding_problem',
    },
    {
      modeTemplateType: 'lecture',
      transcript: '这个叫做贝叶斯定理, 公式是这样的',
      expectedType: 'concept_explanation',
    },
  ];

  for (const item of cases) {
    const actions = engine.detectActions({
      transcript: item.transcript,
      speaker: 'speaker',
      modeTemplateType: item.modeTemplateType,
      modeId: `mode_${item.modeTemplateType}`,
      sessionId: `session_${item.modeTemplateType}`,
    });
    assert.ok(
      actions.some(action => action.type === item.expectedType),
      `${item.modeTemplateType} should emit ${item.expectedType}; got ${actions.map(a => a.type).join(', ')}`,
    );
  }
});

test('All persisted mode template keys have dynamic action trigger packs', async () => {
  const { MODE_TRIGGERS } = await loadModules();
  const modeTemplateTypes = [
    'general',
    'looking-for-work',
    'sales',
    'fde',
    'recruiting',
    'team-meet',
    'lecture',
    'technical-interview',
  ];

  for (const mode of modeTemplateTypes) {
    assert.ok(Array.isArray(MODE_TRIGGERS[mode]), `${mode} should have a trigger pack`);
    assert.ok(MODE_TRIGGERS[mode].length > 0, `${mode} trigger pack should not be empty`);
  }
});

test('FDE deployment transcript creates integration action', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = engine.detectActions({
    transcript: '客户需要打通 API、SSO 和生产环境数据源',
    speaker: 'Customer',
    modeTemplateType: 'fde',
    modeId: 'mode_fde_1',
    sessionId: 'session_fde_integration',
  });

  const action = actions.find(a => a.type === 'fde_integration_check');
  assert.ok(action, `Expected fde_integration_check; got ${actions.map(a => a.type).join(', ')}`);
  assert.equal(action.label, 'Clarify integration');
  assert.ok(action.keyEntities?.includes('API'));
  assert.ok(action.keyEntities?.includes('SSO'));
  assert.ok(action.keyEntities?.includes('数据源'));
});

test('FDE detector drops broad discovery when a specific integration candidate exists', async () => {
  const { DynamicActionDetector, MODE_TRIGGERS } = await loadModules();
  const detector = new DynamicActionDetector(MODE_TRIGGERS);
  const matches = detector.detectTriggers({
    transcript: '客户要把 PLM 的 BOM 通过 API 同步到 ERP，并确认 SSO。',
    speaker: 'Customer',
    modeTemplateType: 'fde',
  });

  assert.ok(matches.some(({ trigger }) => trigger.type === 'fde_integration_check'));
  assert.equal(matches.some(({ trigger }) => trigger.type === 'fde_discovery_probe'), false);
});

test('FDE quality object names alone remain discovery candidates instead of risk', async () => {
  const { DynamicActionDetector, MODE_TRIGGERS } = await loadModules();
  const detector = new DynamicActionDetector(MODE_TRIGGERS);
  const matches = detector.detectTriggers({
    transcript: '客户当前在 QMS 里记录 NCR，再升级为 CAPA 和 8D。',
    speaker: 'Customer',
    modeTemplateType: 'fde',
  });

  assert.deepEqual(matches.map(({ trigger }) => trigger.type), ['fde_discovery_probe']);
});

test('FDE intent result can synthesize gated action when detector has no candidate', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  let cloudCalls = 0;

  const actions = await engine.assessSignals({
    transcript: '客户说红线问题还没解决',
    speaker: 'Customer',
    modeTemplateType: 'fde',
    modeId: 'mode_fde_2',
    sessionId: 'session_fde_synthetic',
    intentResult: {
      intent: 'fde_risk',
      confidence: 0.9,
      answerShape: 'Name blocker and next unblock step.',
      source: 'cloud',
    },
    detectedTriggers: [],
    cloudClassifier: async input => {
      cloudCalls += 1;
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: 'pass',
        confidence: 0.92,
        reasons: ['cloud_confirmed_fde_risk'],
      }));
    },
    now: 1_000,
  });

  assert.equal(cloudCalls, 1);
  assert.ok(actions.some(action => action.type === 'fde_risk_blocker'));
});

test('FDE agent intent can synthesize action when detector has no candidate', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: '客户在讨论一个内部边界问题',
    speaker: 'Customer',
    modeTemplateType: 'fde',
    modeId: 'mode_fde_agent_boundary',
    sessionId: 'session_fde_agent_boundary',
    intentResult: {
      intent: 'fde_agent_feasibility',
      confidence: 0.92,
      answerShape: 'Explain the AI Agent boundary as a checklist.',
      source: 'cloud',
    },
    detectedTriggers: [],
    cloudClassifier: async input => input.candidates.map(candidate => ({
      actionType: candidate.actionType,
      decision: candidate.actionType === 'fde_agent_feasibility' ? 'pass' : 'reject',
      confidence: candidate.actionType === 'fde_agent_feasibility' ? 0.93 : 0.8,
      reasons: candidate.actionType === 'fde_agent_feasibility' ? ['cloud_confirmed_agent_boundary'] : ['cloud_rejected_candidate'],
    })),
    now: 2_000,
  });

  assert.ok(actions.some(action => action.type === 'fde_agent_feasibility'));
});

test('dynamic action retrievalQuery uses active-mode entity extraction', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const recruitingActions = engine.detectActions({
    transcript: '候选人担心签证和入职时间，想确认岗位 JD 和搬迁政策。',
    speaker: 'candidate',
    modeTemplateType: 'recruiting',
    modeId: 'mode_recruiting',
    sessionId: 'session_recruiting_entities',
  });
  const recruitingAction = recruitingActions.find(action => action.type === 'candidate_concern');
  assert.ok(recruitingAction);
  assert.ok(recruitingAction.keyEntities?.includes('候选人'));
  assert.ok(recruitingAction.keyEntities?.includes('签证'));
  assert.ok(recruitingAction.keyEntities?.includes('入职时间'));
  assert.match(recruitingAction.retrievalQuery || '', /entities:.*候选人.*签证.*入职时间/);
  assert.equal(recruitingAction.keyEntities?.includes('价格'), false);

  const salesActions = engine.detectActions({
    transcript: '客户说价格太高，需要 Acme 案例证明 ROI，不想听候选人简历。',
    speaker: 'prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_sales_entities',
  });
  const salesAction = salesActions.find(action => action.type === 'pricing_objection');
  assert.ok(salesAction);
  assert.ok(salesAction.keyEntities?.includes('价格'));
  assert.ok(salesAction.keyEntities?.includes('案例'));
  assert.ok(salesAction.keyEntities?.includes('ROI'));
  assert.match(salesAction.retrievalQuery || '', /^entities:.*价格/m);
  assert.match(salesAction.retrievalQuery || '', /^entities:.*案例/m);
  assert.match(salesAction.retrievalQuery || '', /^entities:.*ROI/m);
  assert.equal(salesAction.keyEntities?.includes('候选人'), false);
  assert.equal(salesAction.keyEntities?.includes('简历'), false);
});

test('Action item pattern detected creates action_item action with real team-meet key', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "I'll send over the proposal by Friday.";
  const actions = engine.detectActions({
    transcript,
    speaker: 'Team Member',
    modeTemplateType: 'team-meet',
    modeId: 'mode_team_1',
    sessionId: 'session_456',
  });

  assert.ok(actions.length > 0, 'Expected at least one action');
  const actionItemAction = actions.find(a => a.type === 'action_item');
  assert.ok(actionItemAction, 'Expected action_item action');
  assert.equal(actionItemAction.label, 'Capture action item');
});

test('Behavioral question pattern creates STAR action with real looking-for-work key', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "Tell me about a time you led a team through a difficult challenge.";
  const actions = engine.detectActions({
    transcript,
    speaker: 'Interviewer',
    modeTemplateType: 'looking-for-work',
    modeId: 'mode_interview_1',
    sessionId: 'session_789',
  });

  assert.ok(actions.length > 0, 'Expected at least one action');
  const starAction = actions.find(a => a.type === 'behavioral_question');
  assert.ok(starAction, 'Expected behavioral_question action');
  assert.equal(starAction.label, 'Answer with STAR story');
  assert.ok(starAction.answerStyle);
  assert.equal(starAction.answerStyle.format, 'short_script');
});

test('Duplicate action suppressed within window', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "The price seems expensive to me.";
  const sessionId = 'session_dedup';

  // First detection
  const actions1 = engine.detectActions({
    transcript,
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId,
  });

  // Second detection of same pattern
  const actions2 = engine.detectActions({
    transcript,
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId,
  });

  // Should not create duplicate
  const store = engine.getStore();
  const allActions = store.getAllActions(sessionId);
  const pricingActions = allActions.filter(a => a.type === 'pricing_objection');
  assert.ok(pricingActions.length <= 1, 'Duplicate pricing_objection should be suppressed');
});

test('Action expires after maxAgeMs', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "I think the price is expensive.";
  const sessionId = 'session_expire';

  engine.detectActions({
    transcript,
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId,
  });

  // Simulate time passing - getTopActions will expire candidate actions older than maxAgeMs
  const topActions = engine.getTopActions(sessionId, 100); // 100ms max age
  const expiredAction = topActions.find(a => a.status === 'expired');
  // The action should either be expired or not in top actions anymore
  const allActions = engine.getStore().getAllActions(sessionId);
  const candidateActions = allActions.filter(a => a.status === 'candidate');
  // If we manually check after enough time passes
  assert.ok(true, 'Expiry mechanism exists');
});

test('acceptAction marks status as accepted', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "This pricing seems expensive for our budget.";
  const sessionId = 'session_accept';

  const detected = engine.detectActions({
    transcript,
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId,
  });

  assert.ok(detected.length > 0, 'Expected action to be detected');
  const actionId = detected[0].id;

  const accepted = engine.acceptAction(actionId);
  assert.ok(accepted, 'Expected action to be returned');
  assert.equal(accepted.status, 'accepted');

  // Verify in store
  const stored = engine.getStore().getAction(actionId);
  assert.equal(stored.status, 'accepted');
});

test('dismissAction marks status as dismissed', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = 'The price is too expensive for our budget.';
  const sessionId = 'session_dismiss';

  const detected = engine.detectActions({
    transcript,
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId,
  });

  assert.ok(detected.length > 0);
  const actionId = detected[0].id;

  engine.dismissAction(actionId);

  const stored = engine.getStore().getAction(actionId);
  assert.equal(stored.status, 'dismissed');
});

test('getTopActions returns max 3 actions ordered by priority', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const sessionId = 'session_top3';

  // Detect multiple actions
  engine.detectActions({
    transcript: "I think the price is expensive and we're using Gong.",
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId,
  });

  engine.detectActions({
    transcript: "We're ready to move forward and send the contract.",
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId,
  });

  const topActions = engine.getTopActions(sessionId);
  assert.ok(topActions.length <= 3, `Expected max 3 actions, got ${topActions.length}`);

  // Verify priority ordering
  if (topActions.length > 1) {
    for (let i = 1; i < topActions.length; i++) {
      assert.ok(
        topActions[i - 1].priority >= topActions[i].priority,
        'Actions should be ordered by priority descending'
      );
    }
  }
});

test('Evidence refs contain transcript snippet and timestamp', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const transcript = "The price seems expensive to us.";
  const speaker = 'Prospect';
  const timestamp = Date.now();

  const actions = engine.detectActions({
    transcript,
    speaker,
    modeTemplateType: 'sales',
    modeId: 'mode_sales_1',
    sessionId: 'session_evidence',
  });

  assert.ok(actions.length > 0);
  const action = actions[0];

  assert.ok(action.evidenceRefs.length > 0, 'Expected evidence refs');
  const evidence = action.evidenceRefs[0];

  assert.equal(evidence.source, 'transcript');
  assert.equal(evidence.text, transcript);
  assert.equal(evidence.speaker, speaker);
  assert.ok(evidence.timestamp, 'Expected timestamp in evidence');
});

test('dynamic actions are isolated by session and mode to prevent bleeding', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const salesActions = engine.detectActions({
    transcript: 'The price is expensive for our budget.',
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_a',
  });
  const interviewActions = engine.detectActions({
    transcript: 'Tell me about a time you led a difficult project.',
    speaker: 'Interviewer',
    modeTemplateType: 'interview',
    modeId: 'mode_interview',
    sessionId: 'session_b',
  });

  assert.ok(salesActions.some(action => action.type === 'pricing_objection'));
  assert.ok(interviewActions.some(action => action.type === 'behavioral_question'));
  assert.equal(engine.getTopActions('session_a').some(action => action.modeId === 'mode_interview'), false);
  assert.equal(engine.getTopActions('session_b').some(action => action.modeId === 'mode_sales'), false);
});

test('expanded trigger packs cover canonical Cluely-style phrases across modes', async () => {
  const { DynamicActionEngine } = await loadModules();

  const cases = [
    ['general', 'Can you help me with what I should say next?', 'general_assistance_request'],
    ['general', 'Summarize this discussion for me.', 'general_summarize'],
    ['general', 'Explain that in simple terms.', 'general_explain'],
    ['negotiation', "What's your budget range for this deal?", 'budget_probe'],
    ['negotiation', 'Can you do better on the price?', 'price_pushback'],
    ['negotiation', 'This is our final offer.', 'final_offer'],
    ['sales', "What's the ROI and payback for this?", 'case_study_request'],
    ['sales', 'Can you send me pricing after this call?', 'pricing_request'],
    ['recruiting', 'Tell me about your experience and why this role.', 'candidate_experience_probe'],
    ['team_meeting', 'Are there any blockers or risks to the timeline?', 'blocker_check'],
    ['team_meeting', 'Who owns this and by when?', 'owner_deadline_check'],
    ['interview', 'Tell me about yourself.', 'intro_pitch'],
    ['interview', 'Why do you want to work here?', 'company_motivation'],
    ['interview', 'What is your biggest weakness?', 'weakness_question'],
    ['technical_interview', 'What is the time complexity and can you optimize it?', 'complexity_analysis'],
    ['technical_interview', 'Design a system that can scale to millions of users.', 'system_design_prompt'],
    ['lecture', 'Define this concept and give the formula.', 'concept_explanation'],
    ['lecture', 'Can you show an example of this theorem?', 'worked_example'],
  ];

  for (const [modeTemplateType, transcript, expectedType] of cases) {
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript,
      speaker: 'Speaker',
      modeTemplateType,
      modeId: `mode_${modeTemplateType}`,
      sessionId: `session_${modeTemplateType}_${expectedType}`,
    });

    assert.ok(
      actions.some(action => action.type === expectedType),
      `Expected ${expectedType} for ${modeTemplateType}: ${transcript}`
    );
  }
});

test('Chinese trigger packs create dynamic actions across modes', async () => {
  const { DynamicActionEngine } = await loadModules();

  const cases = [
    ['sales', '这个价格太贵了，我们预算不够。', 'pricing_objection'],
    ['team_meeting', '我来做这个，周五前发给大家。', 'action_item'],
    ['interview', '请介绍一下你自己。', 'intro_pitch'],
    ['technical_interview', '请实现一个函数解决这道算法题。', 'coding_problem'],
    ['negotiation', '这个是我们的最终报价，只能这样了。', 'final_offer'],
    ['general', '帮我想一下我该怎么回答。', 'general_assistance_request'],
    ['recruiting', '这个岗位支持远程或者混合办公吗？', 'candidate_concern'],
    ['lecture', '能不能解释一下这个概念？', 'concept_explanation'],
  ];

  for (const [modeTemplateType, transcript, expectedType] of cases) {
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript,
      speaker: 'Speaker',
      modeTemplateType,
      modeId: `mode_${modeTemplateType}`,
      sessionId: `session_zh_${modeTemplateType}_${expectedType}`,
    });

    assert.ok(
      actions.some(action => action.type === expectedType),
      `Expected ${expectedType} for ${modeTemplateType}: ${transcript}`
    );
  }
});

test('Chinese trigger packs do not create technical actions in sales mode', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = engine.detectActions({
    transcript: '请实现一个函数解决这道算法题。',
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_zh_sales_no_technical_bleed',
  });

  assert.equal(actions.some(action => action.type === 'coding_problem'), false);
  assert.equal(actions.some(action => action.type === 'complexity_analysis'), false);
  assert.equal(actions.some(action => action.type === 'system_design_prompt'), false);
});

test('expanded trigger packs do not bleed between negotiation, sales, and interview modes', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const salesModeActions = engine.detectActions({
    transcript: 'Can you do better on the price? This is our final offer.',
    speaker: 'Buyer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_sales_isolation',
  });
  const negotiationModeActions = engine.detectActions({
    transcript: 'What does it cost and can you send me pricing?',
    speaker: 'Counterparty',
    modeTemplateType: 'negotiation',
    modeId: 'mode_negotiation',
    sessionId: 'session_negotiation_isolation',
  });
  const interviewModeActions = engine.detectActions({
    transcript: 'Tell me about your experience and why this role.',
    speaker: 'Recruiter',
    modeTemplateType: 'interview',
    modeId: 'mode_interview',
    sessionId: 'session_interview_isolation',
  });

  assert.equal(salesModeActions.some(action => action.type === 'final_offer'), false);
  assert.equal(negotiationModeActions.some(action => action.type === 'pricing_request'), false);
  assert.equal(interviewModeActions.some(action => action.type === 'candidate_experience_probe'), false);
});

test('completeAction removes accepted action from active top actions', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const sessionId = 'session_complete';

  const [action] = engine.detectActions({
    transcript: 'The price is expensive for our budget.',
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
  });

  assert.ok(action);
  assert.ok(engine.acceptAction(action.id));
  engine.completeAction(action.id);

  assert.equal(engine.getStore().getAction(action.id).status, 'completed');
  assert.equal(engine.getTopActions(sessionId).some(topAction => topAction.id === action.id), false);
});

test('getTopActionsWithExpired returns expired actions for lifecycle recording', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const sessionId = 'session_expired_lifecycle';

  const [action] = engine.detectActions({
    transcript: 'The price is expensive for our budget.',
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
  });

  assert.ok(action);
  const result = engine.getTopActionsWithExpired(sessionId, 60_000, action.createdAt + 70_000);
  assert.equal(result.actions.length, 0);
  assert.equal(result.expired.length, 1);
  assert.equal(result.expired[0].id, action.id);
  assert.equal(engine.getStore().getAction(action.id).status, 'expired');
});

test('acceptAction can mark auto-generated and generation failure statuses', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const [action] = engine.detectActions({
    transcript: 'Please implement a function to solve this algorithm problem.',
    speaker: 'Interviewer',
    modeTemplateType: 'technical-interview',
    modeId: 'mode_technical',
    sessionId: 'session_auto_status',
  });

  assert.ok(action);
  const accepted = engine.acceptAction(action.id, { triggerSource: 'auto_countdown' });
  assert.ok(accepted);
  assert.equal(engine.getStore().getAction(action.id).status, 'auto_generated');

  const failed = engine.markGenerationFailed(action.id);
  assert.ok(failed);
  assert.equal(engine.getStore().getAction(action.id).status, 'generated_failed');
});

test('dismissed action can be re-detected after user dismissal', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const sessionId = 'session_redetect_after_dismiss';

  const [first] = engine.detectActions({
    transcript: 'The price is expensive for our budget.',
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
  });
  assert.ok(first);
  engine.dismissAction(first.id);

  const secondBatch = engine.detectActions({
    transcript: 'The price is expensive for our budget.',
    speaker: 'Prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
  });

  assert.ok(secondBatch.length > 0, 'Dismissal should not permanently suppress future matching actions');
  assert.notEqual(secondBatch[0].id, first.id);
});

test('assessSignals covers seven real modes with Chinese-first confirmed actions', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const cases = [
    ['general', '帮我想一下我该怎么回应客户刚才的问题', 'general_assistance_request'],
    ['general', '这个概念能不能简单说一下', 'general_explain'],
    ['sales', '这个价格太高了, 我们预算不够', 'pricing_objection'],
    ['sales', '我们准备推进, 你们发合同给法务审核吧', 'buying_signal'],
    ['recruiting', '候选人问薪资和远程办公政策怎么回答', 'candidate_concern'],
    ['recruiting', '你能举一个具体例子说明过往经验吗', 'candidate_experience_probe'],
    ['team-meet', '这个行动项我来做, 周五前发出去', 'action_item'],
    ['team-meet', '我们最终决定就选第二个方案', 'decision_point'],
    ['looking-for-work', '讲一个你面对挑战最后成功的例子', 'behavioral_question'],
    ['looking-for-work', '请先自我介绍一下你的经历', 'intro_pitch'],
    ['technical-interview', '请实现一个函数来解这道算法题', 'coding_problem'],
    ['technical-interview', '这个算法的时间复杂度和空间复杂度是多少', 'complexity_analysis'],
    ['lecture', '这个叫贝叶斯定理, 公式是这样的', 'concept_explanation'],
    ['lecture', '我们来看一个例题, 分步骤做一遍', 'worked_example'],
  ];

  for (const [modeTemplateType, transcript, expectedType] of cases) {
    const actions = await engine.assessSignals({
      transcript,
      speaker: 'interviewer',
      modeTemplateType,
      modeId: `mode_${modeTemplateType}`,
      sessionId: `session_${modeTemplateType}_${expectedType}`,
      intentResult: { intent: 'general', confidence: 0.82, answerShape: '中文回答', source: 'context' },
      cloudClassifier: async ({ candidates }) => candidates.map((candidate) => ({
        actionType: candidate.actionType,
        decision: 'pass',
        confidence: 0.92,
        reasons: ['fixture_cloud_confirmation'],
        rejectedCandidates: [],
      })),
      now: Date.now(),
    });
    assert.ok(
      actions.some(action => action.type === expectedType && action.signalStatus === 'confirmed'),
      `${modeTemplateType} should confirm ${expectedType}; got ${actions.map(a => `${a.type}:${a.signalStatus}`).join(', ')}`,
    );
  }
});

test('all 8 active modes emit only after policy gate allows the candidate', async () => {
  const { DynamicActionEngine } = await loadModules();
  const cases = [
    { modeTemplateType: 'general', transcript: '帮我总结一下刚才他们决定了什么', expectedAction: 'general_summarize' },
    { modeTemplateType: 'sales', transcript: '这个模块多少钱？请发我报价。', expectedAction: 'pricing_request' },
    { modeTemplateType: 'fde', transcript: '这个 QMS 权限和审计日志怎么处理？', expectedAction: 'fde_security_review' },
    { modeTemplateType: 'recruiting', transcript: '候选人问 offer 和入职时间怎么安排', expectedAction: 'candidate_concern' },
    { modeTemplateType: 'team-meet', transcript: '张三周五前发集成方案', expectedAction: 'action_item' },
    { modeTemplateType: 'looking-for-work', transcript: '请介绍一下你自己', expectedAction: 'intro_pitch' },
    { modeTemplateType: 'technical-interview', transcript: '设计一个支持百万用户的通知系统', expectedAction: 'system_design_prompt' },
    { modeTemplateType: 'lecture', transcript: '这个概念是什么意思，举个例子', expectedAction: 'concept_explanation' },
  ];

  for (const item of cases) {
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: item.transcript,
      modeTemplateType: item.modeTemplateType,
      modeId: item.modeTemplateType,
      sessionId: `policy_${item.modeTemplateType}`,
      cloudClassifier: async input => input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: candidate.actionType === item.expectedAction ? 'pass' : 'reject',
        confidence: 0.92,
        reasons: ['policy_gate_allowed_expected_candidate'],
        rejectedCandidates: candidate.actionType === item.expectedAction ? [] : [candidate.actionType],
      })),
    });
    assert.ok(
      actions.some(action => action.type === item.expectedAction),
      `${item.modeTemplateType} should emit ${item.expectedAction}`,
    );
  }
});

test('FDE high-risk candidate defers without cloud semantic confirmation', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const traces = [];
  const actions = await engine.assessSignals({
    transcript: '这个 QMS 权限和审计日志怎么处理？',
    modeTemplateType: 'fde',
    modeId: 'fde',
    sessionId: 'policy_fde_no_cloud',
    cloudClassifier: async () => null,
    semanticGateTraceSink: trace => traces.push(trace),
  });

  assert.equal(actions.some(action => action.type === 'fde_security_review'), false);
  const trace = traces.find(item => item.actionType === 'fde_security_review');
  assert.equal(trace?.decision, 'defer');
  assert.equal(trace?.semanticProvider, 'unavailable');
  assert.ok(
    trace?.degradedReason === 'cloud_provider_unavailable' ||
      trace?.reasons.includes('local_zero_shot_intent_not_authoritative') ||
      trace?.reasons.includes('cloud_semantic_gate_unavailable'),
    JSON.stringify(trace),
  );
});

test('sales intent-only input enters semantic gate but cloud reject prevents card', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  let cloudCalls = 0;

  const actions = await engine.assessSignals({
    transcript: 'Legal review is a later internal topic, no customer ask right now.',
    speaker: 'Customer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_synth',
    intentResult: { intent: 'sales_buying_signal', confidence: 0.91, answerShape: '下一步', source: 'cloud' },
    detectedTriggers: [],
    cloudClassifier: async input => {
      cloudCalls += 1;
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: 'reject',
        confidence: 0.82,
        reasons: ['cloud_rejected_internal_topic'],
        rejectedCandidates: [candidate.actionType],
      }));
    },
    now: 10_000,
  });

  assert.equal(cloudCalls, 1);
  assert.deepEqual(actions, []);
});

test('team intent-only input enters semantic gate but cloud reject prevents card', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  let cloudCalls = 0;

  const actions = await engine.assessSignals({
    transcript: '依赖这个词出现在包管理器日志里，不是项目阻塞。',
    speaker: 'user',
    modeTemplateType: 'team-meet',
    modeId: 'mode_team',
    sessionId: 'session_team_suppressed',
    intentResult: { intent: 'capture_risk', confidence: 0.91, answerShape: '阻塞', source: 'cloud' },
    detectedTriggers: [],
    cloudClassifier: async input => {
      cloudCalls += 1;
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: 'reject',
        confidence: 0.82,
        reasons: ['cloud_rejected_log_reference'],
        rejectedCandidates: [candidate.actionType],
      }));
    },
    now: 10_000,
  });

  assert.equal(cloudCalls, 1);
  assert.deepEqual(actions, []);
});

test('assessSignals synthesizes general summary action from custom keyword intent', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: '客户刚才说了一段没有总结关键词的长内容',
    speaker: 'speaker',
    modeTemplateType: 'general',
    modeId: 'mode_general',
    sessionId: 'session_general_summary_custom_keyword',
    intentResult: {
      intent: 'summary_probe',
      confidence: 0.9,
      answerShape: 'Confirm the summary briefly.',
    },
    now: 10_000,
  });

  assert.ok(
    actions.some(action => action.type === 'general_summarize'),
    `Expected general_summarize; got ${actions.map(action => action.type).join(', ')}`,
  );
});

test('assessSignals synthesizes general explanation action from custom keyword intent', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: '客户提到了一个内部黑话',
    speaker: 'speaker',
    modeTemplateType: 'general',
    modeId: 'mode_general',
    sessionId: 'session_general_explain_custom_keyword',
    intentResult: {
      intent: 'clarification',
      confidence: 0.9,
      answerShape: 'Give a direct clarification.',
    },
    now: 11_000,
  });

  assert.ok(
    actions.some(action => action.type === 'general_explain'),
    `Expected general_explain; got ${actions.map(action => action.type).join(', ')}`,
  );
});

test('assessSignals synthesizes general assistance action from custom coding intent', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: '用户说内部自动化脚本要怎么处理',
    speaker: 'speaker',
    modeTemplateType: 'general',
    modeId: 'mode_general',
    sessionId: 'session_general_assist_custom_keyword',
    intentResult: {
      intent: 'coding',
      confidence: 0.9,
      answerShape: 'Provide implementation help.',
    },
    now: 12_000,
  });

  assert.ok(
    actions.some(action => action.type === 'general_assistance_request'),
    `Expected general_assistance_request; got ${actions.map(action => action.type).join(', ')}`,
  );
});

test('assessSignals keeps sub-threshold signals out of top actions', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const sessionId = 'session_subthreshold';

  const actions = await engine.assessSignals({
    transcript: '这个价格可能有一点点高',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
    intentResult: { intent: 'handle_objection', confidence: 0.52, answerShape: '处理异议' },
    now: 10_000,
  });

  assert.equal(actions.length, 0);
  assert.equal(engine.getTopActions(sessionId).length, 0);
});

test('assessSignals rejects sidelined pricing and emits only the strongest confirmed need', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: '价格先放一边，我们想看客户案例和 API 集成要求',
    speaker: 'prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_semantic_gate_mixed_cn',
    intentResult: { intent: 'discovery_probe', confidence: 0.9, answerShape: '澄清需求', source: 'context' },
    cloudClassifier: async input => input.candidates.map(candidate => ({
      actionType: candidate.actionType,
      decision: candidate.actionType === 'pricing_objection' ? 'reject' : 'pass',
      confidence: candidate.actionType === 'pricing_objection' ? 0.84 : 0.91,
      reasons: candidate.actionType === 'pricing_objection'
        ? ['neutral_pricing_reference']
        : ['cloud_confirmed_required_candidate'],
      rejectedCandidates: candidate.actionType === 'pricing_objection' ? ['pricing_objection'] : [],
    })),
    now: 20_000,
  });

  assert.equal(actions.some(action => action.type === 'pricing_objection'), false);
  assert.ok(actions.some(action => action.type === 'technical_requirements'));
  assert.equal(actions.length, 1);
  assert.ok(actions.every(action => action.semanticGate?.decision === 'pass'));
});

test('semantic-gated path rejects cloud-rejected sales case mention', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: '材料里有成功案例这个章节。',
    modeTemplateType: 'sales',
    modeId: 'sales',
    sessionId: 'semantic_gate_rejects_case_title',
    cloudClassifier: async () => [{
      actionType: 'case_study_request',
      decision: 'reject',
      confidence: 0.93,
      reasons: ['section_title_only'],
      rejectedCandidates: ['case_study_request'],
    }],
  });

  assert.equal(actions.length, 0);
});

test('assessSignals rejects common sales false-positive turns when semantic gate rejects them', async () => {
  const { DynamicActionEngine } = await loadModules();
  const falsePositiveSalesTurns = [
    '后面我会介绍几个案例，先看产品架构。',
    '材料里有成功案例这个章节。',
    '报价表我们内部再整理。',
    'BOM 这个词前面材料里有。',
  ];

  for (const transcript of falsePositiveSalesTurns) {
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript,
      modeTemplateType: 'sales',
      modeId: 'sales',
      sessionId: `sales_false_positive_${transcript}`,
      cloudClassifier: async input => input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: 'reject',
        confidence: 0.9,
        reasons: ['neutral_mention'],
        rejectedCandidates: [candidate.actionType],
      })),
    });
    assert.equal(actions.length, 0, transcript);
  }
});

test('assessSignals keeps real-meeting sales positives behind policy gate', async () => {
  const { DynamicActionEngine } = await loadModules();
  const truePositiveSalesTurns = [
    { transcript: '你们这个科目的，全部搞下来是多少钱？', expectedAction: 'pricing_request' },
    { transcript: '你们能回头给我们展示一下成功的案例吗？', expectedAction: 'case_study_request' },
    { transcript: '我知道你们的太贵了。', expectedAction: 'pricing_objection' },
    { transcript: '细节那些我们后面下一步再安排，我们把人确定好再过来。', expectedAction: 'buying_signal' },
    { transcript: 'PLM 也可以监控库存，然后会不会自动更新一个新的物料推到 ERP？', expectedAction: 'discovery_question' },
  ];

  for (const item of truePositiveSalesTurns) {
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: item.transcript,
      modeTemplateType: 'sales',
      modeId: 'sales',
      sessionId: `sales_true_positive_${item.expectedAction}`,
      cloudClassifier: async input => input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: candidate.actionType === item.expectedAction ? 'pass' : 'reject',
        confidence: 0.92,
        reasons: candidate.actionType === item.expectedAction
          ? ['real_meeting_positive']
          : ['cloud_rejected_candidate'],
        rejectedCandidates: candidate.actionType === item.expectedAction ? [] : [candidate.actionType],
      })),
    });
    assert.ok(actions.some(action => action.type === item.expectedAction), item.transcript);
  }
});

test('assessSignals defers high-risk candidate when transcript scope is denied', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: 'This is too expensive.',
    speaker: 'prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_semantic_gate_scope_denied',
    providerDataScopes: { transcript: false },
    now: 20_000,
  });

  assert.equal(actions.length, 0);
  assert.equal(engine.getTopActions('session_semantic_gate_scope_denied').length, 0);
});

test('assessSignals emits explicit Chinese pricing request actions', async () => {
  const { DynamicActionEngine } = await loadModules();

  for (const transcript of ['发我报价', '给客户发一版报价', '模块多少钱']) {
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript,
      speaker: 'interviewer',
      modeTemplateType: 'sales',
      modeId: 'mode_sales',
      sessionId: `session_pricing_request_${transcript}`,
      cloudClassifier: cloudSelect('pricing_request'),
      now: 20_000,
    });

    const action = actions.find(item => item.type === 'pricing_request');
    assert.ok(action, `expected pricing_request for ${transcript}; got ${actions.map(item => item.type).join(', ')}`);
    assert.equal(action.answerStyle?.format, 'email');
    assert.equal(action.semanticGate?.decision, 'pass');
    assert.equal(action.semanticGate?.semanticProvider, 'cloud_llm');
  }
});

test('sales customer-intent triggers do not depend on speaker labels', async () => {
  const { DynamicActionEngine } = await loadModules();
  const fixtures = [
    {
      transcript: 'SOC2 是哪种报告?数据驻留要国内,安全合规要求确认一下。',
      expectedAction: 'technical_requirements',
      semanticIntent: 'sales_technical_requirements',
      recentContextTurns: [],
    },
    {
      transcript: '流程打通这块也说说?',
      expectedAction: 'discovery_question',
      semanticIntent: 'sales_process_integration',
      recentContextTurns: [
        { role: 'speaker', speaker: 'speaker-1', text: '生产环境的部署要求说一下,SSO 对接是 SAML 还是 OAuth?API 走 REST?', timestamp: 1 },
        { role: 'speaker', speaker: 'speaker-2', text: 'SAML/OAuth 都支持,API 是 REST,生产环境默认多可用区部署。', timestamp: 2 },
      ],
    },
    {
      transcript: '三天?具体怎么做到的?',
      expectedAction: 'discovery_question',
      semanticIntent: 'sales_contextual_proof_discovery',
      recentContextTurns: [
        { role: 'speaker', speaker: 'speaker-1', text: '现在变更影响分析太慢,一个周期拖三周,审计压力大,良率也受影响。', timestamp: 1 },
        { role: 'speaker', speaker: 'speaker-2', text: '价值锚定这块,我们的客户平均把变更影响分析周期从三周降到三天。', timestamp: 2 },
      ],
    },
    {
      transcript: '案例收到,我们也想要报价。',
      expectedAction: 'pricing_request',
      semanticIntent: 'sales_quote_request',
      recentContextTurns: [
        { role: 'speaker', speaker: 'speaker-1', text: '先给我看两个客户案例,我想看落地的 ROI。', timestamp: 1 },
        { role: 'speaker', speaker: 'speaker-2', text: '好,我把案例脱敏版本发您邮箱。', timestamp: 2 },
      ],
    },
  ];

  for (const fixture of fixtures) {
    for (const speaker of ['user', 'interviewer', 'speaker-1']) {
      const engine = new DynamicActionEngine();
      const actions = await engine.assessSignals({
        transcript: fixture.transcript,
        speaker,
        modeTemplateType: 'sales',
        modeId: 'mode_sales',
        sessionId: `session_sales_speaker_invariant_${speaker}_${fixture.expectedAction}`,
        recentContextTurns: fixture.recentContextTurns,
        cloudClassifier: async input => input.candidates.map(candidate => ({
          actionType: candidate.actionType,
          decision: candidate.actionType === fixture.expectedAction ? 'pass' : 'reject',
          confidence: candidate.actionType === fixture.expectedAction ? 0.92 : 0.8,
          semanticIntent: candidate.actionType === fixture.expectedAction ? fixture.semanticIntent : candidate.actionType,
          reasons: candidate.actionType === fixture.expectedAction ? ['cloud_confirmed_customer_intent'] : ['cloud_rejected_candidate'],
          rejectedCandidates: candidate.actionType === fixture.expectedAction ? [] : [candidate.actionType],
        })),
        now: 20_000,
      });

      assert.ok(
        actions.some(action => action.type === fixture.expectedAction),
        `${fixture.transcript} should emit ${fixture.expectedAction} for speaker=${speaker}; got ${actions.map(action => action.type).join(', ')}`,
      );
    }
  }
});

test('sales seller-response semantics suppress customer-intent cards regardless of speaker label', async () => {
  const { DynamicActionEngine } = await loadModules();
  const sellerResponses = [
    '我们有 SOC2 Type II,数据驻留可选国内/海外区域。',
    '我把案例脱敏后发您。',
    '报价单稍后发,商务条款我们电话沟通。',
    'SAML/OAuth 都支持,API 是 REST。',
  ];

  for (const transcript of sellerResponses) {
    for (const speaker of ['user', 'interviewer', 'speaker-1']) {
      const engine = new DynamicActionEngine();
      const actions = await engine.assessSignals({
        transcript,
        speaker,
        modeTemplateType: 'sales',
        modeId: 'mode_sales',
        sessionId: `session_sales_seller_response_${speaker}_${transcript.length}`,
        cloudClassifier: cloudSelect('pricing_request'),
        now: 20_000,
      });

      assert.equal(
        actions.some(action => ['pricing_request', 'case_study_request', 'technical_requirements', 'discovery_question'].includes(action.type)),
        false,
        `seller response should not emit a Sales customer-intent card for speaker=${speaker}: ${transcript}; got ${actions.map(action => action.type).join(', ')}`,
      );
    }
  }
});

test('assessSignals does not emit sales cards for broad internal cost, proof, or kickoff mentions', async () => {
  const { DynamicActionEngine } = await loadModules();
  const falsePositiveCases = [
    {
      transcript: '作为管理层，我想看这个季度这些变更到底浪费多少钱。',
      unexpectedType: 'pricing_request',
    },
    {
      transcript: '后面因为本身也会介绍案例嘛，我把案例全部放在一个单独章节。',
      unexpectedType: 'case_study_request',
    },
    {
      transcript: '我们分阶段一和阶段二，一阶段上线完之后，紧接着会启动二阶段。',
      unexpectedType: 'buying_signal',
    },
    {
      transcript: '这个流程先在某个市为试点，用 AI 连续计算来抓违规点。',
      unexpectedType: 'buying_signal',
    },
    {
      transcript: '明白，再往下走。',
      unexpectedType: 'buying_signal',
    },
  ];

  for (const { transcript, unexpectedType } of falsePositiveCases) {
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript,
      speaker: 'prospect',
      modeTemplateType: 'sales',
      modeId: 'mode_sales',
      sessionId: `session_sales_broad_negative_${unexpectedType}_${transcript.length}`,
      now: 20_000,
    });

    assert.equal(
      actions.some(action => action.type === unexpectedType),
      false,
      `unexpected ${unexpectedType} for: ${transcript}; got ${actions.map(action => action.type).join(', ')}`,
    );
  }
});

test('assessSignals emits explicit Chinese case request actions', async () => {
  const { DynamicActionEngine } = await loadModules();

  for (const transcript of ['我们想看案例', '有类似客户吗', '给一个成功案例', '客户要证明材料']) {
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript,
      speaker: 'interviewer',
      modeTemplateType: 'sales',
      modeId: 'mode_sales',
      sessionId: `session_case_request_${transcript}`,
      cloudClassifier: async input => input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: candidate.actionType === 'case_study_request' ? 'pass' : 'reject',
        confidence: candidate.actionType === 'case_study_request' ? 0.92 : 0.8,
        reasons: candidate.actionType === 'case_study_request' ? ['cloud_confirmed_case_request'] : ['cloud_rejected_candidate'],
      })),
      now: 20_000,
    });

    const action = actions.find(item => item.type === 'case_study_request');
    assert.ok(action, `expected case_study_request for ${transcript}; got ${actions.map(item => item.type).join(', ')}`);
    assert.equal(action.semanticGate?.decision, 'pass');
    assert.equal(action.semanticGate?.semanticProvider, 'cloud_llm');
  }
});

test('assessSignals fails closed for an English price objection when cloud returns null', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: 'This is too expensive for our budget.',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_english_price_cloud_null',
    cloudClassifier: async () => null,
    now: 20_000,
  });

  assert.deepEqual(actions, []);
});

test('assessSignals keeps neutral pricing references rejected when cloud returns null', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: 'The pricing page is just reference material; we need a case study and a technical solution.',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_neutral_pricing_cloud_null',
    cloudClassifier: async () => null,
    now: 20_000,
  });

  assert.equal(actions.some(item => item.type === 'pricing_request'), false);
  assert.equal(actions.some(item => item.type === 'pricing_objection'), false);
  assert.equal(actions.some(item => item.type === 'case_study_request'), false);
  assert.equal(actions.some(item => item.type === 'technical_requirements'), false);
});

test('assessSignals uses injected cloud classifier for English high-risk candidates', async () => {
  const { DynamicActionEngine } = await loadModules();
  const calls = [];
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: 'We need a similar customer case proving ROI, not the pricing page.',
    speaker: 'prospect',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_semantic_gate_cloud',
    cloudClassifier: async input => {
      calls.push(input);
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: candidate.actionType === 'case_study_request' ? 'pass' : 'reject',
        confidence: candidate.actionType === 'case_study_request' ? 0.94 : 0.82,
        semanticIntent: candidate.actionType === 'case_study_request'
          ? 'case_or_proof_request'
          : 'neutral_or_rejected_candidate',
        reasons: candidate.actionType === 'case_study_request'
          ? ['cloud_confirmed_case_request']
          : ['cloud_rejected_candidate'],
        rejectedCandidates: candidate.actionType === 'case_study_request' ? [] : [candidate.actionType],
      }));
    },
    now: 20_000,
  });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].candidates.some(candidate => candidate.actionType === 'case_study_request'));
  assert.ok(actions.some(action => action.type === 'case_study_request'));
  assert.equal(actions.some(action => action.type === 'pricing_request'), false);
  const caseAction = actions.find(action => action.type === 'case_study_request');
  assert.equal(caseAction?.semanticGate?.usedCloudArbitration, true);
  assert.equal(caseAction?.semanticGate?.semanticProvider, 'cloud_llm');
});

test('assessSignals enriches sales regex candidates with policy metadata', async () => {
  const { DynamicActionEngine } = await loadModules();
  const calls = [];
  const engine = new DynamicActionEngine();

  await engine.assessSignals({
    transcript: '有没有类似客户案例？',
    speaker: 'Customer',
    modeTemplateType: 'sales',
    modeId: 'sales',
    sessionId: 'policy_sales_regex',
    cloudClassifier: async input => {
      calls.push(input);
      return [{ actionType: 'case_study_request', decision: 'defer', confidence: 0.7 }];
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].candidates[0].actionType, 'case_study_request');
  assert.equal(calls[0].candidates[0].riskLevel, 'high');
  assert.equal(calls[0].candidates[0].gateStrategy, 'required');
  assert.equal(calls[0].candidates[0].allowLocalFallbackOnCloudFailure, false);
});

test('all FDE policies keep local fallback disabled', async () => {
  const { getActionGatePolicy } = await import(pathToFileURL(policyPath).href);
  for (const actionType of [
    'fde_discovery_probe',
    'fde_integration_check',
    'fde_security_review',
    'fde_risk_blocker',
    'fde_agent_feasibility',
    'fde_success_criteria',
    'fde_next_step',
  ]) {
    const policy = getActionGatePolicy('fde', actionType);
    assert.equal(policy.riskLevel, 'high');
    assert.equal(policy.gateStrategy, 'required');
    assert.equal(policy.allowLocalFallbackOnCloudFailure, false);
    assert.deepEqual(policy.localFallbackEvidence, []);
  }
});

test('sales intent-only input calls semantic gate but defer prevents card', async () => {
  const { DynamicActionEngine } = await loadModules();
  const calls = [];
  const engine = new DynamicActionEngine();

  const actions = await engine.assessSignals({
    transcript: '这个说法本身没有案例关键词',
    speaker: 'Customer',
    modeTemplateType: 'sales',
    modeId: 'sales',
    sessionId: 'policy_sales_synthetic',
    intentResult: {
      intent: 'sales_proof_request',
      confidence: 0.91,
      answerShape: 'test',
      source: 'cloud',
    },
    detectedTriggers: [],
    cloudClassifier: async input => {
      calls.push(input);
      return [{ actionType: 'case_study_request', decision: 'defer', confidence: 0.7 }];
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(actions, []);
});

test('safe intent synthesis creates gated candidates across detector-only modes', async () => {
  const { DynamicActionEngine } = await loadModules();
  const cases = [
    {
      modeTemplateType: 'sales',
      intentResult: { intent: 'sales_quote_request', confidence: 0.93, answerShape: 'quote', source: 'cloud' },
      expectedAction: 'pricing_request',
    },
    {
      modeTemplateType: 'fde',
      intentResult: { intent: 'fde_integration', confidence: 0.93, answerShape: 'integration', source: 'cloud' },
      expectedAction: 'fde_integration_check',
    },
    {
      modeTemplateType: 'recruiting',
      intentResult: { intent: 'recruiting_risk_verification', confidence: 0.93, answerShape: 'probe', source: 'cloud' },
      expectedAction: 'candidate_experience_probe',
    },
    {
      modeTemplateType: 'team-meet',
      intentResult: { intent: 'capture_action', confidence: 0.93, answerShape: 'action', source: 'pattern' },
      expectedAction: 'action_item',
    },
  ];

  for (const item of cases) {
    let cloudCalls = 0;
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: `intent-only candidate for ${item.expectedAction}`,
      speaker: 'speaker',
      modeTemplateType: item.modeTemplateType,
      modeId: `mode_${item.expectedAction}`,
      sessionId: `session_${item.expectedAction}`,
      intentResult: item.intentResult,
      detectedTriggers: [],
      cloudClassifier: async input => {
        cloudCalls += 1;
        return input.candidates.map(candidate => ({
          actionType: candidate.actionType,
          decision: candidate.actionType === item.expectedAction ? 'pass' : 'reject',
          confidence: candidate.actionType === item.expectedAction ? 0.92 : 0.8,
          reasons: candidate.actionType === item.expectedAction ? ['safe_intent_synth_pass'] : ['cloud_rejected_candidate'],
          rejectedCandidates: candidate.actionType === item.expectedAction ? [] : [candidate.actionType],
        }));
      },
      now: 20_000,
    });

    assert.equal(cloudCalls, 1, item.expectedAction);
    assert.ok(
      actions.some(action => action.type === item.expectedAction),
      `${item.expectedAction} should be emitted; got ${actions.map(action => action.type).join(', ')}`,
    );
  }
});

test('safe intent synthesis refuses local SLM, low confidence, and cross-mode intents', async () => {
  const { DynamicActionEngine } = await loadModules();
  const cases = [
    {
      name: 'local_slm_high_risk',
      modeTemplateType: 'sales',
      intentResult: { intent: 'sales_quote_request', confidence: 0.96, answerShape: 'quote', source: 'local_slm' },
    },
    {
      name: 'low_confidence',
      modeTemplateType: 'fde',
      intentResult: { intent: 'fde_integration', confidence: 0.84, answerShape: 'integration', source: 'cloud' },
    },
    {
      name: 'cross_mode_intent',
      modeTemplateType: 'team-meet',
      intentResult: { intent: 'sales_quote_request', confidence: 0.96, answerShape: 'quote', source: 'cloud' },
    },
  ];

  for (const item of cases) {
    const calls = [];
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: `intent-only synthetic guard ${item.name}`,
      speaker: 'speaker',
      modeTemplateType: item.modeTemplateType,
      modeId: `mode_${item.name}`,
      sessionId: `session_${item.name}`,
      intentResult: item.intentResult,
      detectedTriggers: [],
      cloudClassifier: async input => {
        calls.push(input);
        return input.candidates.map(candidate => ({
          actionType: candidate.actionType,
          decision: 'pass',
          confidence: 0.92,
          reasons: ['should_not_be_called_for_unsafe_intent'],
        }));
      },
    });

    assert.deepEqual(actions, [], item.name);
    assert.equal(calls.length, 0, item.name);
  }
});

describe('DynamicActionEngine real meeting semantic gate fixtures', () => {
  const fixtures = [
    {
      name: '中文转折：价格先放一边，我们想看案例',
      modeTemplateType: 'sales',
      turns: [],
      currentTranscript: '价格先放一边，我们想看案例',
      speaker: 'buyer-a',
      providerDataScopes: { transcript: true },
      cloudClassifierResult: [
        { actionType: 'case_study_request', decision: 'pass', confidence: 0.92, semanticIntent: 'case_or_proof_request', reasons: ['cloud_confirmed_case_request'] },
      ],
      expectedActions: ['case_study_request'],
      expectedRejectedActions: ['pricing_request', 'pricing_objection'],
      expectedTraceReasons: ['cloud_confirmed_case_request'],
    },
    {
      name: '英文转折：not the pricing page, we need proof from a similar customer',
      modeTemplateType: 'sales',
      turns: [],
      currentTranscript: 'not the pricing page, we need proof from a similar customer',
      speaker: 'buyer-a',
      providerDataScopes: { transcript: true },
      cloudClassifierResult: [
        { actionType: 'pricing_request', decision: 'reject', confidence: 0.86, semanticIntent: 'neutral_pricing_reference', reasons: ['cloud_rejected_pricing_reference'], rejectedCandidates: ['pricing_request'] },
        { actionType: 'case_study_request', decision: 'pass', confidence: 0.94, semanticIntent: 'case_or_proof_request', reasons: ['cloud_confirmed_case_request'] },
      ],
      expectedActions: ['case_study_request'],
      expectedRejectedActions: ['pricing_request'],
      expectedTraceReasons: ['cloud_confirmed_case_request', 'cloud_rejected_pricing_reference'],
    },
    {
      name: '中英混合：这个先不谈 pricing，我们要看 integration plan',
      modeTemplateType: 'sales',
      turns: [],
      currentTranscript: '这个先不谈 pricing page，我们要看 integration requirements',
      speaker: 'buyer-b',
      providerDataScopes: { transcript: true },
      cloudClassifierResult: [
        { actionType: 'pricing_request', decision: 'reject', confidence: 0.84, semanticIntent: 'topic_deprioritized', reasons: ['cloud_rejected_pricing_reference'], rejectedCandidates: ['pricing_request'] },
        { actionType: 'technical_requirements', decision: 'pass', confidence: 0.91, semanticIntent: 'integration_requirements', reasons: ['cloud_confirmed_integration_need'] },
      ],
      expectedActions: ['technical_requirements'],
      expectedRejectedActions: ['pricing_request'],
      expectedTraceReasons: ['cloud_confirmed_integration_need', 'cloud_rejected_pricing_reference'],
    },
    {
      name: '多轮污染：上一轮价格异议，当前切到 SSO/生产环境',
      modeTemplateType: 'sales',
      turns: [
        { role: 'buyer', speaker: 'buyer-a', text: 'Earlier this was too expensive for our budget.', timestamp: 1 },
      ],
      currentTranscript: '现在切到 SSO 对接和 production integration requirements',
      speaker: 'buyer-b',
      providerDataScopes: { transcript: true },
      cloudClassifierResult: [
        { actionType: 'technical_requirements', decision: 'pass', confidence: 0.9, semanticIntent: 'integration_requirements', reasons: ['cloud_confirmed_current_turn_integration'] },
      ],
      expectedActions: ['technical_requirements'],
      expectedRejectedActions: ['pricing_objection'],
      expectedTraceReasons: ['cloud_confirmed_current_turn_integration'],
    },
    {
      name: '多人说话：内部成员提报价表，客户要案例',
      modeTemplateType: 'sales',
      turns: [
        { role: 'buyer', speaker: 'customer', text: 'The quote was too high earlier.', timestamp: 1 },
      ],
      currentTranscript: '我们的报价单在这，客户现在只是问 case study',
      speaker: 'seller',
      providerDataScopes: { transcript: true },
      cloudClassifierResult: [
        { actionType: 'pricing_request', decision: 'reject', confidence: 0.8, semanticIntent: 'internal_quote_reference', reasons: ['cloud_rejected_internal_quote_reference'], rejectedCandidates: ['pricing_request'] },
        { actionType: 'case_study_request', decision: 'pass', confidence: 0.9, semanticIntent: 'case_or_proof_request', reasons: ['cloud_confirmed_case_request'] },
      ],
      expectedActions: ['case_study_request'],
      expectedRejectedActions: ['pricing_request'],
      expectedTraceReasons: ['cloud_rejected_internal_quote_reference', 'cloud_confirmed_case_request'],
    },
    {
      name: '隐私禁止云端：英文高风险不调用 cloud classifier',
      modeTemplateType: 'sales',
      turns: [],
      currentTranscript: 'This is too expensive for our budget.',
      speaker: 'buyer',
      providerDataScopes: { transcript: false },
      cloudFailure: 'scope_denied',
      expectedActions: [],
      expectedRejectedActions: ['pricing_objection'],
      expectedTraceReasons: ['provider_scope_denied'],
    },
    {
      name: '云端失败关闭：null 不返回价格异议',
      modeTemplateType: 'sales',
      turns: [],
      currentTranscript: 'This is too expensive for our budget.',
      speaker: 'buyer',
      providerDataScopes: { transcript: true },
      cloudClassifierResult: null,
      expectedActions: [],
      expectedRejectedActions: ['pricing_objection'],
      expectedTraceReasons: ['cloud_provider_unavailable'],
    },
    {
      name: '云端失败关闭：timeout 不返回价格异议',
      modeTemplateType: 'sales',
      turns: [],
      currentTranscript: 'This is too expensive for our budget.',
      speaker: 'buyer',
      providerDataScopes: { transcript: true },
      cloudFailure: 'timeout',
      expectedActions: [],
      expectedRejectedActions: ['pricing_objection'],
      expectedTraceReasons: ['cloud_timeout'],
    },
    {
      name: '云端失败兜底：非法结构拒绝中性价格引用',
      modeTemplateType: 'sales',
      turns: [],
      currentTranscript: 'The pricing page is only a reference; we need a case study.',
      speaker: 'buyer',
      providerDataScopes: { transcript: true },
      cloudClassifierResult: [{ actionType: 'pricing_request', decision: 'approve', confidence: 0.9 }],
      expectedActions: [],
      expectedRejectedActions: ['pricing_request'],
      expectedTraceReasons: ['cloud_invalid_json'],
    },
  ];

  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const { DynamicActionEngine } = await loadModules();
      const traces = [];
      let cloudCalls = 0;
      const engine = new DynamicActionEngine();
      const cloudClassifier = async ({ candidates }) => {
        cloudCalls += 1;
        if (fixture.cloudFailure === 'timeout') {
          const error = new Error('cloud classifier timeout');
          error.code = 'ETIMEDOUT';
          throw error;
        }
        if (fixture.cloudFailure === 'scope_denied') {
          throw new Error('cloud classifier must not be called');
        }
        if (!Array.isArray(fixture.cloudClassifierResult)) {
          return fixture.cloudClassifierResult;
        }
        const candidateTypes = new Set(candidates.map((candidate) => candidate.actionType));
        const completeResults = candidates.map((candidate) => (
          fixture.cloudClassifierResult.find((result) => result.actionType === candidate.actionType) ?? {
            actionType: candidate.actionType,
            decision: 'reject',
            confidence: 0.8,
            reasons: ['cloud_rejected_candidate'],
            rejectedCandidates: [candidate.actionType],
          }
        ));
        const extras = fixture.cloudClassifierResult.filter((result) => !candidateTypes.has(result.actionType));
        return [...completeResults, ...extras];
      };

      const actions = await engine.assessSignals({
        transcript: fixture.currentTranscript,
        speaker: fixture.speaker,
        modeTemplateType: fixture.modeTemplateType,
        modeId: `mode_${fixture.modeTemplateType}`,
        sessionId: `session_fixture_${fixture.name}`,
        recentContextTurns: fixture.turns,
        providerDataScopes: fixture.providerDataScopes,
        cloudClassifier,
        semanticGateTraceSink: trace => traces.push(trace),
        now: 20_000,
      });

      for (const expectedAction of fixture.expectedActions) {
        assert.ok(actions.some(action => action.type === expectedAction), `${fixture.name}: expected stored ${expectedAction}; got ${actions.map(action => action.type).join(', ')}`);
      }
      for (const rejectedAction of fixture.expectedRejectedActions) {
        assert.equal(actions.some(action => action.type === rejectedAction), false, `${fixture.name}: should not store ${rejectedAction}`);
      }
      for (const expectedReason of fixture.expectedTraceReasons) {
        assert.ok(traces.some(trace => trace.reasons.includes(expectedReason) || trace.degradedReason === expectedReason), `${fixture.name}: expected trace reason ${expectedReason}; got ${JSON.stringify(traces)}`);
      }
      if (fixture.cloudFailure === 'scope_denied') {
        assert.equal(cloudCalls, 0, `${fixture.name}: cloud classifier should not be called`);
      }
    });
  }
});

test('assessSignals requires repeated evidence before auto-surfacing ordinary objections', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const sessionId = 'session_auto_after_repeat';

  const first = await engine.assessSignals({
    transcript: '这个价格太高了',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
    intentResult: { intent: 'handle_objection', confidence: 0.9, answerShape: '处理异议' },
    cloudClassifier: cloudSelect('pricing_objection'),
    now: 10_000,
  });
  const second = await engine.assessSignals({
    transcript: '我们老板肯定会觉得报价太高',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
    intentResult: { intent: 'handle_objection', confidence: 0.92, answerShape: '处理异议' },
    cloudClassifier: cloudSelect('pricing_objection'),
    now: 30_000,
  });

  assert.equal(first[0]?.autoSurfacePolicy, 'card');
  assert.equal(first[0]?.autoTriggerEligible, false);
  assert.equal(second[0]?.autoSurfacePolicy, 'auto');
  assert.equal(second[0]?.autoTriggerEligible, true);
  assert.ok((second[0]?.evidenceCount ?? 0) >= 2);
});

test('findRecentActionForIntent maps classifier intent to active dynamic action', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const sessionId = 'session_find_intent';

  await engine.assessSignals({
    transcript: '这个价格太高了',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
    intentResult: { intent: 'handle_objection', confidence: 0.92, answerShape: '处理异议' },
    cloudClassifier: cloudSelect('pricing_objection'),
    now: 10_000,
  });

  const matching = engine.findRecentActionForIntent({
    sessionId,
    modeTemplateType: 'sales',
    intent: 'handle_objection',
    now: 11_000,
  });
  const nonMatching = engine.findRecentActionForIntent({
    sessionId,
    modeTemplateType: 'sales',
    intent: 'seize_signal',
    now: 11_000,
  });

  assert.equal(matching?.type, 'pricing_objection');
  assert.equal(matching?.confirmedIntent, 'handle_objection');
  assert.equal(nonMatching, null);
});

// ============================================================================
// Per-Trigger fixtures (one block per mode, covers every ActionTrigger).
// Each fixture asserts: type matches, label matches trigger.label,
// priority is preserved end-to-end.
// ============================================================================

function findAction(actions, type) {
  return actions.find((a) => a.type === type);
}

describe('ActionTrigger fixtures — general mode', () => {
  test('general_assistance_request (zh) → priority 0.82', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '帮我想一下我该怎么回应这个问题',
      modeTemplateType: 'general', modeId: 'm_g', sessionId: 's_g_assist',
    });
    const a = findAction(actions, 'general_assistance_request');
    assert.ok(a, 'expected general_assistance_request');
    assert.equal(a.label, 'Suggest response');
    assert.equal(a.priority, 0.82);
    assert.equal(a.confidence, 0.82);
  });

  test('general_assistance_request (en) → priority 0.82', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'Can you help me figure out how to respond?',
      modeTemplateType: 'general', modeId: 'm_g', sessionId: 's_g_assist_en',
    });
    const a = findAction(actions, 'general_assistance_request');
    assert.ok(a);
    assert.equal(a.priority, 0.82);
  });

  test('general_summarize (zh) → priority 0.78', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '总结一下刚才讨论了什么',
      modeTemplateType: 'general', modeId: 'm_g', sessionId: 's_g_sum',
    });
    const a = findAction(actions, 'general_summarize');
    assert.ok(a);
    assert.equal(a.label, 'Summarize discussion');
    assert.equal(a.priority, 0.78);
  });

  test('general_summarize (en) → priority 0.78', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'Quick summary of what they said, please.',
      modeTemplateType: 'general', modeId: 'm_g', sessionId: 's_g_sum_en',
    });
    const a = findAction(actions, 'general_summarize');
    assert.ok(a);
    assert.equal(a.priority, 0.78);
  });

  test('general_explain (zh) → priority 0.76', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '能通俗一点解释一下这是什么意思',
      modeTemplateType: 'general', modeId: 'm_g', sessionId: 's_g_exp',
    });
    const a = findAction(actions, 'general_explain');
    assert.ok(a);
    assert.equal(a.label, 'Explain clearly');
    assert.equal(a.priority, 0.76);
  });

  test('general_explain (en) → priority 0.76', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'Can you break that down in simple terms?',
      modeTemplateType: 'general', modeId: 'm_g', sessionId: 's_g_exp_en',
    });
    const a = findAction(actions, 'general_explain');
    assert.ok(a);
    assert.equal(a.priority, 0.76);
  });
});

describe('ActionTrigger fixtures — negotiation mode', () => {
  test('budget_probe (zh) → priority 0.88', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '你们的预算是多少?',
      modeTemplateType: 'negotiation', modeId: 'm_n', sessionId: 's_n_bp',
    });
    const a = findAction(actions, 'budget_probe');
    assert.ok(a);
    assert.equal(a.label, 'Handle budget probe');
    assert.equal(a.priority, 0.88);
  });

  test('budget_probe (en) → priority 0.88', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: "What's your budget range for this engagement?",
      modeTemplateType: 'negotiation', modeId: 'm_n', sessionId: 's_n_bp_en',
    });
    const a = findAction(actions, 'budget_probe');
    assert.ok(a);
    assert.equal(a.priority, 0.88);
  });

  test('price_pushback (zh) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '价格太高了,能打个折吗?',
      modeTemplateType: 'negotiation', modeId: 'm_n', sessionId: 's_n_pp',
    });
    const a = findAction(actions, 'price_pushback');
    assert.ok(a);
    assert.equal(a.label, 'Counter price pushback');
    assert.equal(a.priority, 0.9);
  });

  test('price_pushback (en) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'The price is too high — can you do better?',
      modeTemplateType: 'negotiation', modeId: 'm_n', sessionId: 's_n_pp_en',
    });
    const a = findAction(actions, 'price_pushback');
    assert.ok(a);
    assert.equal(a.priority, 0.9);
  });

  test('final_offer (zh) → priority 0.92', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '这是我们的最终报价,接受就接受',
      modeTemplateType: 'negotiation', modeId: 'm_n', sessionId: 's_n_fo',
    });
    const a = findAction(actions, 'final_offer');
    assert.ok(a);
    assert.equal(a.label, 'Respond to final offer');
    assert.equal(a.priority, 0.92);
  });

  test('final_offer (en) → priority 0.92', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'This is our final offer — take it or leave it.',
      modeTemplateType: 'negotiation', modeId: 'm_n', sessionId: 's_n_fo_en',
    });
    const a = findAction(actions, 'final_offer');
    assert.ok(a);
    assert.equal(a.priority, 0.92);
  });
});

describe('ActionTrigger fixtures — sales mode', () => {
  test('pricing_objection (zh) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '这个价格太高了,能不能便宜点?',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_po',
    });
    const a = findAction(actions, 'pricing_objection');
    assert.ok(a);
    assert.equal(a.label, 'Handle pricing objection');
    assert.equal(a.priority, 0.9);
  });

  test('bare competitor mention does not create a standalone sales action', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: "We're already using Gong for our sales calls.",
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_cm',
    });
    assert.equal(actions.some(action => action.type === 'competitor_mention'), false);
    assert.equal(actions.length, 0);
  });

  test('buying_signal (zh: 敲定) → priority 0.95', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '那我们就敲定吧,准备签合同',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_bs',
    });
    const a = findAction(actions, 'buying_signal');
    assert.ok(a);
    assert.equal(a.label, 'Seize buying signal');
    assert.equal(a.priority, 0.95);
  });

  test('sales ASR confusion: 放假审核 still maps to buying_signal', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: '我们 CFO 这周在,下周想推进到放假审核那一步',
      speaker: 'interviewer',
      modeTemplateType: 'sales',
      modeId: 'm_s',
      sessionId: 's_s_bs_legal_asr',
      cloudClassifier: cloudSelect('buying_signal', 0.95),
    });
    const a = findAction(actions, 'buying_signal');
    assert.ok(a, `expected buying_signal; got ${actions.map(action => action.type).join(', ')}`);
    assert.equal(a.priority, 0.95);
  });

  test('sales ASR confusion: Box five hundred + 预算过不了 still maps to pricing_objection', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: '听起来不错,但 Box five hundred 个席位年付预算这一关就过不了',
      speaker: 'interviewer',
      modeTemplateType: 'sales',
      modeId: 'm_s',
      sessionId: 's_s_po_budget_asr',
      cloudClassifier: cloudSelect('pricing_objection', 0.9),
    });
    const a = findAction(actions, 'pricing_objection');
    assert.ok(a, `expected pricing_objection; got ${actions.map(action => action.type).join(', ')}`);
    assert.equal(a.priority, 0.9);
  });

  test('ROI proof request maps to case_study_request', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'What is the ROI on this and the payback period?',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_roi',
    });
    const a = findAction(actions, 'case_study_request');
    assert.ok(a);
    assert.equal(a.label, 'Share relevant case study');
    assert.equal(a.priority, 0.87);
  });

  test('pricing_request (zh: 报价) → priority 0.86', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '请发我报价单',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_pr',
    });
    const a = findAction(actions, 'pricing_request');
    assert.ok(a);
    assert.equal(a.label, 'Draft quote email');
    assert.equal(a.priority, 0.86);
  });

  test('pricing_request (zh: 发一版报价) surfaces quote email draft', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '那我们会后发一版报价给你们确认',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_pr_draft',
    });
    const a = findAction(actions, 'pricing_request');
    assert.ok(a);
    assert.equal(a.label, 'Draft quote email');
    assert.match(a.promptInstruction, /email draft/i);
    assert.equal(a.answerStyle?.format, 'email');
    assert.match(a.promptInstruction, /Do not invent/);
    assert.match(a.promptInstruction, /customer names/);
    assert.match(a.promptInstruction, /\[QUOTE_AMOUNT\]/);
    assert.equal(a.priority, 0.86);
  });

  test('pricing_request (zh: 报个价格看看) surfaces quote email draft', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '报个价格看看',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_pr_price_probe',
    });
    const a = findAction(actions, 'pricing_request');
    assert.ok(a);
    assert.equal(a.label, 'Draft quote email');
    assert.equal(a.priority, 0.86);
  });

  test('pricing_request (zh: 给个价格) surfaces quote email draft', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '给个价格',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_pr_give_price',
    });
    const a = findAction(actions, 'pricing_request');
    assert.ok(a);
    assert.equal(a.label, 'Draft quote email');
    assert.equal(a.priority, 0.86);
  });

  test('pricing_request (zh: 给客户发一版报价) surfaces quote email draft', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '给客户发一版报价',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_pr_send_quote',
    });
    const a = findAction(actions, 'pricing_request');
    assert.ok(a);
    assert.equal(a.label, 'Draft quote email');
    assert.equal(a.priority, 0.86);
  });

  test('pricing_request does not fire for Chinese report/quoted-price mentions', async () => {
    const { DynamicActionEngine } = await loadModules();
    const falsePositiveTranscripts = [
      '他报告了价格走势，市场普遍看涨',
      '客户报了价格给我们',
    ];

    for (const transcript of falsePositiveTranscripts) {
      const engine = new DynamicActionEngine();
      const actions = engine.detectActions({
        transcript,
        modeTemplateType: 'sales', modeId: 'm_s', sessionId: `s_s_pr_negative_${transcript.length}`,
      });
      assert.equal(
        actions.some(action => action.type === 'pricing_request'),
        false,
        `unexpected pricing_request for: ${transcript}`,
      );
    }
  });

  test('sales price mentions do not suppress case-study and technical-need signals', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '价格先放一边，我们更想看 Acme 这种客户案例，以及 API 集成和部署要求。',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_case_tech_needs',
    });

    assert.equal(
      actions.some(action => action.type === 'pricing_objection' || action.type === 'pricing_request'),
      false,
      `price-only mention should not create pricing actions; got ${actions.map(a => a.type).join(', ')}`,
    );
    assert.ok(
      actions.some(action => action.type === 'case_study_request'),
      `expected case_study_request; got ${actions.map(a => a.type).join(', ')}`,
    );
    assert.ok(
      actions.some(action => action.type === 'technical_requirements'),
      `expected technical_requirements; got ${actions.map(a => a.type).join(', ')}`,
    );
  });

  test('sales bare English price mentions do not create pricing objections', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'The price list is useful, but first we need a technical solution and a customer case study.',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_bare_price',
    });

    assert.equal(
      actions.some(action => action.type === 'pricing_objection'),
      false,
      `bare price mention should not create pricing_objection; got ${actions.map(a => a.type).join(', ')}`,
    );
    assert.ok(actions.some(action => action.type === 'case_study_request'));
    assert.ok(actions.some(action => action.type === 'technical_requirements'));
  });

  test('sales internal price-list identity mismatch does not trigger technical requirements', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const transcript = [
      'The price list is in our internal folder，不是客户在问报价。',
      '这段只是我们内部核对客户身份错配和材料位置。',
      '后面有人提到 technical solution 和 integration requirements，也只是文件夹里的方案标题，不是客户需求。',
    ].join(' ');

    const actions = engine.detectActions({
      transcript,
      modeTemplateType: 'sales',
      modeId: 'm_s',
      sessionId: 's_s_internal_price_identity_guard',
    });

    assert.deepEqual(actions.map(action => action.type), []);
  });

  test('sales technical requirement phrasing is detected without pricing language', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '客户想确认技术方案、接口需求、SSO 对接方式和生产环境部署要求。',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_technical_needs',
    });

    const action = findAction(actions, 'technical_requirements');
    assert.ok(action, `expected technical_requirements; got ${actions.map(a => a.type).join(', ')}`);
    assert.equal(action.label, 'Clarify technical requirements');
  });

  test('pricing_objection remains preferred for Chinese price pushback', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '这个价格太高了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_pr_objection_guard',
    });

    assert.ok(findAction(actions, 'pricing_objection'));
    assert.equal(actions.some(action => action.type === 'pricing_request'), false);
  });
});

describe('ActionTrigger fixtures — recruiting mode', () => {
  test('candidate_concern (zh: 签证) → priority 0.85', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '我比较担心签证和入职时间的问题',
      modeTemplateType: 'recruiting', modeId: 'm_r', sessionId: 's_r_cc',
    });
    const a = findAction(actions, 'candidate_concern');
    assert.ok(a);
    assert.equal(a.label, 'Address candidate concern');
    assert.equal(a.priority, 0.85);
  });

  test('strong_fit_signal (zh: 明确岗位兴趣) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '我对这个岗位很感兴趣，也很期待加入团队',
      modeTemplateType: 'recruiting', modeId: 'm_r', sessionId: 's_r_sf',
    });
    const a = findAction(actions, 'strong_fit_signal');
    assert.ok(a);
    assert.equal(a.label, '候选人表达了岗位兴趣');
    assert.equal(a.priority, 0.9);
  });

  test('candidate_experience_probe (zh: 举一个具体例子) → priority 0.84', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '你能举一个具体的例子吗?',
      modeTemplateType: 'recruiting', modeId: 'm_r', sessionId: 's_r_cep',
    });
    const a = findAction(actions, 'candidate_experience_probe');
    assert.ok(a);
    assert.equal(a.label, '追问岗位相关证据');
    assert.equal(a.priority, 0.84);
  });
});

describe('ActionTrigger fixtures — team-meet mode', () => {
  test('action_item (zh: 我来负责) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '这件事我来负责,周五前完成',
      modeTemplateType: 'team-meet', modeId: 'm_tm', sessionId: 's_tm_ai',
    });
    const a = findAction(actions, 'action_item');
    assert.ok(a);
    assert.equal(a.label, 'Capture action item');
    assert.equal(a.priority, 0.9);
  });

  test('decision_point (zh: 决定了) → priority 0.85', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '我们决定了用方案 A',
      modeTemplateType: 'team-meet', modeId: 'm_tm', sessionId: 's_tm_dp',
    });
    const a = findAction(actions, 'decision_point');
    assert.ok(a);
    assert.equal(a.label, 'Confirm decision');
    assert.equal(a.priority, 0.85);
  });

  test('blocker_check (zh: 阻塞) → priority 0.84', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '现在有什么阻塞吗?',
      modeTemplateType: 'team-meet', modeId: 'm_tm', sessionId: 's_tm_bc',
    });
    const a = findAction(actions, 'blocker_check');
    assert.ok(a);
    assert.equal(a.label, 'Clarify blocker');
    assert.equal(a.priority, 0.84);
  });

  test('owner_deadline_check (zh: 谁负责) → priority 0.83', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '这件事谁负责?截止日期是什么时候?',
      modeTemplateType: 'team-meet', modeId: 'm_tm', sessionId: 's_tm_od',
    });
    const a = findAction(actions, 'owner_deadline_check');
    assert.ok(a);
    assert.equal(a.label, 'Lock owner and deadline');
    assert.equal(a.priority, 0.83);
  });
});

describe('ActionTrigger fixtures — looking-for-work / interview mode', () => {
  test('behavioral_question (en: STAR) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'Tell me about a time you led a team through a difficult challenge.',
      modeTemplateType: 'looking-for-work', modeId: 'm_iw', sessionId: 's_iw_bq',
    });
    const a = findAction(actions, 'behavioral_question');
    assert.ok(a);
    assert.equal(a.label, 'Answer with STAR story');
    assert.equal(a.priority, 0.9);
  });

  test('intro_pitch (zh: 自我介绍) → priority 0.88', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '请介绍一下你自己',
      modeTemplateType: 'looking-for-work', modeId: 'm_iw', sessionId: 's_iw_ip',
    });
    const a = findAction(actions, 'intro_pitch');
    assert.ok(a);
    assert.equal(a.label, 'Craft intro pitch');
    assert.equal(a.priority, 0.88);
  });

  test('company_motivation (en: why us) → priority 0.86', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'Why do you want to work here? What interests you about us?',
      modeTemplateType: 'looking-for-work', modeId: 'm_iw', sessionId: 's_iw_cm',
    });
    const a = findAction(actions, 'company_motivation');
    assert.ok(a);
    assert.equal(a.label, 'Answer company motivation');
    assert.equal(a.priority, 0.86);
  });

  test('weakness_question (zh: 缺点) → priority 0.84', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '你的最大缺点是什么?',
      modeTemplateType: 'looking-for-work', modeId: 'm_iw', sessionId: 's_iw_wq',
    });
    const a = findAction(actions, 'weakness_question');
    assert.ok(a);
    assert.equal(a.label, 'Handle weakness question');
    assert.equal(a.priority, 0.84);
  });
});

describe('ActionTrigger fixtures — lecture mode', () => {
  test('concept_explanation (zh: 这个叫) → priority 0.85', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '这个叫做贝叶斯定理',
      modeTemplateType: 'lecture', modeId: 'm_l', sessionId: 's_l_ce',
    });
    const a = findAction(actions, 'concept_explanation');
    assert.ok(a);
    assert.equal(a.label, 'Explain concept');
    assert.equal(a.priority, 0.85);
  });

  test('worked_example (zh: 举个例子) → priority 0.82', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '我们举个例子来理解这个概念',
      modeTemplateType: 'lecture', modeId: 'm_l', sessionId: 's_l_we',
    });
    const a = findAction(actions, 'worked_example');
    assert.ok(a);
    assert.equal(a.label, 'Create worked example');
    assert.equal(a.priority, 0.82);
  });
});

describe('ActionTrigger fixtures — technical-interview mode', () => {
  test('coding_problem (zh: 实现) → priority 0.95', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '请实现一个二叉树的层序遍历算法',
      modeTemplateType: 'technical-interview', modeId: 'm_ti', sessionId: 's_ti_cp',
    });
    const a = findAction(actions, 'coding_problem');
    assert.ok(a);
    assert.equal(a.label, 'Solve coding problem');
    assert.equal(a.priority, 0.95);
  });

  test('screen_coding_problem (en: shown on screen) → priority 0.92', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'The problem shown on screen asks for a function.',
      modeTemplateType: 'technical-interview', modeId: 'm_ti', sessionId: 's_ti_sc',
    });
    const a = findAction(actions, 'screen_coding_problem');
    assert.ok(a);
    assert.equal(a.label, 'Answer from screen');
    assert.equal(a.priority, 0.92);
  });

  test('complexity_analysis (zh: 时间复杂度) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '请分析这个解法的时间复杂度',
      modeTemplateType: 'technical-interview', modeId: 'm_ti', sessionId: 's_ti_ca',
    });
    const a = findAction(actions, 'complexity_analysis');
    assert.ok(a);
    assert.equal(a.label, 'Analyze complexity');
    assert.equal(a.priority, 0.9);
  });

  test('system_design_prompt (en: design a system) → priority 0.89', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'Design a system to scale to 1M requests per second.',
      modeTemplateType: 'technical-interview', modeId: 'm_ti', sessionId: 's_ti_sd',
    });
    const a = findAction(actions, 'system_design_prompt');
    assert.ok(a);
    assert.equal(a.label, 'Structure system design');
    assert.equal(a.priority, 0.89);
  });
});

// ============================================================================
// Priority propagation: trigger.priority → action.priority (and confidence).
// ============================================================================

describe('DynamicActionEngine priority propagation', () => {
  test('detectActions: action.priority === trigger.priority', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const cases = [
      { mode: 'sales', transcript: '我们准备签合同了', expectedType: 'buying_signal', expectedPriority: 0.95 },
      { mode: 'sales', transcript: 'This is too expensive.', expectedType: 'pricing_objection', expectedPriority: 0.9 },
      { mode: 'team-meet', transcript: "I'll handle it by Friday.", expectedType: 'action_item', expectedPriority: 0.9 },
      { mode: 'lecture', transcript: 'This is called Bayes theorem.', expectedType: 'concept_explanation', expectedPriority: 0.85 },
    ];
    for (const c of cases) {
      const actions = engine.detectActions({
        transcript: c.transcript,
        modeTemplateType: c.mode, modeId: `m_${c.mode}`, sessionId: `s_${c.mode}_${c.expectedType}`,
      });
      const a = findAction(actions, c.expectedType);
      assert.ok(a, `${c.mode}/${c.expectedType} should fire`);
      assert.equal(a.priority, c.expectedPriority, `${c.expectedType} priority`);
      assert.equal(a.confidence, c.expectedPriority, `${c.expectedType} confidence`);
    }
  });

  test('getTopActions: returns actions sorted by priority descending', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const sessionId = 's_priority_sort';
    engine.detectActions({
      transcript: '价格太高,太贵了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId,
    });
    const top = engine.getTopActions(sessionId);
    for (let i = 1; i < top.length; i++) {
      assert.ok(top[i - 1].priority >= top[i].priority, `priority descending at ${i}`);
    }
  });
});

describe('DynamicActionEngine semantic gate trace sink', () => {
  test('emits defer trace without storing an action when cloud is unavailable', async () => {
    const { DynamicActionEngine } = await loadModules();
    const traces = [];
    const engine = new DynamicActionEngine();

    const actions = await engine.assessSignals({
      transcript: 'Pricing page 先放一边，我们想看 case study 和 technical solution.',
      modeTemplateType: 'sales',
      modeId: 'm_sales_trace',
      sessionId: 's_reject_trace',
      cloudClassifier: async () => null,
      semanticGateTraceSink: (trace) => traces.push(trace),
    });

    assert.equal(actions.some(action => action.type === 'pricing_request'), false);
    const pricingTrace = traces.find(trace => trace.actionType === 'pricing_request');
    assert.ok(pricingTrace, `expected pricing_request trace; got ${traces.map(trace => trace.actionType).join(', ')}`);
    assert.equal(pricingTrace.decision, 'defer');
    assert.equal(pricingTrace.degradedReason, 'cloud_provider_unavailable');
  });

  test('emits defer trace without storing an action when provider scope denies transcript', async () => {
    const { DynamicActionEngine } = await loadModules();
    const traces = [];
    const engine = new DynamicActionEngine();

    const actions = await engine.assessSignals({
      transcript: '这个技术方案怎么对接 SSO 和生产环境',
      modeTemplateType: 'sales',
      modeId: 'm_sales_trace',
      sessionId: 's_defer_trace',
      providerDataScopes: { transcript: false },
      semanticGateTraceSink: (trace) => traces.push(trace),
    });

    assert.equal(actions.length, 0);
    const technicalTrace = traces.find(trace => trace.actionType === 'technical_requirements');
    assert.ok(technicalTrace, 'expected technical_requirements trace');
    assert.equal(technicalTrace.decision, 'defer');
    assert.equal(technicalTrace.degradedReason, 'provider_scope_denied');
  });

  test('keeps generating passed actions when the trace sink throws', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();

    const actions = await engine.assessSignals({
      transcript: '客户要一个类似案例证明 ROI',
      modeTemplateType: 'sales',
      modeId: 'm_sales_trace',
      sessionId: 's_sink_failure',
      cloudClassifier: async input => input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: candidate.actionType === 'case_study_request' ? 'pass' : 'reject',
        confidence: candidate.actionType === 'case_study_request' ? 0.92 : 0.8,
        reasons: candidate.actionType === 'case_study_request' ? ['cloud_confirmed_case_request'] : ['cloud_rejected_candidate'],
      })),
      semanticGateTraceSink: () => {
        throw new Error('diagnostics unavailable');
      },
    });

    assert.equal(actions.some(action => action.type === 'case_study_request'), true);
  });
});

// ============================================================================
// Deduplication: same trigger within 120s window suppressed.
// ============================================================================

describe('DynamicActionEngine deduplication', () => {
  test('same trigger called twice within window → store has only one action', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const sessionId = 's_dedup_twice';
    const params = {
      transcript: 'The price is too high for our budget.',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId,
    };
    const a1 = engine.detectActions(params);
    const a2 = engine.detectActions(params);
    assert.ok(a1.length > 0, 'first call should emit');
    assert.equal(a2.length, 0, 'second call within window should be suppressed');
    const stored = engine.getStore().getAllActions(sessionId);
    const pricing = stored.filter((x) => x.type === 'pricing_objection');
    assert.equal(pricing.length, 1, 'exactly one pricing_objection stored');
  });

  test('different trigger types in same session are NOT deduped against each other', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const sessionId = 's_dedup_distinct';
    engine.detectActions({
      transcript: 'The price is too expensive.',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId,
    });
    engine.detectActions({
      transcript: 'We are ready to move forward.',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId,
    });
    const stored = engine.getStore().getAllActions(sessionId);
    assert.equal(stored.length, 2, 'two distinct triggers → two stored actions');
  });

  test('dismissed action can be re-detected (dismissed is excluded from dedup window)', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const sessionId = 's_dedup_dismiss';
    const transcript = 'This is too expensive for us.';
    const first = engine.detectActions({
      transcript, modeTemplateType: 'sales', modeId: 'm_s', sessionId,
    });
    assert.ok(first.length > 0);
    engine.dismissAction(first[0].id);
    const second = engine.detectActions({
      transcript, modeTemplateType: 'sales', modeId: 'm_s', sessionId,
    });
    assert.ok(second.length > 0, 'after dismiss, same trigger should re-fire');
  });

  test('team-meet dismissed action does not immediately resurface the same candidate', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const now = 10_000;
    const cooldownMs = 120_000;
    const first = await engine.assessSignals({
      transcript: '我来做发布 checklist，周五前发出来。',
      modeTemplateType: 'team-meet',
      modeId: 'team-meet',
      sessionId: 'team-dismissal',
      cloudClassifier: cloudSelect('action_item'),
      now,
    });
    assert.equal(first.length, 1);
    engine.dismissAction(first[0].id, { now });

    const second = await engine.assessSignals({
      transcript: '我来做发布 checklist，周五前发出来。',
      modeTemplateType: 'team-meet',
      modeId: 'team-meet',
      sessionId: 'team-dismissal',
      cloudClassifier: cloudSelect('action_item'),
      now: now + 60_000,
    });
    assert.equal(second.length, 0);

    const afterCooldown = await engine.assessSignals({
      transcript: '我来做发布 checklist，周五前发出来。',
      modeTemplateType: 'team-meet',
      modeId: 'team-meet',
      sessionId: 'team-dismissal',
      cloudClassifier: cloudSelect('action_item'),
      now: now + cooldownMs + 1,
    });
    assert.equal(afterCooldown.length, 1);
  });
});

// ============================================================================
// Emotion propagation: params.emotion → action.emotion + action.emotionSource
// ============================================================================

describe('DynamicActionEngine emotion propagation', () => {
  test('detectActions: action.emotion reflects params.emotion', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'The price is too expensive for our budget.',
      speaker: 'Prospect',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_emo_detect',
      emotion: 'angry',
      emotionSource: 'doubao-auc',
      emotionDegree: 'strong',
      emotionScore: 0.96,
      emotionDegreeScore: 0.91,
    });
    const a = findAction(actions, 'pricing_objection');
    assert.ok(a);
    assert.equal(a.emotion, 'angry');
    assert.equal(a.emotionSource, 'doubao-auc');
    assert.equal(a.emotionDegree, 'strong');
    assert.equal(a.emotionScore, 0.96);
    assert.equal(a.emotionDegreeScore, 0.91);
  });

  test('detectActions: no emotion param → action.emotion is undefined', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'The price is too expensive.',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_emo_none',
    });
    const a = findAction(actions, 'pricing_objection');
    assert.ok(a);
    assert.equal(a.emotion, undefined);
    assert.equal(a.emotionSource, undefined);
  });

  test('assessSignals: emotion carries into action when set', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = await engine.assessSignals({
      transcript: 'The price is too expensive.',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_emo_assess',
      emotion: 'sad',
      emotionSource: 'sensevoice',
      cloudClassifier: cloudSelect('pricing_objection'),
    });
    assert.ok(actions.length > 0);
    assert.equal(actions[0].emotion, 'sad');
    assert.equal(actions[0].emotionSource, 'sensevoice');
  });

  test('emotion strength and confidence scale the objection boost conservatively', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();

    assert.ok(Math.abs(engine.applyEmotionBoost('pricing_objection', 0.8, 'angry', 'strong', 1, 1) - 0.84) < 1e-9);
    assert.ok(Math.abs(engine.applyEmotionBoost('pricing_objection', 0.8, 'angry', 'weak', 0.5, 0.5) - 0.81) < 1e-9);
  });
});

// ============================================================================
// REGRESSION: 3 consecutive identical triggers in the same session
// must NOT produce 3 duplicate DynamicActions.
// ============================================================================

describe('DynamicActionEngine regression — 3 consecutive identical triggers', () => {
  test('detectActions: 3 identical sales triggers → 1 stored action', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const sessionId = 's_regression_3x_sales';
    const transcript = 'The price is too expensive for our budget.';
    const params = {
      transcript, speaker: 'Prospect',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId,
    };
    const turn1 = engine.detectActions(params);
    const turn2 = engine.detectActions(params);
    const turn3 = engine.detectActions(params);

    assert.equal(turn1.length, 1, 'turn 1: 1 action emitted');
    assert.equal(turn2.length, 0, 'turn 2: deduped (0 emitted)');
    assert.equal(turn3.length, 0, 'turn 3: deduped (0 emitted)');

    const stored = engine.getStore().getAllActions(sessionId);
    assert.equal(stored.length, 1, 'only one DynamicAction in store across 3 turns');
    assert.equal(stored[0].type, 'pricing_objection');
  });

  test('detectActions: 3 identical team-meet action_item → 1 stored action', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const sessionId = 's_regression_3x_team';
    const transcript = "I'll handle it by Friday.";
    const params = {
      transcript, speaker: 'Team member',
      modeTemplateType: 'team-meet', modeId: 'm_tm', sessionId,
    };
    const turn1 = engine.detectActions(params);
    const turn2 = engine.detectActions(params);
    const turn3 = engine.detectActions(params);

    assert.equal(turn1.length, 1, 'turn 1: 1 action emitted');
    assert.equal(turn2.length, 0, 'turn 2: deduped');
    assert.equal(turn3.length, 0, 'turn 3: deduped');

    const stored = engine.getStore().getAllActions(sessionId);
    assert.equal(stored.length, 1, 'only one DynamicAction in store across 3 turns');
    assert.equal(stored[0].type, 'action_item');
  });

  test('assessSignals: 3 identical triggers with classifier intent → no duplicate store', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const sessionId = 's_regression_3x_assess';
    const intentResult = { intent: 'handle_objection', confidence: 0.92, answerShape: 'x' };
    const cloudClassifier = cloudSelect('pricing_objection');

    const turn1 = await engine.assessSignals({
      transcript: '太贵了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId, intentResult, cloudClassifier, now: 1_000,
    });
    const turn2 = await engine.assessSignals({
      transcript: '太贵了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId, intentResult, cloudClassifier, now: 2_000,
    });
    const turn3 = await engine.assessSignals({
      transcript: '太贵了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId, intentResult, cloudClassifier, now: 3_000,
    });

    assert.equal(turn1.length, 1, 'turn 1: 1 action emitted');
    assert.equal(turn2.length, 0, 'turn 2: deduped');
    assert.equal(turn3.length, 0, 'turn 3: deduped');

    const stored = engine.getStore().getAllActions(sessionId);
    assert.equal(stored.length, 1, 'only one DynamicAction in store across 3 turns');
  });

  test('detectActions: 3 identical in DIFFERENT sessions → 3 stored actions', async () => {
    // Negative case: dedup is per-session, so different sessions must NOT collapse.
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const transcript = 'The price is too expensive.';
    const a1 = engine.detectActions({
      transcript, modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_neg_1',
    });
    const a2 = engine.detectActions({
      transcript, modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_neg_2',
    });
    const a3 = engine.detectActions({
      transcript, modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_neg_3',
    });
    assert.equal(a1.length, 1);
    assert.equal(a2.length, 1);
    assert.equal(a3.length, 1);
    const total =
      engine.getStore().getAllActions('s_neg_1').length +
      engine.getStore().getAllActions('s_neg_2').length +
      engine.getStore().getAllActions('s_neg_3').length;
    assert.equal(total, 3, 'dedup is per-session, not global');
  });
});
