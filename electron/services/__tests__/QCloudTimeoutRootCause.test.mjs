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

test('non-streaming chat propagates total timeout to Natively provider calls', () => {
  const llm = read('electron/LLMHelper.ts');
  const chatStart = llm.indexOf('public async chatWithGemini(');
  const chatBlock = llm.slice(
    chatStart,
    llm.indexOf('async chatWithGeminiStream(', chatStart),
  );

  const timeoutForwardingCalls = chatBlock.match(/timeoutMs:\s*chatPromptOptions\?\.totalTimeoutMs/g) ?? [];

  assert.equal(timeoutForwardingCalls.length, 2);
});

test('meeting summary gives QCLOUD a summary-sized timeout budget', () => {
  const llm = read('electron/LLMHelper.ts');
  const summaryBlock = llm.slice(
    llm.indexOf('// ATTEMPT 1: QCLOUD API'),
    llm.indexOf('// ATTEMPT 2:', llm.indexOf('// ATTEMPT 1: QCLOUD API')),
  );

  assert.match(summaryBlock, /const qcloudSummaryTimeoutMs = 60_000;/);
  assert.match(
    summaryBlock,
    /\{ maxOutputTokens: QCLOUD_MEETING_SUMMARY_OUTPUT_TOKENS, timeoutMs: qcloudSummaryTimeoutMs \}/,
  );
  assert.match(summaryBlock, /qcloudSummaryTimeoutMs \+ 5000/);
});

test('QCLOUD has a provider limiter so realtime classifiers cannot stampede summary', () => {
  const rateLimiter = read('electron/services/RateLimiter.ts');
  const llm = read('electron/LLMHelper.ts');

  assert.match(rateLimiter, /qcloud: new RateLimiter\(/);
  assert.match(llm, /await this\.rateLimiters\.qcloud\.acquire\(\)/);
});
