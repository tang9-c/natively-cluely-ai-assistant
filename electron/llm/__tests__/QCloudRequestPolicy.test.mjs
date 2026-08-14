import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const policyPath = path.resolve('dist-electron/electron/llm/QCloudRequestPolicy.js');

async function loadPolicy() {
  return import(pathToFileURL(policyPath).href);
}

describe('QCloudRequestPolicy', () => {
  test('uses independent fixed input budgets for each request class', async () => {
    const { QCLOUD_INPUT_TOKEN_BUDGETS, QCLOUD_MEETING_SUMMARY_SAFE_CHUNK_CHARS } = await loadPolicy();

    assert.deepEqual(QCLOUD_INPUT_TOKEN_BUDGETS, {
      realtime_answer: 3_000,
      dynamic_action: 2_000,
      meeting_summary: 12_000,
      post_call: 6_000,
    });
    assert.equal(QCLOUD_MEETING_SUMMARY_SAFE_CHUNK_CHARS, 10_000);
  });

  test('estimates Chinese input conservatively instead of assuming four CJK characters per token', async () => {
    const { estimateQCloudInputTokens } = await loadPolicy();

    assert.equal(estimateQCloudInputTokens('中'.repeat(1_000)), 1_000);
    assert.equal(estimateQCloudInputTokens('a'.repeat(4_000)), 1_000);
  });

  test('uses independent timeout policies for realtime and background classes', async () => {
    const { QCLOUD_TIMEOUT_POLICIES } = await loadPolicy();

    assert.deepEqual(QCLOUD_TIMEOUT_POLICIES.realtime_answer, {
      firstTokenMs: 12_000,
      idleMs: 5_000,
      totalMs: 30_000,
    });
    assert.equal(QCLOUD_TIMEOUT_POLICIES.dynamic_action.totalMs, 6_000);
    assert.equal(QCLOUD_TIMEOUT_POLICIES.meeting_summary.totalMs, 60_000);
    assert.equal(QCLOUD_TIMEOUT_POLICIES.post_call.totalMs, 60_000);
  });

  test('keeps the stable prefix and newest realtime content within budget', async () => {
    const { applyQCloudInputBudget, QCLOUD_INPUT_TOKEN_BUDGETS } = await loadPolicy();
    const stablePrefix = '<mode>销售模式固定提示</mode>';
    const latestQuestion = 'USER QUESTION:\n客户最新问题必须保留';
    const oversized = `${stablePrefix}\n${'旧会议内容'.repeat(5_000)}\n${latestQuestion}`;

    const result = applyQCloudInputBudget(oversized, 'realtime_answer');

    assert.equal(result.truncated, true);
    assert.ok(result.text.startsWith(stablePrefix));
    assert.ok(result.text.endsWith(latestQuestion));
    assert.ok(result.estimatedTokens <= QCLOUD_INPUT_TOKEN_BUDGETS.realtime_answer);
    assert.ok(result.originalEstimatedTokens > result.estimatedTokens);
  });

  test('does not alter unclassified QCLOUD requests', async () => {
    const { applyQCloudInputBudget } = await loadPolicy();
    const text = '原始内容'.repeat(10_000);

    const result = applyQCloudInputBudget(text);

    assert.equal(result.text, text);
    assert.equal(result.truncated, false);
  });

  test('normalizes provider usage without retaining response content', async () => {
    const { readQCloudUsage } = await loadPolicy();

    assert.deepEqual(readQCloudUsage({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 80 },
      },
      choices: [{ delta: { content: 'sensitive response' } }],
    }), {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 80,
    });
  });
});
