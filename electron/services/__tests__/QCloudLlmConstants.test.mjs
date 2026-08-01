import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('Electron exposes centralized QCloud LLM constants', () => {
  const constants = read('electron/llm/QCloudLlmConstants.ts');

  assert.match(constants, /export const QCLOUD_LLM_BASE_URL = "https:\/\/obzbovrjewzd\.sealosbja\.site"/);
  assert.match(constants, /export const QCLOUD_CHAT_MODEL = "lite32k"/);
  assert.match(constants, /export const QCLOUD_SKILL_CHAT_MODEL = "turbo"/);
  assert.match(constants, /export const QCLOUD_MEETING_SUMMARY_MODEL = "lite32k"/);
  assert.match(constants, /export const QCLOUD_SKILL_CHAT_TIMEOUT_MS = 60_000/);
  assert.match(constants, /export const QCLOUD_MEETING_SUMMARY_TIMEOUT_MS = 60_000/);
  assert.match(constants, /export const QCLOUD_CHAT_ENDPOINT = `\$\{QCLOUD_LLM_BASE_URL\}\/v1\/chat`/);
  assert.match(constants, /export const QCLOUD_MODELS_ENDPOINT = `\$\{QCLOUD_LLM_BASE_URL\}\/v1\/models`/);
  assert.match(constants, /export const QCLOUD_CHAT_COMPLETIONS_ENDPOINT = `\$\{QCLOUD_LLM_BASE_URL\}\/v1\/chat\/completions`/);
});

test('QCLOUD model specs declare explicit token windows for supported models', () => {
  const constants = read('electron/llm/QCloudLlmConstants.ts');

  assert.match(constants, /export const QCLOUD_DEFAULT_OUTPUT_TOKENS = 8_192/);
  assert.match(constants, /export const QCLOUD_MEETING_TITLE_OUTPUT_TOKENS = 64/);
  assert.match(constants, /export const QCLOUD_MEETING_SUMMARY_OUTPUT_TOKENS = 4_096/);
  assert.match(constants, /export const QCLOUD_MEETING_SUMMARY_ENHANCEMENT_OUTPUT_TOKENS = 2_048/);
  assert.match(constants, /export const QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS = 16_000/);
  for (const model of ['pro32k', 'lite32k', 'turbo']) {
    assert.match(constants, new RegExp(`${model}[\\s\\S]*maxInputTokens:\\s*224_000`));
    assert.match(constants, new RegExp(`${model}[\\s\\S]*maxOutputTokens:\\s*128_000`));
    assert.match(constants, new RegExp(`${model}[\\s\\S]*maxContextTokens:\\s*256_000`));
  }
});

test('QCLOUD exposes speech submit and query endpoints derived from LLM base URL', () => {
  const constants = read('electron/llm/QCloudLlmConstants.ts');

  assert.match(constants, /export const QCLOUD_STT_SUBMIT_ENDPOINT/);
  assert.match(constants, /export const QCLOUD_STT_QUERY_ENDPOINT/);
  assert.match(constants, /QCLOUD_STT_SUBMIT_ENDPOINT\s*=\s*`\$\{QCLOUD_LLM_BASE_URL\}\/v1\/doubao\/audio\/auc\/submit`/);
  assert.match(constants, /QCLOUD_STT_QUERY_ENDPOINT\s*=\s*`\$\{QCLOUD_LLM_BASE_URL\}\/v1\/doubao\/audio\/auc\/query`/);
});

test('LLMHelper uses the QCloud SDK base URL derived from centralized constants', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /QCLOUD_OPENAI_SDK_BASE_URL/);
  assert.match(helper, /baseURL:\s*QCLOUD_OPENAI_SDK_BASE_URL/);
  assert.doesNotMatch(helper, /baseURL:\s*"https:\/\/rlbucefe\.sealosbja\.site\/v1"/);
});

