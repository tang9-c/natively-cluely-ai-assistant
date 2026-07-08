// electron/llm/__tests__/IntentClassifier.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const modulePath = path.resolve(
  __dirname, '../../../dist-electron/electron/llm/IntentClassifier.js',
);

function loadModule() {
  return cjsRequire(modulePath);
}

describe('IntentClassifier.detectIntentByPattern (regex fast-path, bilingual)', () => {
  test('matches English clarification patterns (back-compat)', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Can you explain that?');
    assert.equal(r?.intent, 'clarification');
    assert.ok(r.confidence >= 0.8);
  });

  test('matches Chinese clarification patterns', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('能解释一下吗');
    assert.equal(r?.intent, 'clarification');
  });

  test('matches Chinese follow_up patterns', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('后来呢');
    assert.equal(r?.intent, 'follow_up');
  });

  test('matches Chinese deep_dive patterns', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('详细讲讲');
    assert.equal(r?.intent, 'deep_dive');
  });

  test('matches Chinese behavioral patterns', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('举个例子');
    assert.equal(r?.intent, 'behavioral');
  });

  test('matches Chinese example_request patterns', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('比如呢');
    assert.equal(r?.intent, 'example_request');
  });

  test('matches Chinese summary_probe patterns', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('总结一下');
    assert.equal(r?.intent, 'summary_probe');
  });

  test('matches Chinese coding patterns', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('写代码');
    assert.equal(r?.intent, 'coding');
  });

  test('returns null for unmatched input', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Hello there');
    assert.equal(r, null);
  });
});

describe('IntentClassifier.isPrimarilyChinese (language detection)', () => {
  test('detects pure Chinese', () => {
    const { isPrimarilyChinese } = loadModule();
    assert.equal(isPrimarilyChinese('你好'), true);
    assert.equal(isPrimarilyChinese('这是一个中文测试'), true);
  });

  test('detects pure English as not Chinese', () => {
    const { isPrimarilyChinese } = loadModule();
    assert.equal(isPrimarilyChinese('hello world'), false);
    assert.equal(isPrimarilyChinese('Please explain this to me'), false);
  });

  test('handles empty / whitespace-only input', () => {
    const { isPrimarilyChinese } = loadModule();
    assert.equal(isPrimarilyChinese(''), false);
    assert.equal(isPrimarilyChinese('   '), false);
    assert.equal(isPrimarilyChinese('.,!?'), false);
  });

  test('rejects single-CJK-character English-dominant input', () => {
    // "OK 你好 yes" — 1 CJK / 9 stripped chars ≈ 11% — should NOT be Chinese-dominant.
    // This is the regression test for the over-loose >= 1 threshold.
    const { isPrimarilyChinese } = loadModule();
    assert.equal(isPrimarilyChinese('OK 你好 yes'), false);
  });

  test('accepts Chinese-dominant mixed input', () => {
    // "请给我一个详细的 explanation" — 7 CJK / ~16 stripped chars ≈ 44% — Chinese.
    const { isPrimarilyChinese } = loadModule();
    assert.equal(isPrimarilyChinese('请给我一个详细的 explanation'), true);
  });

  test('threshold is tunable for edge cases', () => {
    // "OK 你好" → 2 CJK / 4 stripped chars (after stripping 1 space) = 0.5
    const { isPrimarilyChinese } = loadModule();
    assert.equal(isPrimarilyChinese('OK 你好', 0.3), true);   // default threshold accepts it (0.5 >= 0.3)
    assert.equal(isPrimarilyChinese('OK 你好', 0.5), true);   // exact threshold still accepts (>=)
    assert.equal(isPrimarilyChinese('OK 你好', 0.6), false);  // stricter threshold rejects it (0.5 < 0.6)
  });

  test('counts only CJK Unified Ideographs (not fullwidth punctuation)', () => {
    // Fullwidth punctuation (，。！？) should not count toward CJK total.
    // "你好，世界！" — 2 CJK chars + 3 fullwidth punct = 2/2 = 100% Chinese.
    const { isPrimarilyChinese } = loadModule();
    assert.equal(isPrimarilyChinese('你好，世界！'), true);
  });
});

