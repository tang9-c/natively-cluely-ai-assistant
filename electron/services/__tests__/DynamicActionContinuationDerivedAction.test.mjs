import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadEngine() {
  return import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js',
  )).href);
}

test('enqueueDerivedAction stores one capability card per parent', async () => {
  const { DynamicActionEngine } = await loadEngine();
  const engine = new DynamicActionEngine();
  const input = {
    sessionId: 's1',
    modeId: 'sales',
    modeTemplateType: 'sales',
    type: 'capability_fit_answer',
    parentActionId: 'parent-1',
    sourceIntent: 'sales_capability_fit',
    latestTurn: '对象是电池包冷却液流道，指标是压降和温升。',
    evidenceRefs: [{ source: 'transcript', text: '对象是电池包冷却液流道' }],
    keyEntities: ['电池包', '压降', '温升'],
    retrievalQuery: '电池包冷却液流道 压降 温升',
    confidence: 0.91,
    language: 'zh',
    createdAt: 1_000,
  };
  const first = engine.enqueueDerivedAction(input);
  const duplicate = engine.enqueueDerivedAction({ ...input, latestTurn: '再次补充温升指标', createdAt: 2_000 });
  assert.equal(first.type, 'capability_fit_answer');
  assert.equal(first.parentActionId, 'parent-1');
  assert.equal(first.autoSurfacePolicy, 'card');
  assert.equal(first.autoTriggerEligible, false);
  assert.equal(duplicate, null);
  assert.equal(engine.getStore().getAllActions('s1').length, 1);
});

test('enqueueDerivedAction stores one FDE grounded answer card per parent', async () => {
  const { DynamicActionEngine } = await loadEngine();
  const engine = new DynamicActionEngine();
  const input = {
    sessionId: 'fde-session',
    modeId: 'fde',
    modeTemplateType: 'fde',
    type: 'fde_grounded_answer',
    parentActionId: 'fde-parent-1',
    sourceIntent: 'fde_discovery',
    latestTurn: '客户补充说当前 ECO 流程由研发提交，质量经理做人审。',
    evidenceRefs: [{ source: 'transcript', text: '当前 ECO 流程由研发提交，质量经理做人审。' }],
    keyEntities: ['ECO', '研发提交', '质量经理人审', '检查变更材料是否缺字段'],
    retrievalQuery: [
      '当前流程: ECO 由研发提交后质量审批',
      '流程对象: ECO',
      '人审点: 质量经理签核',
      'AI 支持需求: 检查变更材料是否缺字段',
      '验证需求: 用 3 条真实 ECO 验证',
    ].join('\n'),
    confidence: 0.91,
    language: 'zh',
    createdAt: 1_000,
  };
  const first = engine.enqueueDerivedAction(input);
  const duplicate = engine.enqueueDerivedAction({ ...input, latestTurn: '再次补充测试数据', createdAt: 2_000 });
  assert.equal(first.type, 'fde_grounded_answer');
  assert.equal(first.parentActionId, 'fde-parent-1');
  assert.equal(first.modeTemplateType, 'fde');
  assert.equal(first.label, '生成 FDE 流程验证回应');
  assert.equal(first.productContract.userAction, '生成 FDE 流程验证回应');
  assert.equal(first.productContract.outputType, 'spoken_response');
  assert.match(first.productContract.whyNow, /流程|角色|AI/);
  assert.ok(first.keyEntities.includes('ECO'));
  assert.match(first.retrievalQuery, /当前流程/);
  assert.match(first.retrievalQuery, /AI 支持需求/);
  assert.equal(first.latestTurn, input.latestTurn);
  assert.equal(first.autoSurfacePolicy, 'card');
  assert.equal(first.autoTriggerEligible, false);
  assert.equal(duplicate, null);
  assert.equal(engine.getStore().getAllActions('fde-session').length, 1);
});

test('enqueueDerivedAction stores one recruiting evidence summary card per parent', async () => {
  const { DynamicActionEngine } = await loadEngine();
  const engine = new DynamicActionEngine();
  const input = {
    sessionId: 'recruiting-session',
    modeId: 'recruiting',
    modeTemplateType: 'recruiting',
    type: 'candidate_evidence_summary',
    parentActionId: 'recruiting-parent-1',
    sourceIntent: 'recruiting_bei_evidence_gap',
    latestTurn: '我负责灰度方案，事故率下降了 30%。',
    evidenceRefs: [{ source: 'transcript', text: '我负责灰度方案，事故率下降了 30%。', speaker: 'interviewer' }],
    keyEntities: ['事故响应与风险控制', '灰度方案', '个人 ownership', '风险取舍'],
    retrievalQuery: [
      '请补充你个人采取的行动。',
      '我负责灰度方案，事故率下降了 30%。',
      '已观察证据: 候选人负责灰度方案并将事故率降低 30%',
      '缺失证据: 个人 ownership；风险取舍',
      '验证需求: 需验证事故率指标的统计口径',
    ].join('\n'),
    confidence: 0.91,
    language: 'zh',
    createdAt: 1_000,
  };
  const first = engine.enqueueDerivedAction(input);
  const duplicate = engine.enqueueDerivedAction({ ...input, latestTurn: '再次补充事故率口径', createdAt: 2_000 });
  assert.equal(first.type, 'candidate_evidence_summary');
  assert.equal(first.parentActionId, 'recruiting-parent-1');
  assert.equal(first.modeTemplateType, 'recruiting');
  assert.equal(first.label, '生成候选人证据摘要');
  assert.deepEqual(first.evidenceRefs, input.evidenceRefs);
  assert.ok(first.keyEntities.includes('个人 ownership'));
  assert.match(first.retrievalQuery, /已观察证据/);
  assert.match(first.retrievalQuery, /验证需求/);
  assert.equal(first.autoSurfacePolicy, 'card');
  assert.equal(first.autoTriggerEligible, false);
  assert.equal(duplicate, null);
  assert.equal(engine.getStore().getAllActions('recruiting-session').length, 1);
});
