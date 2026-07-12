import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const helperPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductContract.js');

async function loadHelper() {
  return import(pathToFileURL(helperPath).href);
}

function baseInput(overrides = {}) {
  return {
    type: 'pricing_objection',
    label: 'Handle pricing objection',
    modeTemplateType: 'sales',
    confidence: 0.84,
    autoSurfacePolicy: 'card',
    evidenceRefs: [{ source: 'transcript', text: 'The price is too expensive for our current budget.' }],
    answerStyle: { maxWords: 90, format: 'short_script', tone: 'calm' },
    ...overrides,
  };
}

test('maps dynamic action output types conservatively', async () => {
  const { buildDynamicActionProductContract } = await loadHelper();

  assert.equal(buildDynamicActionProductContract(baseInput()).outputType, 'spoken_response');
  assert.equal(buildDynamicActionProductContract(baseInput({ type: 'fde_integration_check', modeTemplateType: 'fde' })).outputType, 'checklist');
  assert.equal(buildDynamicActionProductContract(baseInput({ answerStyle: { maxWords: 120, format: 'email', tone: 'clear' } })).outputType, 'email_draft');
  assert.equal(buildDynamicActionProductContract(baseInput({ type: 'pricing_request', label: 'Draft quote email' })).outputType, 'email_draft');
  assert.equal(buildDynamicActionProductContract(baseInput({ type: 'action_item', modeTemplateType: 'team-meet' })).outputType, 'action_item');
  assert.equal(buildDynamicActionProductContract(baseInput({ type: 'decision_point', modeTemplateType: 'team-meet' })).outputType, 'decision_record');
  assert.equal(buildDynamicActionProductContract(baseInput({ type: 'unknown_action', label: 'Unknown action' })).outputType, 'spoken_response');
});

test('email answer style wins before type fallback', async () => {
  const { buildDynamicActionProductContract } = await loadHelper();

  const contract = buildDynamicActionProductContract(baseInput({
    type: 'decision_point',
    modeTemplateType: 'team-meet',
    answerStyle: { maxWords: 120, format: 'email', tone: 'polite' },
  }));

  assert.equal(contract.outputType, 'email_draft');
  assert.equal(contract.outputPromise, '生成一封可发送的邮件草稿');
});

test('risk state only exposes visible states', async () => {
  const { buildDynamicActionProductContract, VISIBLE_DYNAMIC_ACTION_RISK_STATES } = await loadHelper();

  assert.deepEqual(VISIBLE_DYNAMIC_ACTION_RISK_STATES, ['auto_countdown', 'normal']);
  assert.equal(buildDynamicActionProductContract(baseInput({ confidence: 0.95, autoSurfacePolicy: 'auto' })).riskState, 'auto_countdown');
  assert.equal(buildDynamicActionProductContract(baseInput({ confidence: 0.95, autoSurfacePolicy: 'silent' })).riskState, 'normal');
});

test('evidence summary is omitted when empty and truncated when long', async () => {
  const { buildDynamicActionProductContract } = await loadHelper();

  assert.equal(buildDynamicActionProductContract(baseInput({ evidenceRefs: [] })).evidenceSummary, undefined);
  assert.equal(buildDynamicActionProductContract(baseInput({ evidenceRefs: [{ source: 'transcript', text: '   ' }] })).evidenceSummary, undefined);

  const longText = '客户说价格太高, 还担心集成需要两周以上, 希望先确认安全评审、负责人、截止时间和验收标准。'.repeat(3);
  const contract = buildDynamicActionProductContract(baseInput({ evidenceRefs: [{ source: 'transcript', text: longText }] }));
  assert.ok(contract.evidenceSummary.length <= 91);
  assert.ok(contract.evidenceSummary.endsWith('…'));
});

test('fde ai agent contract copy keeps human confirmation and no-auto-write boundary visible', async () => {
  const { buildDynamicActionProductContract } = await loadHelper();

  const contract = buildDynamicActionProductContract(baseInput({
    type: 'fde_agent_feasibility',
    label: 'Assess AI Agent feasibility',
    modeTemplateType: 'fde',
    answerStyle: { maxWords: 120, format: 'checklist', tone: 'conservative' },
  }));

  assert.match(contract.whyNow, /人工确认/);
  assert.match(contract.whyNow, /只读/);
  assert.match(contract.whyNow, /不可自动写回|不可自动写入|不自动写回/);
  assert.doesNotMatch(contract.whyNow, /允许写回|write back allowed/i);
});

