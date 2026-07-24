import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(path.join(
  process.cwd(),
  'dist-electron/electron/services/dynamic-actions/DynamicActionContinuation.js',
)).href;

test('only completed sales capability discovery resolves continuation policy', async () => {
  const { resolveDynamicActionContinuationPolicy } = await import(moduleUrl);
  const base = { type: 'discovery_question', modeTemplateType: 'sales', status: 'completed' };

  assert.deepEqual(resolveDynamicActionContinuationPolicy({ ...base, sourceIntent: 'sales_capability_fit' }), {
    goal: 'answer_when_grounded',
    answerActionType: 'capability_fit_answer',
    observedSpeaker: 'interviewer',
    maxPlannerAttempts: 3,
    expiresAfterCustomerTurns: 6,
    expiresAfterMs: 300_000,
    parentActionTypes: new Set(['discovery_question']),
    sourceIntents: new Set(['sales_capability_fit', 'sales_contextual_proof_discovery']),
  });
  assert.ok(resolveDynamicActionContinuationPolicy({ ...base, sourceIntent: 'sales_contextual_proof_discovery' }));
  assert.equal(resolveDynamicActionContinuationPolicy({ ...base, sourceIntent: 'sales_pain_discovery' }), null);
  assert.equal(resolveDynamicActionContinuationPolicy({ ...base, status: 'accepted', sourceIntent: 'sales_capability_fit' }), null);
  assert.equal(resolveDynamicActionContinuationPolicy({ ...base, modeTemplateType: 'fde', sourceIntent: 'sales_capability_fit' }), null);
});

test('continuation state machine rejects terminal rollback', async () => {
  const { transitionContinuationState } = await import(moduleUrl);
  assert.equal(transitionContinuationState('pending', 'planning'), 'planning');
  assert.equal(transitionContinuationState('planning', 'ready'), 'ready');
  assert.equal(transitionContinuationState('ready', 'emitted'), 'emitted');
  assert.throws(() => transitionContinuationState('emitted', 'pending'), /invalid_continuation_transition/);
  assert.equal(transitionContinuationState('pending', 'cancelled'), 'cancelled');
});
