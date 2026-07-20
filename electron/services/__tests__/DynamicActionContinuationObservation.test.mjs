import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function registeredService(planner) {
  const { DynamicActionContinuationService } = await import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionContinuationService.js',
  )).href);
  const service = new DynamicActionContinuationService({ planner, now: () => 1_000 });
  service.registerCompletedAction({
    id: 'parent-1',
    sessionId: 'session-1',
    modeId: 'sales',
    modeTemplateType: 'sales',
    type: 'discovery_question',
    label: '追问',
    status: 'completed',
    sourceIntent: 'sales_capability_fit',
    latestTurn: '是否支持流体仿真？',
    evidenceRefs: [],
    keyEntities: [],
    createdAt: 1,
    productContract: { outputType: 'spoken_response' },
    confidence: 0.9,
    priority: 0.9,
    promptInstruction: '',
  });
  return service;
}

async function emptyService(planner = { decide: async () => readyResult() }) {
  const { DynamicActionContinuationService } = await import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionContinuationService.js',
  )).href);
  return new DynamicActionContinuationService({ planner, now: () => 1_000 });
}

function completedAction(overrides = {}) {
  return {
    id: overrides.id ?? 'parent-1',
    sessionId: overrides.sessionId ?? 'session-1',
    modeId: overrides.modeId ?? 'sales',
    modeTemplateType: overrides.modeTemplateType ?? 'sales',
    type: overrides.type ?? 'discovery_question',
    label: overrides.label ?? '追问',
    status: overrides.status ?? 'completed',
    sourceIntent: overrides.sourceIntent ?? 'sales_capability_fit',
    latestTurn: overrides.latestTurn ?? '是否支持流体仿真？',
    evidenceRefs: overrides.evidenceRefs ?? [],
    keyEntities: overrides.keyEntities ?? [],
    createdAt: 1,
    productContract: { outputType: 'spoken_response' },
    confidence: 0.9,
    priority: 0.9,
    promptInstruction: '',
    ...overrides,
  };
}

function turn(overrides = {}) {
  return {
    sessionId: 'session-1',
    modeId: 'sales',
    modeTemplateType: 'sales',
    speaker: 'interviewer',
    text: '对象是电池包冷却液流道',
    timestamp: 1,
    providerDataScopes: { transcript: true },
    ...overrides,
  };
}

const collectingResult = () => ({
  decision: 'continue_collecting',
  confidence: 0.7,
  extractedSlots: {},
  reasonCode: 'insufficient_customer_detail',
  decisionSource: 'continuation_planner',
});

test('completed FDE parent actions register continuations', async () => {
  const fdeParents = [
    'fde_discovery_probe',
    'fde_risk_blocker',
    'fde_agent_feasibility',
    'fde_success_criteria',
    'fde_next_step',
    'fde_integration_check',
    'fde_security_review',
  ];
  for (const parentActionType of fdeParents) {
    const service = await emptyService();
    const record = service.registerCompletedAction(completedAction({
      id: `parent-${parentActionType}`,
      modeId: 'fde',
      modeTemplateType: 'fde',
      type: parentActionType,
      sourceIntent: 'fde_discovery',
      latestTurn: '客户在讨论 ECO 变更审批流程和质量经理人审点。',
    }));
    assert.ok(record, `${parentActionType} should register`);
    assert.equal(record.modeTemplateType, 'fde');
    assert.equal(record.parentActionType, parentActionType);
    assert.equal(record.sourceIntent, 'fde_discovery');
  }
});

test('FDE continuation registration rejects non-completed and unsupported parent actions', async () => {
  const service = await emptyService();
  assert.equal(service.registerCompletedAction(completedAction({
    modeId: 'fde',
    modeTemplateType: 'fde',
    type: 'fde_discovery_probe',
    sourceIntent: 'fde_discovery',
    status: 'generated_failed',
  })), null);
  assert.equal(service.registerCompletedAction(completedAction({
    id: 'unsupported-fde-parent',
    modeId: 'fde',
    modeTemplateType: 'fde',
    type: 'fde_grounded_answer',
    sourceIntent: 'fde_discovery',
  })), null);
});

