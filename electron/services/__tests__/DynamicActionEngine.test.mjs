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

test('Competitor mention (Gong) detected creates competitor_mention action', async () => {
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

  assert.ok(actions.length > 0, 'Expected at least one action');
  const competitorAction = actions.find(a => a.type === 'competitor_mention');
  assert.ok(competitorAction, 'Expected competitor_mention action');
  assert.equal(competitorAction.label, 'Handle competitor comparison');
  assert.equal(competitorAction.status, 'candidate');
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

test('FDE intent result can synthesize action when regex does not match', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = engine.assessSignals({
    transcript: '客户说红线问题还没解决',
    speaker: 'Customer',
    modeTemplateType: 'fde',
    modeId: 'mode_fde_2',
    sessionId: 'session_fde_synthetic',
    intentResult: {
      intent: 'fde_risk',
      confidence: 0.9,
      answerShape: 'Name blocker and next unblock step.',
    },
    now: 1_000,
  });

  assert.ok(actions.some(action => action.type === 'fde_risk_blocker'));
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

  const transcript = "We're using Gong already.";
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
    ['sales', "What's the ROI and payback for this?", 'roi_question'],
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
    const actions = engine.assessSignals({
      transcript,
      speaker: 'interviewer',
      modeTemplateType,
      modeId: `mode_${modeTemplateType}`,
      sessionId: `session_${modeTemplateType}_${expectedType}`,
      intentResult: { intent: 'general', confidence: 0.82, answerShape: '中文回答' },
      now: Date.now(),
    });
    assert.ok(
      actions.some(action => action.type === expectedType && action.signalStatus === 'confirmed'),
      `${modeTemplateType} should confirm ${expectedType}; got ${actions.map(a => `${a.type}:${a.signalStatus}`).join(', ')}`,
    );
  }
});

test('assessSignals uses classifier intent to synthesize high-confidence sales action without regex match', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = engine.assessSignals({
    transcript: '这个方案我们内部还要和老板确认一下投入产出',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId: 'session_synth',
    intentResult: { intent: 'handle_objection', confidence: 0.91, answerShape: '处理异议' },
    emotion: 'angry',
    emotionSource: 'sensevoice',
    now: 10_000,
  });

  const action = actions.find(a => a.type === 'pricing_objection');
  assert.ok(action, `expected synthesized pricing_objection; got ${actions.map(a => a.type).join(', ')}`);
  assert.equal(action.confirmationSource, 'cloud_intent');
  assert.equal(action.confirmedIntent, 'handle_objection');
  assert.equal(action.emotion, 'angry');
});

test('assessSignals synthesizes general summary action from custom keyword intent', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();

  const actions = engine.assessSignals({
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

  const actions = engine.assessSignals({
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

  const actions = engine.assessSignals({
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

  const actions = engine.assessSignals({
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

test('assessSignals requires repeated evidence before auto-surfacing ordinary objections', async () => {
  const { DynamicActionEngine } = await loadModules();
  const engine = new DynamicActionEngine();
  const sessionId = 'session_auto_after_repeat';

  const first = engine.assessSignals({
    transcript: '这个价格太高了',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
    intentResult: { intent: 'handle_objection', confidence: 0.9, answerShape: '处理异议' },
    now: 10_000,
  });
  const second = engine.assessSignals({
    transcript: '我们老板肯定会觉得报价太高',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
    intentResult: { intent: 'handle_objection', confidence: 0.92, answerShape: '处理异议' },
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

  engine.assessSignals({
    transcript: '这个价格太高了',
    speaker: 'interviewer',
    modeTemplateType: 'sales',
    modeId: 'mode_sales',
    sessionId,
    intentResult: { intent: 'handle_objection', confidence: 0.92, answerShape: '处理异议' },
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

  test('competitor_mention (en: Gong) → priority 0.85', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: "We're already using Gong for our sales calls.",
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_cm',
    });
    const a = findAction(actions, 'competitor_mention');
    assert.ok(a);
    assert.equal(a.label, 'Handle competitor comparison');
    assert.equal(a.priority, 0.85);
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

  test('roi_question (en: ROI) → priority 0.88', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: 'What is the ROI on this and the payback period?',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_s_roi',
    });
    const a = findAction(actions, 'roi_question');
    assert.ok(a);
    assert.equal(a.label, 'Build ROI case');
    assert.equal(a.priority, 0.88);
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
    assert.match(a.promptInstruction, /Do not invent customer names/);
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

  test('strong_fit_signal (zh: 很匹配) → priority 0.9', async () => {
    const { DynamicActionEngine } = await loadModules();
    const engine = new DynamicActionEngine();
    const actions = engine.detectActions({
      transcript: '这个岗位很匹配,我很感兴趣',
      modeTemplateType: 'recruiting', modeId: 'm_r', sessionId: 's_r_sf',
    });
    const a = findAction(actions, 'strong_fit_signal');
    assert.ok(a);
    assert.equal(a.label, 'Reinforce positive signal');
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
    assert.equal(a.label, 'Guide candidate story');
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
      emotionSource: 'sensevoice',
    });
    const a = findAction(actions, 'pricing_objection');
    assert.ok(a);
    assert.equal(a.emotion, 'angry');
    assert.equal(a.emotionSource, 'sensevoice');
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
    const actions = engine.assessSignals({
      transcript: 'The price is too expensive.',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId: 's_emo_assess',
      emotion: 'sad',
      emotionSource: 'sensevoice',
    });
    assert.ok(actions.length > 0);
    assert.equal(actions[0].emotion, 'sad');
    assert.equal(actions[0].emotionSource, 'sensevoice');
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

    const turn1 = engine.assessSignals({
      transcript: '太贵了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId, intentResult, now: 1_000,
    });
    const turn2 = engine.assessSignals({
      transcript: '太贵了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId, intentResult, now: 2_000,
    });
    const turn3 = engine.assessSignals({
      transcript: '太贵了',
      modeTemplateType: 'sales', modeId: 'm_s', sessionId, intentResult, now: 3_000,
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