describe('IntentClassifier.classifyIntent public API', () => {
  test('returns regex fast-path result without needing SLM fallback', async () => {
    const { classifyIntent } = loadModule();
    let cloudCalls = 0;
    let localCalls = 0;
    const r = await classifyIntent('能解释一下吗', '[INTERVIEWER]: 能解释一下吗', 0, 'general', {
      cloudIntentClassifier: async () => {
        cloudCalls += 1;
        return { intent: 'general', confidence: 0.5 };
      },
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: true,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'general', confidence: 0.5, answerShape: 'x' };
      },
    });
    assert.equal(r.intent, 'clarification');
    assert.ok(r.confidence >= 0.8);
    assert.equal(cloudCalls, 0);
    assert.equal(localCalls, 0);
  });

  test('falls back to context when no latest interviewer turn exists', async () => {
    const { classifyIntent } = loadModule();
    const r = await classifyIntent(null, '[INTERVIEWER]: hello', 0, 'sales');
    assert.equal(r.intent, 'general');
    assert.equal(r.confidence, 0.5);
  });

  test('uses cloud fallback for low-confidence Chinese turns before optional local SLM', async () => {
    const { classifyIntent } = loadModule();
    let localCalls = 0;
    const r = await classifyIntent('这个方向让我有点犹豫', '[INTERVIEWER]: 这个方向让我有点犹豫', 0, 'sales', {
      cloudIntentClassifier: async (input) => {
        assert.equal(input.latestTurn, '这个方向让我有点犹豫');
        assert.equal(input.modeTemplateType, 'sales');
        assert.equal(input.language, 'zh');
        assert.ok(input.candidateIntents.includes('sales_proof_request'));
        return { intent: 'sales_proof_request', confidence: 0.81 };
      },
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: true,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'general', confidence: 0.5, answerShape: 'x' };
      },
    });

    assert.equal(r.intent, 'sales_proof_request');
    assert.equal(r.confidence, 0.81);
    assert.equal(localCalls, 0);
  });

  test('skips cloud fallback when transcript scope is disabled', async () => {
    const { classifyIntent } = loadModule();
    let cloudCalls = 0;
    let localCalls = 0;
    const r = await classifyIntent('这个方向让我有点犹豫', '[INTERVIEWER]: 这个方向让我有点犹豫', 0, 'sales', {
      providerDataScopes: { transcript: false },
      cloudIntentClassifier: async () => {
        cloudCalls += 1;
        return { intent: 'sales_proof_request', confidence: 0.8 };
      },
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: true,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'sales_proof_request', confidence: 0.72, answerShape: 'local' };
      },
    });

    assert.equal(cloudCalls, 0);
    assert.equal(localCalls, 1);
    assert.equal(r.intent, 'sales_proof_request');
  });

  test('does not call local SLM unless local intent enhancement is enabled', async () => {
    const { classifyIntent } = loadModule();
    let localCalls = 0;
    const r = await classifyIntent('这个方向让我有点犹豫', '[INTERVIEWER]: 这个方向让我有点犹豫', 0, 'sales', {
      localIntentEnhancementEnabled: false,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'sales_proof_request', confidence: 0.72, answerShape: 'local' };
      },
    });

    assert.equal(localCalls, 0);
    assert.equal(r.intent, 'general');
    assert.equal(r.confidence, 0.5);
  });

  test('calls optional local SLM when enhancement is enabled and cloud is unavailable', async () => {
    const { classifyIntent } = loadModule();
    let localCalls = 0;
    const r = await classifyIntent('这个方向让我有点犹豫', '[INTERVIEWER]: 这个方向让我有点犹豫', 0, 'sales', {
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: true,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'sales_proof_request', confidence: 0.72, answerShape: 'local' };
      },
    });

    assert.equal(localCalls, 1);
    assert.equal(r.intent, 'sales_proof_request');
  });

  test('does not call optional local SLM when enhancement is enabled but artifact is unavailable', async () => {
    const { classifyIntent } = loadModule();
    let localCalls = 0;
    const r = await classifyIntent('这个方向让我有点犹豫', '[INTERVIEWER]: 这个方向让我有点犹豫', 0, 'sales', {
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: false,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'sales_proof_request', confidence: 0.72, answerShape: 'local' };
      },
    });

    assert.equal(localCalls, 0);
    assert.equal(r.intent, 'general');
  });

  test('warmup is no-op by default and only runs when local enhancement is enabled', () => {
    const { warmupIntentClassifier } = loadModule();
    let calls = 0;
    warmupIntentClassifier({
      localIntentEnhancementEnabled: false,
      localWarmup: () => { calls += 1; },
    });
    assert.equal(calls, 0);

    warmupIntentClassifier({
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: false,
      localWarmup: () => { calls += 1; },
    });
    assert.equal(calls, 0);

    warmupIntentClassifier({
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: true,
      localWarmup: () => { calls += 1; },
    });
    assert.equal(calls, 1);
  });
});

