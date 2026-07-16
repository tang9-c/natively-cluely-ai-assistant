import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadPolicy() {
  return import(pathToFileURL(path.join(root, 'dist-electron/electron/services/dynamic-actions/ModeActionPolicy.js')).href);
}

async function loadTriggers() {
  return import(pathToFileURL(path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionDetector.js')).href);
}

describe('ModeActionPolicy', () => {
  test('sales and FDE high-risk policies are explicit', async () => {
    const { getActionGatePolicy } = await loadPolicy();
    assert.equal(getActionGatePolicy('sales', 'case_study_request').riskLevel, 'high');
    assert.equal(getActionGatePolicy('sales', 'case_study_request').gateStrategy, 'required');
    assert.equal(getActionGatePolicy('sales', 'case_study_request').allowLocalFallbackOnCloudFailure, false);
    assert.equal(getActionGatePolicy('sales', 'pricing_request').allowLocalFallbackOnCloudFailure, true);
    assert.equal(getActionGatePolicy('fde', 'fde_security_review').riskLevel, 'high');
    assert.equal(getActionGatePolicy('fde', 'fde_security_review').allowLocalFallbackOnCloudFailure, false);
  });

  test('mode aliases resolve to first-class mode policies', async () => {
    const { getActionGatePolicy, normalizeModeTemplateType } = await loadPolicy();
    assert.equal(normalizeModeTemplateType('team_meeting'), 'team-meet');
    assert.equal(normalizeModeTemplateType('interview'), 'looking-for-work');
    assert.equal(normalizeModeTemplateType('technical_interview'), 'technical-interview');
    assert.deepEqual(
      getActionGatePolicy('team_meeting', 'action_item'),
      getActionGatePolicy('team-meet', 'action_item'),
    );
  });

  test('all active trigger actions have policy coverage and negotiation is legacy only', async () => {
    const { MODE_TRIGGERS } = await loadTriggers();
    const { getActionGatePolicy, FIRST_CLASS_MODE_TEMPLATE_TYPES } = await loadPolicy();
    assert.deepEqual(FIRST_CLASS_MODE_TEMPLATE_TYPES, [
      'general',
      'sales',
      'fde',
      'recruiting',
      'team-meet',
      'looking-for-work',
      'technical-interview',
      'lecture',
    ]);
    for (const mode of FIRST_CLASS_MODE_TEMPLATE_TYPES) {
      for (const trigger of MODE_TRIGGERS[mode] ?? []) {
        const policy = getActionGatePolicy(mode, trigger.type);
        assert.equal(policy.actionType, trigger.type, `${mode}:${trigger.type}`);
        assert.ok(['high', 'medium', 'low'].includes(policy.riskLevel), `${mode}:${trigger.type}`);
      }
    }
    const negotiation = getActionGatePolicy('negotiation', 'price_pushback');
    assert.equal(negotiation.riskLevel, 'medium');
    assert.equal(FIRST_CLASS_MODE_TEMPLATE_TYPES.includes('negotiation'), false);
  });

  test('local fallback evidence is present only when local fallback is allowed', async () => {
    const { getActionGatePolicy } = await loadPolicy();
    assert.ok(getActionGatePolicy('sales', 'pricing_request').localFallbackEvidence.length > 0);
    assert.equal(getActionGatePolicy('sales', 'case_study_request').localFallbackEvidence.length, 0);
    assert.ok(getActionGatePolicy('technical-interview', 'screen_coding_problem').localFallbackEvidence.length > 0);
  });
});
