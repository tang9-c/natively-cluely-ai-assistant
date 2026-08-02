import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('QCLOUD requests use task-specific timeout instead of a fixed 8s abort', () => {
  const llm = read('electron/LLMHelper.ts');
  const method = llm.match(/private async generateWithNatively\([\s\S]*?\n  \}/)?.[0] ?? '';

  assert.match(method, /const timeoutMs = _options\.timeoutMs \?\? 8000;/);
  assert.match(method, /const qcloudTimeout = setTimeout\(/);
  assert.match(method, /qcloudAbortController\.abort\(new Error\(`QCLOUD API request timed out after \$\{timeoutMs\}ms`\)\)/);
  assert.match(method, /signal: qcloudAbortController\.signal/);
  assert.doesNotMatch(method, /signal:\s*AbortSignal\.timeout\(8000\)/);
});

test('structured QCLOUD classification propagates its short timeout to fetch', () => {
  const llm = read('electron/LLMHelper.ts');
  const structuredBlock = llm.slice(
    llm.indexOf('// Priority 9: QCLOUD API'),
    llm.indexOf('if (providers.length === 0)', llm.indexOf('// Priority 9: QCLOUD API')),
  );

  assert.match(
    structuredBlock,
    /generateWithNatively\(message,\s*undefined,\s*undefined,\s*\{\s*maxOutputTokens,\s*timeoutMs: perProviderTimeoutMs\s*\}\)/,
  );
});

test('non-streaming chat propagates the resolved QCLOUD timeout to Natively provider calls', () => {
  const llm = read('electron/LLMHelper.ts');
  const chatStart = llm.indexOf('public async chatWithGemini(');
  const chatBlock = llm.slice(
    chatStart,
    llm.indexOf('async chatWithGeminiStream(', chatStart),
  );

  const timeoutForwardingCalls = chatBlock.match(/timeoutMs:\s*qcloudChatTimeoutMs/g) ?? [];

  assert.equal(timeoutForwardingCalls.length, 2);
  assert.match(
    chatBlock,
    /chatPromptOptions\?\.totalTimeoutMs\s*\?\?\s*\(\s*chatPromptOptions\?\.activeSkill\s*\?\s*QCLOUD_SKILL_CHAT_TIMEOUT_MS\s*:\s*undefined\s*\)/,
  );
});

test('active skill chat does not retry QCLOUD through generic non-streaming fallback', () => {
  const llm = read('electron/LLMHelper.ts');
  const chatStart = llm.indexOf('public async chatWithGemini(');
  const chatBlock = llm.slice(
    chatStart,
    llm.indexOf('async chatWithGeminiStream(', chatStart),
  );
  const directRoutingBlock = chatBlock.slice(
    chatBlock.indexOf("// --- Direct Routing based on Selected Model ---"),
    chatBlock.indexOf("if (this.isOpenAiModel", chatBlock.indexOf("// --- Direct Routing based on Selected Model ---")),
  );
  const providerQueueBlock = chatBlock.slice(
    chatBlock.indexOf('const routedProviders = routeWithScopeFallback'),
    chatBlock.indexOf('if (providers.length === 0)', chatBlock.indexOf('const routedProviders = routeWithScopeFallback')),
  );

  assert.match(directRoutingBlock, /if\s*\(chatPromptOptions\?\.activeSkill\)\s*\{/);
  assert.match(directRoutingBlock, /return "AI 服务未返回有效内容，请稍后重试。";/);
  assert.match(providerQueueBlock, /hasNatively:\s*chatPromptOptions\?\.activeSkill\s*\?\s*false\s*:\s*this\.hasNatively\(\)/);
});

test('meeting summary gives QCLOUD a summary-sized timeout budget', () => {
  const llm = read('electron/LLMHelper.ts');
  const constants = read('electron/llm/QCloudLlmConstants.ts');
  const summaryBlock = llm.slice(
    llm.indexOf('// ATTEMPT 1: QCLOUD API'),
    llm.indexOf('// ATTEMPT 2:', llm.indexOf('// ATTEMPT 1: QCLOUD API')),
  );

  assert.match(constants, /export const QCLOUD_MEETING_SUMMARY_MODEL = "lite32k"/);
  assert.match(constants, /export const QCLOUD_MEETING_SUMMARY_TIMEOUT_MS = 60_000/);
  assert.match(
    summaryBlock,
    /maxOutputTokens:\s*options\?\.maxOutputTokens\s*\?\?\s*QCLOUD_MEETING_SUMMARY_OUTPUT_TOKENS/,
  );
  assert.match(summaryBlock, /timeoutMs:\s*qcloudSummaryTimeoutMs/);
  assert.match(summaryBlock, /qcloudModel:\s*QCLOUD_MEETING_SUMMARY_MODEL/);
  assert.match(summaryBlock, /const qcloudSummaryTimeoutMs = QCLOUD_MEETING_SUMMARY_TIMEOUT_MS/);
  assert.match(summaryBlock, /qcloudSummaryTimeoutMs \+ 5000/);
});

test('QCLOUD has a provider limiter so realtime classifiers cannot stampede summary', () => {
  const rateLimiter = read('electron/services/RateLimiter.ts');
  const llm = read('electron/LLMHelper.ts');

  assert.match(rateLimiter, /qcloud: new RateLimiter\(/);
  assert.match(llm, /await this\.rateLimiters\.qcloud\.acquire\([^)]*\)/);
});