// ============================================================================
// Per-mode regex sub-dispatchers (sales / team-meet / lecture)
// ============================================================================

function assertIntent(result, expectedIntent, minConfidence = 0.7, label = '') {
  assert.ok(result, `${label}: expected match, got null`);
  assert.equal(result.intent, expectedIntent, `${label}: intent mismatch`);
  assert.ok(
    result.confidence >= minConfidence,
    `${label}: confidence ${result.confidence} below ${minConfidence}`,
  );
  assert.ok(result.answerShape && result.answerShape.length > 0, `${label}: answerShape is empty`);
}

describe('IntentClassifier.detectIntentByPattern — sales mode', () => {
  test('custom intent keywords override the sales fast-path without regex exposure', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('客户说他们马上采购', 'sales', {
      sales_buying_signal: ['马上采购'],
      sales_pricing_objection: [],
      sales_proof_request: [],
    });

    assertIntent(r, 'sales_buying_signal', 0.9, 'sales_buying_signal/custom-keyword');
  });

  test('empty custom keyword list disables that intent fast-path and falls through', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('这个方案太贵了', 'sales', {
      sales_pricing_objection: [],
      sales_buying_signal: [],
      sales_proof_request: [],
    });

    assert.equal(r, null);
  });

  // ---- sales_buying_signal (priority over objection) — confidence 0.95
  test('Chinese: 准备签合同 → sales_buying_signal', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('我们准备签合同了', 'sales');
    assertIntent(r, 'sales_buying_signal', 0.9, 'sales_buying_signal/zh-sign');
  });

  test('Chinese: 下一步怎么走 → sales_buying_signal', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('那下一步怎么走?', 'sales');
    assertIntent(r, 'sales_buying_signal', 0.9, 'sales_buying_signal/zh-next-steps');
  });

  test('Chinese: 发合同给我 → sales_buying_signal', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('请发合同给我', 'sales');
    assertIntent(r, 'sales_buying_signal', 0.9, 'sales_buying_signal/zh-send-contract');
  });

  test('English: ready to move forward → sales_buying_signal', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('We are ready to move forward.', 'sales');
    assertIntent(r, 'sales_buying_signal', 0.9, 'sales_buying_signal/en-ready');
  });

  test('English: send over the proposal → sales_quote_request', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Please send over the proposal today.', 'sales');
    assertIntent(r, 'sales_quote_request', 0.85, 'sales_quote_request/en-send-proposal');
  });

  // ---- sales_pricing_objection — confidence 0.92
  test('Chinese: 太贵了 → sales_pricing_objection', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('这个方案太贵了', 'sales');
    assertIntent(r, 'sales_pricing_objection', 0.9, 'sales_pricing_objection/zh-expensive');
  });

  test('Chinese: 预算不够 → sales_pricing_objection', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('我们预算不够,可能负担不起', 'sales');
    assertIntent(r, 'sales_pricing_objection', 0.9, 'sales_pricing_objection/zh-budget');
  });

  test('Chinese: 裸竞品提及不触发 sales_pricing_objection', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('我们已经在用 Gong 了', 'sales');
    assert.equal(r, null);
  });

  test('English: too expensive for our budget → sales_pricing_objection', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('This is too expensive for our budget.', 'sales');
    assertIntent(r, 'sales_pricing_objection', 0.9, 'sales_pricing_objection/en-expensive');
  });

  test('English: bare competitor mention does not trigger pricing objection', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('We are already using Gong for sales calls.', 'sales');
    assert.equal(r, null);
  });

  // ---- sales_proof_request / sales_technical_requirements — five sellable moments
  test('Chinese: 客户案例 → sales_proof_request', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('有没有类似客户案例可以证明效果', 'sales');
    assertIntent(r, 'sales_proof_request', 0.85, 'sales_proof_request/zh-case');
  });

  test('Chinese: ROI 证明 → sales_proof_request', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('有没有 ROI 证明材料', 'sales');
    assertIntent(r, 'sales_proof_request', 0.85, 'sales_proof_request/zh-roi');
  });

  test('Chinese: SSO 对接 → sales_technical_requirements', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('我们有 SSO 对接和安全要求', 'sales');
    assertIntent(r, 'sales_technical_requirements', 0.85, 'sales_technical_requirements/zh-sso');
  });

  test('English: similar customer proof → sales_proof_request', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Do you have a similar customer proof point?', 'sales');
    assertIntent(r, 'sales_proof_request', 0.85, 'sales_proof_request/en-proof');
  });

  test('English: API requirements → sales_technical_requirements', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('What are the API requirements for production deployment?', 'sales');
    assertIntent(r, 'sales_technical_requirements', 0.85, 'sales_technical_requirements/en-api');
  });

  // ---- Boundary: sales-mode unmatched → null
  test('Boundary: sales mode unmatched input returns null', () => {
    const { detectIntentByPattern } = loadModule();
    assert.equal(detectIntentByPattern('你好,很高兴见到你', 'sales'), null);
    assert.equal(detectIntentByPattern('Tell me about yourself', 'sales'), null);
    assert.equal(detectIntentByPattern('今天天气真好', 'sales'), null);
  });

  // ---- Mode-scoping: sales regex must NOT fire under general mode
  test('sales pattern does NOT fire when modeTemplateType is general', () => {
    const { detectIntentByPattern } = loadModule();
    // 太贵 is sales-only; under general mode it should not be sales:sales_pricing_objection.
    // It may still resolve via the interview-family regex (no) or return null.
    const r = detectIntentByPattern('太贵了', 'general');
    assert.equal(r, null, '太贵 should not match under general mode');
  });
});

