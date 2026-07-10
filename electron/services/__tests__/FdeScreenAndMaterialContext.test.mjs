import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../..');

async function loadFdeEvaluator() {
  return import(pathToFileURL(path.join(root, 'dist-electron/electron/services/dynamic-actions/FdeAcceptedOutputEvaluator.js')).href);
}

test('fde plan preserves read-only business context language', () => {
  const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
  assert.match(detector, /read-only|只读/);
  assert.match(detector, /Do not imply automatic writes|不能.*写入|PLM.*QMS/s);
});

test('fde product contract keeps human-in-the-loop boundaries visible', () => {
  const contract = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionProductContract.ts'), 'utf8');
  assert.match(contract, /human confirmation|人工确认|read-only|只读/i);
  assert.match(contract, /fde_agent_feasibility/);
});

test('fde accepts screen and business context grounding when facts are used', async () => {
  const { evaluateFdeAcceptedOutput } = await loadFdeEvaluator();
  const result = evaluateFdeAcceptedOutput({
    actionType: 'fde_integration_check',
    answerText: '基于屏幕里的 Windchill ECO 页面，只读确认对象编号；还缺 owner/date/artifact。',
    missingFields: ['owner', 'date', 'artifact'],
    groundedSources: [
      { type: 'screen', status: 'used' },
      { type: 'business_context', status: 'used' },
    ],
  });
  assert.equal(result.passed, true);
});

test('fde rejects claimed PLM facts when business context failed', async () => {
  const { evaluateFdeAcceptedOutput } = await loadFdeEvaluator();
  const result = evaluateFdeAcceptedOutput({
    actionType: 'fde_integration_check',
    answerText: 'Windchill 里这个 ECO 已经审批完成，可以进入写回。',
    missingFields: [],
    groundedSources: [{ type: 'business_context', status: 'failed' }],
  });
  assert.equal(result.passed, false);
  assert.match(result.failures.join('\n'), /ungrounded_business_fact|no_writeback_boundary/);
});

test('fde accepts material and pptx grounding when deployment plan facts are used', async () => {
  const { evaluateFdeAcceptedOutput } = await loadFdeEvaluator();
  const result = evaluateFdeAcceptedOutput({
    actionType: 'fde_success_criteria',
    answerText: '基于上传方案材料和 PPTX 验收页，先确认 owner/date/artifact、测试数据和验收标准。',
    missingFields: ['owner', 'date', 'artifact'],
    groundedSources: [
      { type: 'material', status: 'used' },
      { type: 'pptx', status: 'used' },
    ],
  });
  assert.equal(result.passed, true);
});

test('fde treats business context not_found as unavailable fact instead of inventing PLM status', async () => {
  const { evaluateFdeAcceptedOutput } = await loadFdeEvaluator();
  const result = evaluateFdeAcceptedOutput({
    actionType: 'fde_integration_check',
    answerText: '业务系统只读查询没有找到该 ECO，当前不能确认 PLM 状态；需要补只读查询结果或源材料。',
    missingFields: ['owner', 'date', 'artifact'],
    groundedSources: [{ type: 'business_context', status: 'not_found' }],
  });
  assert.equal(result.passed, true);
});