test('sales continuation registration remains sales-only discovery behavior', async () => {
  const service = await emptyService();
  const record = service.registerCompletedAction(completedAction());
  assert.ok(record);
  assert.equal(record.modeTemplateType, 'sales');
  assert.equal(record.parentActionType, 'discovery_question');
  assert.equal(service.registerCompletedAction(completedAction({
    id: 'sales-non-discovery',
    type: 'buying_signal',
    sourceIntent: 'sales_buying_signal',
  })), null);
});

test('completed recruiting evidence probe observes only the configured counterpart speaker', async () => {
  let calls = 0;
  const service = await emptyService({ decide: async () => { calls += 1; return readyResult(); } });
  const record = service.registerCompletedAction(completedAction({
    modeId: 'recruiting',
    modeTemplateType: 'recruiting',
    type: 'candidate_experience_probe',
    sourceIntent: 'recruiting_bei_evidence_gap',
    latestTurn: '请补充你个人采取的行动。',
  }));
  assert.ok(record);
  assert.equal(record.observedSpeaker, 'interviewer');

  const recruiterTurn = await service.observeFinalCustomerTurn(turn({
    modeId: 'recruiting',
    modeTemplateType: 'recruiting',
    speaker: 'user',
    text: '请补充你个人采取的行动。',
    timestamp: 1,
  }));
  assert.equal(recruiterTurn.kind, 'none');
  assert.equal(recruiterTurn.reasonCode, 'speaker_mismatch');
  assert.equal(calls, 0);
  assert.equal(service.getActiveForSession('session-1').plannerAttempts, 0);
  assert.equal(service.getActiveForSession('session-1').observedCustomerTurns, 0);

  const candidateTurn = await service.observeFinalCustomerTurn(turn({
    modeId: 'recruiting',
    modeTemplateType: 'recruiting',
    speaker: 'interviewer',
    text: '我负责灰度方案，事故率下降了 30%。',
    timestamp: 2,
  }));
  assert.equal(candidateTurn.kind, 'ready');
  assert.equal(calls, 1);
});

test('recruiting candidate concern does not register a continuation', async () => {
  const service = await emptyService();
  assert.equal(service.registerCompletedAction(completedAction({
    modeId: 'recruiting',
    modeTemplateType: 'recruiting',
    type: 'candidate_concern',
    sourceIntent: 'recruiting_policy_concern',
  })), null);
});

test('FDE planner accepts process-first slots and rejects unexpected slot keys', async () => {
  const { parseContinuationSlots } = await import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionContinuationPlanner.js',
  )).href);
  const slots = parseContinuationSlots({
    asIsProcess: 'ECO 由研发提交后质量审批',
    processObject: 'ECO',
    roles: ['研发', '质量'],
    humanConfirmation: '质量经理签核',
    aiSupportNeed: '检查变更材料是否缺字段',
    validationNeed: '用 3 条真实 ECO 验证',
  }, 'fde');
  assert.equal(slots.asIsProcess, 'ECO 由研发提交后质量审批');
  assert.deepEqual(slots.roles, ['研发', '质量']);
  assert.throws(
    () => parseContinuationSlots({ object: 'sales-only slot' }, 'fde'),
    /planner_invalid_json/,
  );
});

test('sales planner slot parsing remains compatible', async () => {
  const { parseContinuationSlots } = await import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionContinuationPlanner.js',
  )).href);
  const slots = parseContinuationSlots({
    object: '电池包冷却液流道',
    metrics: ['压降', '温升'],
  });
  assert.equal(slots.object, '电池包冷却液流道');
  assert.deepEqual(slots.metrics, ['压降', '温升']);
});