describe('IntentClassifier.detectIntentByPattern — team-meet mode', () => {
  // ---- capture_action — confidence 0.92 (highest priority)
  test('Chinese: 我来负责 → capture_action', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('这件事我来负责', 'team-meet');
    assertIntent(r, 'capture_action', 0.9, 'capture_action/zh-own');
  });

  test('Chinese: 行动项 → capture_action', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('记一个行动项,周五前完成', 'team-meet');
    assertIntent(r, 'capture_action', 0.9, 'capture_action/zh-action-item');
  });

  test('Chinese: 周五前截止 → capture_action', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('需要周五前完成', 'team-meet');
    assertIntent(r, 'capture_action', 0.9, 'capture_action/zh-deadline');
  });

  test('English: I will ship by Friday → capture_action', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern("I'll ship the fix by Friday.", 'team-meet');
    assertIntent(r, 'capture_action', 0.9, 'capture_action/en-by-friday');
  });

  test('English: assigned to me → capture_action', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('This is assigned to me — I will handle it.', 'team-meet');
    assertIntent(r, 'capture_action', 0.9, 'capture_action/en-assigned');
  });

  // ---- capture_decision — confidence 0.9
  test('Chinese: 决定了用 X → capture_decision', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('我们决定了用 Postgres', 'team-meet');
    assertIntent(r, 'capture_decision', 0.85, 'capture_decision/zh-decided');
  });

  test('Chinese: 就选这个方案 → capture_decision', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('就选这个方案吧', 'team-meet');
    assertIntent(r, 'capture_decision', 0.85, 'capture_decision/zh-go-with');
  });

  test('Chinese: 通过了 → capture_decision', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('这个 PR 通过了', 'team-meet');
    assertIntent(r, 'capture_decision', 0.85, 'capture_decision/zh-approved');
  });

  test('English: approved → capture_decision', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Approved by the team, ship it.', 'team-meet');
    assertIntent(r, 'capture_decision', 0.85, 'capture_decision/en-approved');
  });

  test('English: we decided to go with → capture_decision', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('We decided to go with option B.', 'team-meet');
    assertIntent(r, 'capture_decision', 0.85, 'capture_decision/en-decided');
  });

  // ---- capture_risk — confidence 0.88
  test('Chinese: 有阻塞 → capture_risk', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('现在有一个阻塞', 'team-meet');
    assertIntent(r, 'capture_risk', 0.8, 'capture_risk/zh-blocker');
  });

  test('Chinese: 延期了 → capture_risk', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('上线日期要延期了', 'team-meet');
    assertIntent(r, 'capture_risk', 0.8, 'capture_risk/zh-delay');
  });

  test('Chinese: 有个依赖 → capture_risk', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('有个依赖要等前端完成', 'team-meet');
    assertIntent(r, 'capture_risk', 0.8, 'capture_risk/zh-dependency');
  });

  test('English: blocker → capture_risk', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('We hit a blocker on the migration.', 'team-meet');
    assertIntent(r, 'capture_risk', 0.8, 'capture_risk/en-blocker');
  });

  test('English: behind schedule → capture_risk', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('We are behind schedule this sprint.', 'team-meet');
    assertIntent(r, 'capture_risk', 0.8, 'capture_risk/en-behind');
  });

  // ---- status_update — confidence 0.85
  test('Chinese: 现在进度如何 → status_update', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('现在进度如何?', 'team-meet');
    assertIntent(r, 'status_update', 0.8, 'status_update/zh-progress');
  });

  test('Chinese: 截止日期 → status_update', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('截止日期是什么时候?', 'team-meet');
    assertIntent(r, 'status_update', 0.8, 'status_update/zh-due-date');
  });

  test('Chinese: 谁负责 → status_update', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('这件事谁负责?', 'team-meet');
    assertIntent(r, 'status_update', 0.8, 'status_update/zh-owner');
  });

  test('English: status update → status_update', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Quick status update on the migration.', 'team-meet');
    assertIntent(r, 'status_update', 0.8, 'status_update/en-status');
  });

  test('English: where are we on this → status_update', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Where are we on this rollout?', 'team-meet');
    assertIntent(r, 'status_update', 0.8, 'status_update/en-where');
  });

  // ---- Boundary
  test('Boundary: team-meet unmatched input returns null', () => {
    const { detectIntentByPattern } = loadModule();
    assert.equal(detectIntentByPattern('我们开个会吧', 'team-meet'), null);
    assert.equal(detectIntentByPattern('discuss tomorrow', 'team-meet'), null);
  });

  // ---- Mode-scoping: team-meet regex must NOT fire under general mode
  test('team-meet pattern does NOT fire when modeTemplateType is general', () => {
    const { detectIntentByPattern } = loadModule();
    assert.equal(detectIntentByPattern('我来负责', 'general'), null);
  });
});

