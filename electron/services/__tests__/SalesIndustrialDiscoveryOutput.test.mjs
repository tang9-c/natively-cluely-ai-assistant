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

  test('rejects explanation mixed with a question', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate({
      sourceUtterance: '我们现在关闭 CAPA 要很久，质量成本和审核压力都很大。',
      answerText: '先说下背景，CAPA 关闭慢通常会影响质量成本。\n当前 CAPA 关闭周期主要卡在哪个环节？',
    }));

    assert.equal(result.passed, false);
    assert.ok(result.requiredPatternFailures.includes('discovery_only_questions'));
  });

  test('requires source-intent-specific discovery direction', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const cases = [
      {
        sourceIntent: 'sales_pain_discovery',
        sourceUtterance: '现在 BOM 变更靠邮件通知，设计、工艺和质量经常不同步。',
        answerText: 'BOM 变更不同步主要卡在哪个流程断点？\n现在谁在用邮件补这个缺口？',
      },
      {
        sourceIntent: 'sales_capability_fit',
        sourceUtterance: '请介绍一下你们在流体仿真方面的功能。',
        answerText: '流体仿真主要要验证哪个目标工作流？\n你们希望用什么验收标准判断功能是否适合？',
      },
      {
        sourceIntent: 'sales_process_integration',
        sourceUtterance: 'Creo 设计变更能不能和 Windchill ECO、MES 工艺路线打通？',
        answerText: 'Creo 设计变更的源系统和目标系统分别是谁负责？\nWindchill ECO 到 MES 工艺路线的数据方向和读写边界怎么定义？',
      },
      {
        sourceIntent: 'sales_value_discovery',
        sourceUtterance: '人工查变更影响太慢，如果 Agent 能先整理证据，评审效率会高很多。',
        answerText: '现在人工查变更影响的周期大概多长？\n你们希望用哪个成功指标衡量评审效率提升？',
      },
      {
        sourceIntent: 'sales_contextual_proof_discovery',
        sourceUtterance: '有没有客户用只读 AI Agent 做 PLM 变更影响分析但保留人工确认的案例？',
        answerText: '你们希望未来案例匹配哪个行业或流程？\nPLM 变更影响分析里哪个成功指标最能证明价值？',
      },
    ];

    for (const item of cases) {
      const result = evaluateDynamicActionAcceptedOutput(evaluate(item));
      assert.equal(result.passed, true, item.sourceIntent);
    }
  });

  test('rejects source-intent-specific direction mismatch', async () => {
    const { evaluateDynamicActionAcceptedOutput } = await load();
    const result = evaluateDynamicActionAcceptedOutput(evaluate({
      sourceIntent: 'sales_process_integration',
      sourceUtterance: 'Creo 设计变更能不能和 Windchill ECO、MES 工艺路线打通？',
      answerText: 'Creo 设计变更目前最大的痛点是什么？\n这个问题影响哪些团队？',
    }));

    assert.equal(result.passed, false);
    assert.ok(result.requiredPatternFailures.includes('discovery_intent_direction_sales_process_integration'));
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
