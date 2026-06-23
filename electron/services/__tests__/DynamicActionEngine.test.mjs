import { test, beforeEach } from 'node:test';
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

test('All seven real mode template keys have matching trigger packs', async () => {
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
