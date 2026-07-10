import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const evaluatorUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionAcceptedOutputEvaluator.js'),
).href;

async function load() {
  return import(evaluatorUrl);
}

test('case proof answer passes when grounded in material', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const result = evaluateDynamicActionAcceptedOutput({
    actionType: 'case_study_request',
    outputType: 'spoken_response',
    answerText: '根据 case-study.md，Halcyon Industries 先用 pilot 验证审批周期，再扩大范围。',
    groundedSources: [{ type: 'material', label: 'case-study.md', status: 'used' }],
  });

  assert.equal(result.passed, true);
});

test('case proof answer passes when grounded in pptx', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const result = evaluateDynamicActionAcceptedOutput({
    actionType: 'case_study_request',
    outputType: 'spoken_response',
    answerText: '方案 PPTX 里提到类似客户先跑了一个部门级 pilot。',
    groundedSources: [{ type: 'pptx', label: 'sales-deck.pptx#slide-7', status: 'used' }],
  });

  assert.equal(result.passed, true);
});

test('case proof answer passes with explicit no-match instead of invented proof', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const result = evaluateDynamicActionAcceptedOutput({
    actionType: 'case_study_request',
    outputType: 'spoken_response',
    answerText: '我现在没有在已上传资料里找到匹配案例，先不编客户名或 ROI，会后补材料。',
    groundedSources: [{ type: 'material', label: 'case-study-search', status: 'not_found' }],
  });

  assert.equal(result.passed, true);
});

test('business context answer passes with readonly Windchill fact and fails when unavailable facts are invented', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const grounded = evaluateDynamicActionAcceptedOutput({
    actionType: 'technical_requirements',
    outputType: 'checklist',
    answerText: '- Windchill: read-only lookup returned part 0000000001 status Released\n- Validation: confirm SSO role can read the object\n- Human check: no PLM writeback',
    groundedSources: [{ type: 'business_context', label: 'Windchill part 0000000001', status: 'used' }],
  });
  const failed = evaluateDynamicActionAcceptedOutput({
    actionType: 'technical_requirements',
    outputType: 'checklist',
    answerText: '- Windchill: part 0000000001 is Released\n- We can update it automatically after approval',
    groundedSources: [{ type: 'business_context', label: 'Windchill lookup', status: 'failed' }],
  });

  assert.equal(grounded.passed, true);
  assert.equal(failed.passed, false);
});