test('fde manufacturing contracts explain process, permission, risk, and next-step cards specifically', async () => {
  const { buildDynamicActionProductContract } = await loadHelper();

  const discovery = buildDynamicActionProductContract(baseInput({
    type: 'fde_discovery_probe',
    label: 'Probe deployment context',
    modeTemplateType: 'fde',
    answerStyle: { maxWords: 100, format: 'bullets', tone: 'curious' },
  }));
  const integration = buildDynamicActionProductContract(baseInput({
    type: 'fde_integration_check',
    label: 'Clarify integration',
    modeTemplateType: 'fde',
  }));
  const risk = buildDynamicActionProductContract(baseInput({
    type: 'fde_risk_blocker',
    label: 'Unblock deployment risk',
    modeTemplateType: 'fde',
  }));
  const nextStep = buildDynamicActionProductContract(baseInput({
    type: 'fde_next_step',
    label: 'Lock next step',
    modeTemplateType: 'fde',
  }));

  assert.match(discovery.userAction, /制造业流程|系统对象|PLM|QMS/);
  assert.match(integration.userAction, /集成|权限|读写边界/);
  assert.match(risk.whyNow, /客户流程风险|系统权限风险|AI Agent 误判风险|信息缺失/);
  assert.match(nextStep.userAction, /owner|负责人/);
  assert.match(nextStep.userAction, /date|日期|时间/);
  assert.match(nextStep.userAction, /artifact|验证产物/);
});

test('sales dynamic actions have product-specific card contracts', async () => {
  const { buildDynamicActionProductContract } = await loadHelper();

  const cases = [
    ['pricing_objection', 'Handle pricing objection', 'spoken_response', '回应价格异议', /价格|预算/],
    ['pricing_request', 'Draft quote email', 'email_draft', '生成报价邮件', /报价|邮件/],
    ['case_study_request', 'Share relevant case study', 'spoken_response', '引用案例证明', /案例|证明/],
    ['technical_requirements', 'Clarify technical requirements', 'checklist', '澄清技术需求', /技术|集成|安全/],
    ['buying_signal', 'Seize buying signal', 'action_item', '锁定推进下一步', /owner|负责人|日期|产物|artifact/],
  ];

  for (const [type, label, outputType, userAction, whyNowPattern] of cases) {
    const contract = buildDynamicActionProductContract(baseInput({ type, label }));
    assert.equal(contract.outputType, outputType);
    assert.equal(contract.userAction, userAction);
    assert.match(contract.whyNow, whyNowPattern);
  }
});

test('dynamic action contracts carry context need decisions for material, business, and unknown cases', async () => {
  const { buildDynamicActionProductContract } = await loadHelper();

  const caseStudy = buildDynamicActionProductContract(baseInput({
    type: 'case_study_request',
    label: 'Share relevant case study',
    evidenceRefs: [{ source: 'transcript', text: 'Do you have ROI proof or a customer case we can compare against?' }],
  }));
  assert.equal(caseStudy.contextNeedDecision.material, 'required');
  assert.equal(caseStudy.contextNeedDecision.business, 'not_needed');
  assert.equal(caseStudy.contextNeedDecision.decidedBy, 'dynamic_action_contract');

  const objection = buildDynamicActionProductContract(baseInput({
    type: 'pricing_objection',
    label: 'Handle pricing objection',
    evidenceRefs: [{ source: 'transcript', text: 'This is too expensive.' }],
  }));
  assert.equal(objection.contextNeedDecision.material, 'not_needed');
  assert.equal(objection.contextNeedDecision.business, 'not_needed');
  assert.equal(objection.contextNeedDecision.screen, 'not_needed');

  const windchill = buildDynamicActionProductContract(baseInput({
    type: 'fde_integration_check',
    label: 'Clarify Windchill BOM status',
    modeTemplateType: 'fde',
    evidenceRefs: [{ source: 'transcript', text: 'Can you check the Windchill BOM for ECN-123 before we commit?' }],
  }));
  assert.equal(windchill.contextNeedDecision.business, 'required');
  assert.equal(windchill.contextNeedDecision.material, 'use_if_ready');

  const unknown = buildDynamicActionProductContract(baseInput({
    type: 'unknown_action',
    label: 'Unknown action',
    evidenceRefs: [{ source: 'transcript', text: 'Please handle this.' }],
  }));
  assert.equal(unknown.contextNeedDecision.material, 'unknown');
  assert.equal(unknown.contextNeedDecision.business, 'unknown');
  assert.equal(unknown.contextNeedDecision.screen, 'unknown');
});