test('LLMHelper routes QCLOUD chat calls through centralized endpoint and model', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /QCLOUD_CHAT_COMPLETIONS_ENDPOINT/);
  assert.match(helper, /private resolveQCloudRequestModel\(options:\s*ProviderRequestOptions\s*=\s*\{\}\):\s*string/);
  assert.match(helper, /return requested && QCLOUD_MODEL_SPECS\[requested\] \? requested : QCLOUD_CHAT_MODEL/);
  assert.match(helper, /const qcloudModel = this\.resolveQCloudRequestModel\(_options\)/);
  assert.match(helper, /const qcloudModel = this\.resolveQCloudRequestModel\(options\)/);
  assert.match(helper, /model:\s*qcloudModel/);
  assert.match(helper, /max_tokens:\s*this\.clampQCloudMaxOutputTokens\(_options\.maxOutputTokens,\s*qcloudModel\)/);
  assert.match(helper, /max_tokens:\s*this\.clampQCloudMaxOutputTokens\(options\.maxOutputTokens,\s*qcloudModel\)/);
  assert.doesNotMatch(helper, /https:\/\/api\.natively\.software\/v1\/chat/);
  assert.doesNotMatch(helper, /fetch\(QCLOUD_CHAT_ENDPOINT/);
});

test('LLMHelper uses turbo with thinking for QCLOUD skill requests and keeps lite32k for meeting summaries', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /QCLOUD_SKILL_CHAT_MODEL/);
  assert.match(helper, /QCLOUD_SKILL_CHAT_TIMEOUT_MS/);
  assert.match(helper, /QCLOUD_MEETING_SUMMARY_MODEL/);
  assert.match(helper, /QCLOUD_MEETING_SUMMARY_TIMEOUT_MS/);
  assert.match(helper, /chatPromptOptions\?\.activeSkill\s*\?\s*QCLOUD_SKILL_CHAT_MODEL\s*:\s*undefined/);
  assert.match(helper, /chatPromptOptions\?\.activeSkill\s*\?\s*QCLOUD_SKILL_CHAT_TIMEOUT_MS\s*:\s*chatPromptOptions\?\.totalTimeoutMs/);
  assert.match(helper, /chatPromptOptions\?\.activeSkill\s*\?\s*\{\s*type:\s*['"]enabled['"]\s+as\s+const\s*\}\s*:\s*chatPromptOptions\?\.qcloudThinking/);
  assert.match(helper, /qcloudModel:\s*qcloudChatModel/);
  assert.match(helper, /qcloudThinking:\s*qcloudThinking/);
  assert.match(helper, /timeoutMs:\s*qcloudChatTimeoutMs/);
  assert.match(helper, /totalTimeoutMs:\s*qcloudChatTimeoutMs/);
  assert.match(helper, /qcloudModel:\s*QCLOUD_MEETING_SUMMARY_MODEL/);
  assert.match(helper, /const qcloudSummaryTimeoutMs = QCLOUD_MEETING_SUMMARY_TIMEOUT_MS/);
  assert.match(helper, /generateMeetingSummary\(\s*systemPrompt:\s*string,\s*context:\s*string,\s*groqSystemPrompt\?:\s*string,\s*options\?:\s*\{\s*maxOutputTokens\?:\s*number\s*\},?\s*\)/);
  assert.match(helper, /maxOutputTokens:\s*options\?\.maxOutputTokens\s*\?\?\s*QCLOUD_MEETING_SUMMARY_OUTPUT_TOKENS/);
  assert.match(helper, /this\.generateWithNatively\(`Context:\\n\$\{context\}`,\s*systemPrompt,\s*undefined,\s*\{[\s\S]{0,220}qcloudModel:\s*QCLOUD_MEETING_SUMMARY_MODEL/);
});

test('LLMHelper passes explicit QCLOUD output budgets for chat and PPTX call sites', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /private getQCloudMaxOutputTokens/);
  assert.match(helper, /private clampQCloudMaxOutputTokens/);
  assert.match(helper, /generatePptxKnowledgeWithNatively\([\s\S]*options:\s*ProviderRequestOptions\s*=\s*\{\}/);
  assert.match(helper, /this\.generateWithNatively\(userMessage,\s*systemPrompt,\s*imagePaths,\s*\{\s*\.\.\.options,\s*dataScopes\s*\}\)/);
  assert.match(helper, /this\.generateWithNatively\(cloudUserContent,\s*openaiSystemPrompt,\s*cloudImagePaths,\s*\{[\s\S]{0,180}maxOutputTokens:\s*chatPromptOptions\?\.maxOutputTokens,[\s\S]{0,180}timeoutMs:\s*qcloudChatTimeoutMs/);
  assert.match(helper, /this\.streamWithNatively\(userContent,\s*finalSystemPrompt,\s*imagePaths,\s*\{[\s\S]{0,500}maxOutputTokens:\s*chatPromptOptions\?\.maxOutputTokens,[\s\S]{0,500}totalTimeoutMs:\s*qcloudChatTimeoutMs/);
});

test('LLMHelper defaults QCLOUD thinking off unless explicitly enabled by request options', () => {
  const helper = read('electron/LLMHelper.ts');
  const nonStreamingStart = helper.indexOf('  private async generateWithNatively(');
  const streamingStart = helper.indexOf('  private async * streamWithNatively(');
  const nonStreamingBody = helper.slice(nonStreamingStart, streamingStart);
  const streamingBody = helper.slice(
    streamingStart,
    helper.indexOf('  private extractQCloudSseUsage(', streamingStart),
  );

  assert.ok(nonStreamingStart >= 0, 'generateWithNatively should exist');
  assert.ok(streamingStart >= 0, 'streamWithNatively should exist');
  assert.match(nonStreamingBody, /thinking:\s*_options\.qcloudThinking\s*\?\?\s*\{\s*type:\s*['"]disabled['"]\s*\}/);
  assert.match(streamingBody, /thinking:\s*options\.qcloudThinking\s*\?\?\s*\{\s*type:\s*['"]disabled['"]\s*\}/);
});

test('streamChat uses real QCLOUD SSE stream for the selected QCLOUD model', () => {
  const helper = read('electron/LLMHelper.ts');
  const streamChatInner = helper.slice(
    helper.indexOf('  private async * _streamChatInner('),
    helper.indexOf('  /**\n   * Stream response from Groq', helper.indexOf('  private async * _streamChatInner(')),
  );
  const selectedQCloudBlock = streamChatInner.slice(
    streamChatInner.indexOf("if (this.currentModelId === 'natively')"),
    streamChatInner.indexOf('// 4. Gemini Routing & Fallback'),
  );

  assert.match(selectedQCloudBlock, /yield\*\s*this\.streamWithNatively\(userContent,\s*finalSystemPrompt,\s*imagePaths/);
  assert.doesNotMatch(selectedQCloudBlock, /await this\.generateWithNatively\(userContent,\s*finalSystemPrompt,\s*imagePaths/);
  assert.doesNotMatch(selectedQCloudBlock, /yield response/);
});

test('QCLOUD streaming parser handles standard SSE, custom delta, non-stream JSON, and empty streams', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /private extractQCloudStreamContent/);
  assert.match(helper, /choices\?\.\[0\]\?\.delta\?\.content/);
  assert.match(helper, /choices\?\.\[0\]\?\.message\?\.content/);
  assert.match(helper, /chunk\?\.delta/);
  assert.match(helper, /chunk\?\.data\?\.content/);
  assert.match(helper, /content-type/);
  assert.match(helper, /QCLOUD API returned an empty non-streaming response/);
  assert.match(helper, /QCLOUD API streaming response was empty/);
  assert.match(helper, /payload === '\[DONE\]'/);
});

test('LLMHelper advertises QCLOUD model metadata to provider routing', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /natively:\s*QCLOUD_CHAT_MODEL/);
});

test('LLMHelper detects persisted QCLOUD keys when memory key is not initialized', () => {
  const helper = read('electron/LLMHelper.ts');
  const start = helper.indexOf('  private hasNatively(): boolean');
  const end = helper.indexOf('  /**', start);
  const method = helper.slice(start, end);

  assert.ok(start >= 0, 'hasNatively should exist');
  assert.match(method, /getNativelyApiKey\(\)/);
  assert.match(method, /this\.nativelyKey/);
});
