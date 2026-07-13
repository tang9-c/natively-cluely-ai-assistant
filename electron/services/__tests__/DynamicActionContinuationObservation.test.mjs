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
