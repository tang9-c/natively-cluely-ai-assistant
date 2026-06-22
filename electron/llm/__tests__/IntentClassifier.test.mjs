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
        assert.ok(input.candidateIntents.includes('discovery_probe'));
        return { intent: 'discovery_probe', confidence: 0.81 };
      },
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: true,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'general', confidence: 0.5, answerShape: 'x' };
      },
    });

    assert.equal(r.intent, 'discovery_probe');
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
        return { intent: 'discovery_probe', confidence: 0.8 };
      },
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: true,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'discovery_probe', confidence: 0.72, answerShape: 'local' };
      },
    });

    assert.equal(cloudCalls, 0);
    assert.equal(localCalls, 1);
    assert.equal(r.intent, 'discovery_probe');
  });

  test('does not call local SLM unless local intent enhancement is enabled', async () => {
    const { classifyIntent } = loadModule();
    let localCalls = 0;
    const r = await classifyIntent('这个方向让我有点犹豫', '[INTERVIEWER]: 这个方向让我有点犹豫', 0, 'sales', {
      localIntentEnhancementEnabled: false,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'discovery_probe', confidence: 0.72, answerShape: 'local' };
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
        return { intent: 'discovery_probe', confidence: 0.72, answerShape: 'local' };
      },
    });

    assert.equal(localCalls, 1);
    assert.equal(r.intent, 'discovery_probe');
  });

  test('does not call optional local SLM when enhancement is enabled but artifact is unavailable', async () => {
    const { classifyIntent } = loadModule();
    let localCalls = 0;
    const r = await classifyIntent('这个方向让我有点犹豫', '[INTERVIEWER]: 这个方向让我有点犹豫', 0, 'sales', {
      localIntentEnhancementEnabled: true,
      localIntentEnhancementAvailable: false,
      localIntentClassifier: async () => {
        localCalls += 1;
        return { intent: 'discovery_probe', confidence: 0.72, answerShape: 'local' };
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
