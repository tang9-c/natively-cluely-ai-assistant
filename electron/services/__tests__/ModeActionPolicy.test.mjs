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
  test('dynamic-card target modes are fail-closed and share one exclusive group per mode', async () => {
    const { getActionGatePolicy } = await loadPolicy();
    const fixtures = [
      ['sales', ['pricing_objection', 'pricing_request', 'case_study_request', 'discovery_question', 'technical_requirements', 'buying_signal'], 'sales_live_assist'],
      ['fde', ['fde_discovery_probe', 'fde_integration_check', 'fde_security_review', 'fde_risk_blocker', 'fde_agent_feasibility', 'fde_success_criteria', 'fde_next_step'], 'fde_live_assist'],
      ['recruiting', ['candidate_concern', 'candidate_experience_probe', 'strong_fit_signal'], 'recruiting_live_assist'],
      ['team-meet', ['action_item', 'decision_point', 'blocker_check', 'owner_deadline_check'], 'team_meet_live_assist'],
    ];
    for (const [mode, actionTypes, exclusiveGroup] of fixtures) {
      for (const actionType of actionTypes) {
        const actionPolicy = getActionGatePolicy(mode, actionType);
        assert.equal(actionPolicy.allowLocalFallbackOnCloudFailure, false, `${mode}:${actionType}`);
        assert.equal(actionPolicy.exclusiveGroup, exclusiveGroup, `${mode}:${actionType}`);
        assert.ok(Number.isFinite(actionPolicy.selectionPriority), `${mode}:${actionType}`);
      }
    }
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
    assert.equal(getActionGatePolicy('sales', 'pricing_request').localFallbackEvidence.length, 0);
    assert.equal(getActionGatePolicy('sales', 'case_study_request').localFallbackEvidence.length, 0);
    assert.ok(getActionGatePolicy('technical-interview', 'screen_coding_problem').localFallbackEvidence.length > 0);
  });
});

test('recruiting live-assist policies require cloud evidence and share exclusive arbitration', async () => {
  const { getActionGatePolicy } = await loadPolicy();
  const concern = getActionGatePolicy('recruiting', 'candidate_concern');
  const probe = getActionGatePolicy('recruiting', 'candidate_experience_probe');
  const interest = getActionGatePolicy('recruiting', 'strong_fit_signal');

  assert.equal(concern.riskLevel, 'high');
  assert.equal(concern.gateStrategy, 'required');
  assert.equal(concern.allowLocalFallbackOnCloudFailure, false);
  assert.deepEqual(concern.requiredEvidence, [
    'counterpart explicitly asks or expresses concern about recruiting policy',
    'policy category is compensation, visa, remote work, relocation, offer, level, or start date',
  ]);
  assert.equal(concern.exclusiveGroup, 'recruiting_live_assist');
  assert.equal(concern.selectionPriority, 100);
  assert.equal(probe.exclusiveGroup, 'recruiting_live_assist');
  assert.equal(probe.selectionPriority, 80);
  assert.equal(interest.exclusiveGroup, 'recruiting_live_assist');
  assert.equal(interest.selectionPriority, 60);
});