test('recruiting planner accepts evidence slots and rejects unexpected keys', async () => {
  const { parseContinuationSlots } = await import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionContinuationPlanner.js',
  )).href);
  const slots = parseContinuationSlots({
    scorecardDimension: '事故响应与风险控制',
    evidenceObserved: '候选人负责灰度方案并将事故率降低 30%',
    missingEvidence: ['个人 ownership', '风险取舍'],
    starMissing: ['situation', 'task'],
    candidateClaim: '我负责灰度方案',
    riskToVerify: '需验证事故率指标的统计口径',
    recommendedProbe: '请说明你如何权衡上线速度和事故风险。',
  }, 'recruiting');
  assert.equal(slots.scorecardDimension, '事故响应与风险控制');
  assert.deepEqual(slots.missingEvidence, ['个人 ownership', '风险取舍']);
  assert.deepEqual(slots.starMissing, ['situation', 'task']);
  assert.throws(
    () => parseContinuationSlots({ object: 'sales-only slot' }, 'recruiting'),
    /planner_invalid_json/,
  );
});

const readyResult = () => ({
  decision: 'trigger_grounded_answer',
  confidence: 0.92,
  extractedSlots: { object: '电池包冷却液流道', metrics: ['压降', '温升'] },
  reasonCode: 'sufficient_customer_detail',
  decisionSource: 'continuation_planner',
});

test('scope denied and non-customer speakers never call planner', async () => {
  let calls = 0;
  const service = await registeredService({ decide: async () => { calls += 1; return readyResult(); } });
  const denied = await service.observeFinalCustomerTurn(turn({ providerDataScopes: { transcript: false } }));
  assert.equal(denied.kind, 'degraded');
  assert.equal(denied.reasonCode, 'provider_scope_denied');
  assert.equal(calls, 0);
  assert.equal(service.getActiveForSession('session-1').observedCustomerTurns, 1);
});

test('coalesces one latest turn while planner is in flight and rejects stale result', async () => {
  const resolvers = [];
  const service = await registeredService({ decide: () => new Promise((resolve) => resolvers.push(resolve)) });
  const first = service.observeFinalCustomerTurn(turn({ text: '对象是电池包流道' }));
  await service.observeFinalCustomerTurn(turn({ text: '指标是压降和温升', timestamp: 2 }));
  assert.equal(resolvers.length, 1);
  resolvers.shift()(collectingResult());
  await Promise.resolve();
  assert.equal(resolvers.length, 1);
  service.cancelForContext('session-1');
  resolvers.shift()(readyResult());
  await first;
  assert.equal(service.getActiveForSession('session-1'), null);
});

test('does not emit an old ready result when a newer customer turn is queued', async () => {
  const resolvers = [];
  const service = await registeredService({ decide: () => new Promise((resolve) => resolvers.push(resolve)) });
  const outcomePromise = service.observeFinalCustomerTurn(turn({ text: '对象是电池包流道' }));
  await service.observeFinalCustomerTurn(turn({ text: '这个话题先不谈了', timestamp: 2 }));
  resolvers.shift()(readyResult());
  await Promise.resolve();
  assert.equal(resolvers.length, 1);
  resolvers.shift()({
    decision: 'ignore',
    confidence: 0.95,
    extractedSlots: {},
    reasonCode: 'unrelated_turn',
    decisionSource: 'continuation_planner',
  });
  const outcome = await outcomePromise;
  assert.equal(outcome.kind, 'collecting');
  assert.equal(outcome.plannerResult.decision, 'ignore');
  assert.equal(service.getActiveForSession('session-1').state, 'pending');
});

test('scope-denied queued turn invalidates old ready without another planner call', async () => {
  const resolvers = [];
  let calls = 0;
  const service = await registeredService({ decide: () => {
    calls += 1;
    return new Promise((resolve) => resolvers.push(resolve));
  } });
  const outcomePromise = service.observeFinalCustomerTurn(turn({ text: '对象是电池包流道' }));
  const denied = await service.observeFinalCustomerTurn(turn({
    text: '还需要看温升',
    timestamp: 2,
    providerDataScopes: { transcript: false },
  }));
  assert.equal(denied.reasonCode, 'provider_scope_denied');
  resolvers.shift()(readyResult());
  const outcome = await outcomePromise;
  assert.equal(outcome.kind, 'degraded');
  assert.equal(outcome.reasonCode, 'provider_scope_denied');
  assert.equal(calls, 1);
});
