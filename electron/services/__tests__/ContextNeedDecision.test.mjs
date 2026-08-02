import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(path.join(
  process.cwd(),
  'dist-electron/electron/services/context/ContextNeedDecision.js',
)).href;

test('candidate concern requires recruiting material but candidate evidence summary does not', async () => {
  const { buildDynamicActionContextNeedDecision } = await import(moduleUrl);
  const concern = buildDynamicActionContextNeedDecision({
    type: 'candidate_concern',
    label: '回应候选人政策问题',
    modeTemplateType: 'recruiting',
    confidence: 0.9,
  });
  assert.equal(concern.material, 'required');
  assert.equal(concern.business, 'not_needed');

  const summary = buildDynamicActionContextNeedDecision({
    type: 'candidate_evidence_summary',
    label: '总结候选人证据',
    modeTemplateType: 'recruiting',
    confidence: 0.9,
  });
  assert.equal(summary.material, 'not_needed');
  assert.equal(summary.business, 'not_needed');
  assert.equal(summary.screen, 'not_needed');
});

test('dynamic action context decision is driven by action type rather than PLM/BOM evidence text', async () => {
  const { buildDynamicActionContextNeedDecision } = await import(moduleUrl);

  const businessQuery = buildDynamicActionContextNeedDecision({
    type: 'business_system_query',
    label: '查询业务系统状态',
    modeTemplateType: 'fde',
    confidence: 0.9,
    evidenceRefs: [{ source: 'transcript', text: '查一下 PLM 里 golf car 的 BOM 发布了没有' }],
  });
  assert.equal(businessQuery.business, 'required');
  assert.equal(businessQuery.material, 'not_needed');

  const integration = buildDynamicActionContextNeedDecision({
    type: 'fde_integration_check',
    label: '锁定集成、权限和读写边界',
    modeTemplateType: 'fde',
    confidence: 0.9,
    evidenceRefs: [{ source: 'transcript', text: 'PLM 里 BOM 流程比较复杂，我们先讨论接口边界。' }],
  });
  assert.equal(integration.business, 'not_needed');
  assert.equal(integration.material, 'use_if_ready');
});

test('first-class visible action types have non-unknown context decisions', async () => {
  const { buildDynamicActionContextNeedDecision, UNKNOWN_CONTEXT_NEED_DECISION } = await import(moduleUrl);
  const actionTypes = [
    'business_system_query',
    'capability_fit_answer',
    'case_study_request',
    'candidate_concern',
    'fde_grounded_answer',
    'fde_integration_check',
    'fde_security_review',
    'technical_requirements',
    'discovery_question',
    'action_item',
    'decision_point',
    'blocker_check',
    'owner_deadline_check',
    'candidate_experience_probe',
    'candidate_evidence_summary',
  ];

  for (const type of actionTypes) {
    const decision = buildDynamicActionContextNeedDecision({
      type,
      label: type,
      modeTemplateType: 'sales',
      confidence: 0.91,
    });
    assert.notDeepEqual(decision, UNKNOWN_CONTEXT_NEED_DECISION, type);
    assert.notEqual(decision.material, 'unknown', type);
    assert.notEqual(decision.business, 'unknown', type);
    assert.notEqual(decision.screen, 'unknown', type);
  }
});
