// LLMHelper.BasicAndSetters.test.mjs
// PR3.1 — Basic surface: constructor, setApiKey*, setLocalOnlyMode, scrubKeys,
// getActiveCustomProvider, getOpenAiPromptCacheKey, isThinkingModel,
// isOpenAiModel, isClaudeModel, isDoubaoModel, isGroqModel.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

describe('LLMHelper basic surface and setters (PR3.1)', () => {
  test('constructor: defaults are populated, no client is wired without an API key', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    assert.equal(helper.useOllama, false, 'default useOllama must be false');
    assert.equal(helper.isLocalOnly(), false, 'default local-only must be disabled');
    assert.equal(helper.apiKey, null, 'apiKey defaults to null when no key supplied');
    assert.equal(helper.groqClient, null, 'no groq client by default');
    assert.equal(helper.openaiClient, null, 'no openai client by default');
    assert.equal(helper.claudeClient, null, 'no claude client by default');
    assert.equal(helper.doubaoClient, null, 'no doubao client by default');
    assert.equal(helper.ollamaUrl, 'http://127.0.0.1:11434', 'ollama default URL');
    assert.equal(typeof helper.currentModelId, 'string', 'currentModelId is a string');
  });

  test('constructor: passes provider keys straight through to its clients', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper(
      'sk-gemini',
      false,
      undefined,
      undefined,
      'gsk-groq',
      'sk-openai',
      'sk-anthropic',
      'sk-doubao',
    );

    assert.equal(helper.groqApiKey, 'gsk-groq');
    assert.equal(helper.openaiApiKey, 'sk-openai');
    assert.equal(helper.claudeApiKey, 'sk-anthropic');
    assert.equal(helper.doubaoApiKey, 'sk-doubao');
    assert.equal(helper.groqClient !== null, true, 'groq client should be wired');
    assert.equal(helper.openaiClient !== null, true, 'openai client should be wired');
    assert.equal(helper.claudeClient !== null, true, 'claude client should be wired');
    assert.equal(helper.doubaoClient !== null, true, 'doubao client should be wired');
    assert.equal(helper.apiKey, 'sk-gemini');
  });

  test('setLocalOnlyMode toggles the isLocalOnly() flag', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    assert.equal(helper.isLocalOnly(), false);

    helper.setLocalOnlyMode(true);
    assert.equal(helper.isLocalOnly(), true);
    assert.equal(helper.isLocalOnlyMode, true);

    helper.setLocalOnlyMode(false);
    assert.equal(helper.isLocalOnly(), false);
  });

  test('setApiKey wires a Gemini client; clear it via scrubKeys()', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    assert.equal(helper.client, null);

    helper.setApiKey('sk-gemini');
    assert.equal(helper.apiKey, 'sk-gemini');
    assert.equal(helper.client !== null, true);

    helper.scrubKeys();
    assert.equal(helper.apiKey, null, 'apiKey must be cleared on scrub');
    assert.equal(helper.client, null, 'client must be cleared on scrub');
  });

  test('setGroqApiKey / setOpenaiApiKey / setClaudeApiKey / setDoubaoApiKey / setNativelyKey all wire clients', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    helper.setGroqApiKey('gsk-test');
    assert.equal(helper.groqClient !== null, true);
    assert.equal(helper._groqLocalDisabled, false, 'setGroqApiKey resets the 401 trip');

    helper.setOpenaiApiKey('sk-test');
    assert.equal(helper.openaiApiKey, 'sk-test');
    assert.equal(helper.openaiClient !== null, true);

    helper.setClaudeApiKey('sk-ant');
    assert.equal(helper.claudeApiKey, 'sk-ant');
    assert.equal(helper.claudeClient !== null, true);

    helper.setDoubaoApiKey('sk-doubao');
    assert.equal(helper.doubaoApiKey, 'sk-doubao');
    assert.equal(helper.doubaoClient !== null, true);

    helper.setNativelyKey('natively-test');
    assert.equal(helper.nativelyKey, 'natively-test');
    assert.equal(helper.qcloudClient !== null, true);

    helper.setNativelyKey(null);
    assert.equal(helper.nativelyKey, null);
    assert.equal(helper.qcloudClient, null, 'setNativelyKey(null) must clear the qcloud client');
  });

  test('is* model id classifiers return true for known prefixes and false otherwise', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    assert.equal(helper.isOpenAiModel('gpt-4o'), true);
    assert.equal(helper.isOpenAiModel('o1-mini'), true);
    assert.equal(helper.isOpenAiModel('o3-pro'), true);
    assert.equal(helper.isOpenAiModel('claude-3-5-sonnet'), false);

    assert.equal(helper.isClaudeModel('claude-3-5-sonnet-latest'), true);
    assert.equal(helper.isClaudeModel('claude-opus-4-1'), true);
    assert.equal(helper.isClaudeModel('gpt-4o'), false);

    assert.equal(helper.isDoubaoModel('doubao-1-5-pro'), true);
    assert.equal(helper.isDoubaoModel('volc.flash'), true);
    assert.equal(helper.isDoubaoModel('ep-pro'), true);
    assert.equal(helper.isDoubaoModel('llama-3.1'), false);

    assert.equal(helper.isGroqModel('llama-3.3-70b'), true);
    assert.equal(helper.isGroqModel('mixtral-8x7b'), true);
    assert.equal(helper.isGroqModel('qwen/qwen-2.5'), true);
    assert.equal(helper.isGroqModel('gpt-4o'), false);

    assert.equal(helper.isGeminiModel('gemini-2.0-flash'), true);
    assert.equal(helper.isGeminiModel('models/gemini-1.5-pro'), true);
    assert.equal(helper.isGeminiModel('gpt-4o'), false);
  });

  test('isThinkingModel flags qwen3, qwq, deepseek-r1, o1/o3 family as thinking models', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    assert.equal(helper.isThinkingModel('qwen3-32b'), true, 'qwen3 is thinking');
    assert.equal(helper.isThinkingModel('QWQ-preview'), true, 'qwq is thinking (case insensitive)');
    assert.equal(helper.isThinkingModel('deepseek-r1-distill'), true, 'deepseek-r1 is thinking');
    assert.equal(helper.isThinkingModel('o1-preview'), true, 'o1 is thinking');
    assert.equal(helper.isThinkingModel('o1'), true, 'o1 alone is thinking');
    assert.equal(helper.isThinkingModel('gpt-4o'), false, 'gpt-4o is not thinking');
    assert.equal(helper.isThinkingModel('claude-3-5-sonnet'), false, 'claude is not thinking');
    assert.equal(helper.isThinkingModel(''), false, 'empty string is not thinking');
    assert.equal(helper.isThinkingModel(null), false, 'null is not thinking');
  });

  test('getOpenAiPromptCacheKey returns undefined for empty system prompt and a stable hash otherwise', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    assert.equal(helper.getOpenAiPromptCacheKey(''), undefined, 'empty prompt -> undefined');
    assert.equal(helper.getOpenAiPromptCacheKey(undefined), undefined, 'undefined prompt -> undefined');
    assert.equal(helper.getOpenAiPromptCacheKey(null), undefined, 'null prompt -> undefined');

    const a = helper.getOpenAiPromptCacheKey('You are a helpful assistant.');
    const b = helper.getOpenAiPromptCacheKey('You are a helpful assistant.');
    const c = helper.getOpenAiPromptCacheKey('You are NOT helpful.');
    assert.equal(typeof a, 'string', 'hash should be a string');
    assert.equal(a.length, 32, 'cache key hash is 32 hex chars');
    assert.equal(a, b, 'same prompt -> same key');
    assert.notEqual(a, c, 'different prompt -> different key');
  });

  test('scrubKeys() clears all provider credentials and clients', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper(
      'sk-gemini',
      false,
      undefined,
      undefined,
      'gsk-groq',
      'sk-openai',
      'sk-anthropic',
      'sk-doubao',
    );
    helper.setNativelyKey('natively-x');

    helper.scrubKeys();

    assert.equal(helper.apiKey, null);
    assert.equal(helper.groqApiKey, null);
    assert.equal(helper.openaiApiKey, null);
    assert.equal(helper.claudeApiKey, null);
    assert.equal(helper.nativelyKey, null);
    assert.equal(helper.client, null);
    assert.equal(helper.groqClient, null);
    assert.equal(helper.openaiClient, null);
    assert.equal(helper.claudeClient, null);
  });

  test('setCodexCliConfig + getCodexCliConfig round-trip a normalized config', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    helper.setCodexCliConfig({ enabled: true, model: 'gpt-5-codex', path: '/usr/bin/codex' });
    const cfg = helper.getCodexCliConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.model, 'gpt-5-codex');
  });

  test('getCurrentProvider reports provider kind for built-in models, custom, and ollama', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    helper.setModel('gemini');
    assert.equal(helper.getCurrentProvider(), 'gemini');

    helper.setModel('doubao-1-5-pro-32k-250115');
    assert.equal(helper.getCurrentProvider(), 'doubao');

    helper.setModel('natively');
    assert.equal(helper.getCurrentProvider(), 'natively');

    helper.setModel('claude');
    assert.equal(helper.getCurrentProvider(), 'gemini', 'claude alias -> gemini fallback provider');

    helper.setModel('llama');
    assert.equal(helper.getCurrentProvider(), 'gemini', 'llama alias -> gemini fallback provider');

    // Ollama branch in setModel preserves currentModelId, so test it from
    // a non-doubao starting point to avoid the persistent model id masking it.
    helper.setModel('gemini');
    helper.setModel('ollama-llama3.1');
    assert.equal(helper.useOllama, true);
    assert.equal(helper.getCurrentModel(), 'llama3.1', 'getCurrentModel returns ollamaModel when ollama is active');

    helper.customProvider = { id: 'mine', name: 'Mine' };
    assert.equal(helper.getCurrentProvider(), 'custom');
  });
});