describe('IntentClassifier.detectIntentByPattern — lecture mode', () => {
  // ---- explain_concept — confidence 0.9 (highest priority, tested first)
  test('Chinese: 这个叫做 X → explain_concept', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('这个叫做贝叶斯定理', 'lecture');
    assertIntent(r, 'explain_concept', 0.85, 'explain_concept/zh-called');
  });

  test('Chinese: 引入新概念 → explain_concept', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('今天我们引入一个新的概念', 'lecture');
    assertIntent(r, 'explain_concept', 0.85, 'explain_concept/zh-introduce');
  });

  test('Chinese: 术语的含义 → explain_concept', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('我们来谈谈这个术语的含义', 'lecture');
    assertIntent(r, 'explain_concept', 0.85, 'explain_concept/zh-term');
  });

  test('English: this is called Bayes → explain_concept', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('This is called Bayes theorem.', 'lecture');
    assertIntent(r, 'explain_concept', 0.85, 'explain_concept/en-this-is-called');
  });

  test('English: definition of → explain_concept', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Today we cover the definition of entropy.', 'lecture');
    assertIntent(r, 'explain_concept', 0.85, 'explain_concept/en-definition');
  });

  // ---- render_formula — confidence 0.9 (note: 公式 not in explain_concept)
  test('Chinese: 矩阵乘法 → render_formula', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('我们讲一下矩阵乘法的规则', 'lecture');
    assertIntent(r, 'render_formula', 0.85, 'render_formula/zh-matrix');
  });

  test('Chinese: 求和公式 → render_formula', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('这是求和公式的标准形式', 'lecture');
    assertIntent(r, 'render_formula', 0.85, 'render_formula/zh-sum');
  });

  test('Chinese: 积分推导 → render_formula', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('接下来做积分推导', 'lecture');
    assertIntent(r, 'render_formula', 0.85, 'render_formula/zh-integral');
  });

  test('English: limit of f(x) → render_formula', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('We compute the limit of f(x) as x→0.', 'lecture');
    assertIntent(r, 'render_formula', 0.85, 'render_formula/en-limit');
  });

  test('English: matrix multiplication → render_formula', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Matrix multiplication is associative.', 'lecture');
    assertIntent(r, 'render_formula', 0.85, 'render_formula/en-matrix');
  });

  // ---- answer_class_question — confidence 0.85
  test('Chinese: 谁知道答案 → answer_class_question', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('谁知道这道题的答案?', 'lecture');
    assertIntent(r, 'answer_class_question', 0.8, 'answer_class_question/zh-who-knows');
  });

  test('Chinese: 谁能说一下 → answer_class_question', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('谁能说一下思路', 'lecture');
    assertIntent(r, 'answer_class_question', 0.8, 'answer_class_question/zh-who-can');
  });

  test('Chinese: 有人知道怎么算 → answer_class_question', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('有人知道怎么算吗?', 'lecture');
    assertIntent(r, 'answer_class_question', 0.8, 'answer_class_question/zh-anyone');
  });

  test('English: anyone know the answer → answer_class_question', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Anyone know the answer to problem 3?', 'lecture');
    assertIntent(r, 'answer_class_question', 0.8, 'answer_class_question/en-anyone-know');
  });

  test('English: class, what is the answer → answer_class_question', () => {
    const { detectIntentByPattern } = loadModule();
    const r = detectIntentByPattern('Class, what is the answer?', 'lecture');
    assertIntent(r, 'answer_class_question', 0.8, 'answer_class_question/en-class-question');
  });

  // ---- Boundary
  test('Boundary: lecture unmatched input returns null', () => {
    const { detectIntentByPattern } = loadModule();
    assert.equal(detectIntentByPattern('今天学什么', 'lecture'), null);
    assert.equal(detectIntentByPattern('下课', 'lecture'), null);
  });

  // ---- Mode-scoping
  test('lecture pattern does NOT fire when modeTemplateType is general', () => {
    const { detectIntentByPattern } = loadModule();
    assert.equal(detectIntentByPattern('这个叫做贝叶斯定理', 'general'), null);
  });
});
