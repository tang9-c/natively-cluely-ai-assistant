import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const evaluatorUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionAcceptedOutputEvaluator.js'),
).href;

async function load() {
  return import(`${evaluatorUrl}?t=${Date.now()}`);
}

function evaluate(overrides = {}) {
  return {
    actionType: 'discovery_question',
    outputType: 'spoken_response',
    sourceUtterance: '我们现在关闭 CAPA 要很久，质量成本和审核压力都很大。',
    answerText: '当前 CAPA 关闭周期主要卡在哪个环节？\n质量成本里最希望先改善哪一类损失？',
    groundedSources: [{ type: 'transcript', label: 'customer utterance', status: 'used' }],
    ...overrides,
  };
}

describe('sales industrial discovery accepted output evaluator', () => {
  test('accepts 1-3 customer-facing anchored questions', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate());

    assert.equal(result.passed, true);
  });

  test('rejects product capability claims', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate({
      sourceUtterance: '请介绍一下你们在流体仿真方面的功能。',
      answerText: '我们支持完整的流体仿真能力，可以直接覆盖你们所有场景。',
    }));

    assert.equal(result.passed, false);
    assert.ok(result.forbiddenPatternFailures.includes('discovery_capability_claim'));
  });

  test('rejects invented ROI or customer proof', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate({
      sourceUtterance: '有没有客户用只读 AI Agent 做 PLM 变更影响分析但保留人工确认的案例？',
      answerText: '我们有世界500强客户案例，ROI 至少 300%。',
    }));

    assert.equal(result.passed, false);
    assert.ok(result.forbiddenPatternFailures.includes('discovery_invented_case_or_roi'));
  });

  test('rejects too many questions', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate({
      sourceUtterance: 'Creo 设计变更能不能和 Windchill ECO、MES 工艺路线打通？',
      answerText: [
        'Creo 变更现在由谁发起？',
        'Windchill ECO 谁审核？',
        'MES 工艺路线由谁维护？',
        '当前同步失败会影响哪个车间？',
      ].join('\n'),
    }));

    assert.equal(result.passed, false);
    assert.ok(result.requiredPatternFailures.includes('discovery_question_count_1_to_3'));
  });

  test('rejects generic unanchored questions when source has anchors', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate({
      sourceUtterance: '我们想确认流体仿真模块是否适合电池包冷却液流道。',
      answerText: '您现在最关心什么？\n这个问题的优先级高吗？',
    }));

    assert.equal(result.passed, false);
    assert.ok(result.requiredPatternFailures.includes('discovery_source_anchor'));
  });

  test('accepts role and metric anchors', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate({
      sourceUtterance: '质量经理关心审计通过率和 CAPA 关闭周期。',
      answerText: '质量经理希望优先改善审计通过率，还是 CAPA 关闭周期？\n现在这两个指标分别由谁负责跟进？',
    }));

    assert.equal(result.passed, true);
  });
});
