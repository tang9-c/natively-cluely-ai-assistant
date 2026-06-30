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

  assert.match(constants, /export const QCLOUD_LLM_BASE_URL = "https:\/\/rlbucefe\.sealosbja\.site"/);
  assert.match(constants, /export const QCLOUD_CHAT_MODEL = "lite32k"/);
  assert.match(constants, /export const QCLOUD_CHAT_ENDPOINT = `\$\{QCLOUD_LLM_BASE_URL\}\/v1\/chat`/);
  assert.match(constants, /export const QCLOUD_MODELS_ENDPOINT = `\$\{QCLOUD_LLM_BASE_URL\}\/v1\/models`/);
  assert.match(constants, /export const QCLOUD_CHAT_COMPLETIONS_ENDPOINT = `\$\{QCLOUD_LLM_BASE_URL\}\/v1\/chat\/completions`/);
});

test('LLMHelper uses the QCloud SDK base URL derived from centralized constants', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /QCLOUD_OPENAI_SDK_BASE_URL/);
  assert.match(helper, /baseURL:\s*QCLOUD_OPENAI_SDK_BASE_URL/);
  assert.doesNotMatch(helper, /baseURL:\s*"https:\/\/rlbucefe\.sealosbja\.site\/v1"/);
});

test('LLMHelper routes QCLOUD chat calls through centralized endpoint and model', () => {
  const helper = read('electron/LLMHelper.ts');

  assert.match(helper, /QCLOUD_CHAT_ENDPOINT/);
  assert.match(helper, /model:\s*QCLOUD_CHAT_MODEL/);
  assert.doesNotMatch(helper, /https:\/\/api\.natively\.software\/v1\/chat/);
});
