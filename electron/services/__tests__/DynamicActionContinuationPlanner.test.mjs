import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadPlanner() {
  return import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionContinuationPlanner.js',
  )).href);
}

function plannerInput() {
  return {
    modeTemplateType: 'sales',
    sourceIntent: 'sales_capability_fit',
    originalTurn: '是否适合电池包冷却液流道？',
    keyEntities: ['电池包'],
    collectedCustomerTurns: [{ text: '关注压降和温升', timestamp: 1 }],
    currentTurn: { text: '关注压降和温升', timestamp: 1 },
    providerDataScopes: { transcript: true },
  };
}

test('planner accepts only the closed decision schema', async () => {
  const { DynamicActionContinuationPlanner } = await loadPlanner();
  const planner = new DynamicActionContinuationPlanner(async () => JSON.stringify({
    decision: 'trigger_grounded_answer',
    confidence: 0.91,
    extractedSlots: { object: '电池包冷却液流道', metrics: ['压降', '温升'] },
    reasonCode: 'sufficient_customer_detail',
  }));
  const result = await planner.decide(plannerInput());
  assert.equal(result.decision, 'trigger_grounded_answer');
  assert.deepEqual(result.extractedSlots.metrics, ['压降', '温升']);
});

test('planner rejects visible answer fields and invalid JSON', async () => {
  const { DynamicActionContinuationPlanner } = await loadPlanner();
  await assert.rejects(
    () => new DynamicActionContinuationPlanner(async () => '{bad').decide(plannerInput()),
    (error) => error.reason === 'planner_invalid_json',
  );
  await assert.rejects(
    () => new DynamicActionContinuationPlanner(async () => JSON.stringify({
      decision: 'trigger_grounded_answer',
      confidence: 0.9,
      extractedSlots: {},
      reasonCode: 'sufficient_customer_detail',
      answer: '我们支持',
    })).decide(plannerInput()),
    (error) => error.reason === 'planner_invalid_json',
  );
});

test('planner rejects unknown or malformed extracted slots', async () => {
  const { DynamicActionContinuationPlanner } = await loadPlanner();
  const invalidSlots = [
    { metrics: '压降' },
    { systemObjects: ['BOM', 42] },
    { object: 42 },
    { object: 'x'.repeat(241) },
    { unknownSlot: 'value' },
  ];
  for (const extractedSlots of invalidSlots) {
    await assert.rejects(
      () => new DynamicActionContinuationPlanner(async () => JSON.stringify({
        decision: 'trigger_grounded_answer',
        confidence: 0.9,
        extractedSlots,
        reasonCode: 'sufficient_customer_detail',
      })).decide(plannerInput()),
      (error) => error.reason === 'planner_invalid_json',
    );
  }
});

test('planner enforces transcript scope at its provider boundary', async () => {
  const { DynamicActionContinuationPlanner } = await loadPlanner();
  let calls = 0;
  const planner = new DynamicActionContinuationPlanner(async () => {
    calls += 1;
    return '{}';
  });
  await assert.rejects(
    () => planner.decide({ ...plannerInput(), providerDataScopes: { transcript: false } }),
    (error) => error.reason === 'provider_scope_denied',
  );
  assert.equal(calls, 0);
});
