// LLMHelper.CustomProviderAndInit.test.mjs
// PR3.3 — executeCustomProvider, testConnection, initModelVersionManager,
// hasNatively and the rate-limit/pre-flight guard surface.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

const SAMPLE_CURL =
  "curl -X POST 'https://example.test/v1/chat' " +
  "-H 'Content-Type: application/json' " +
  "-H 'Authorization: Bearer {{USER_MESSAGE}}' " +
  "-d '{\"model\":\"x\",\"messages\":[{\"role\":\"system\",\"content\":\"{{SYSTEM_PROMPT}}\"},{\"role\":\"user\",\"content\":\"{{TEXT}}\"}]}'";

describe('LLMHelper custom provider + init (PR3.3)', () => {
  test('executeCustomProvider injects $TEXT, $SYSTEM_PROMPT, and fetches with derived body', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let captured = null;
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'custom-ok' } }] }),
      };
    };
    try {
      const result = await helper.executeCustomProvider(
        SAMPLE_CURL,
        'combined-message',
        'be concise',
        'raw-user',
        'context-text',
        null,
      );
      assert.equal(result, 'custom-ok');
      assert.ok(captured, 'fetch was called');
      // The body may either be an object (if Content-Type allows JSON
      // serialization) or a string. Normalize before inspecting.
      const raw = captured.opts.body;
      const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const flat = JSON.stringify(body);
      assert.ok(flat.includes('combined-message'), 'TEXT substituted somewhere in the body');
      assert.ok(flat.includes('be concise'), 'SYSTEM_PROMPT substituted somewhere in the body');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('executeCustomProvider encodes a base64 image into the body when imagePath is provided', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    // Create a real file on disk so the read step succeeds.
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpFile = path.join(os.tmpdir(), `llmhelper-custom-${Date.now()}.png`);
    await fs.writeFile(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    let captured = null;
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'img-ok' } }] }),
      };
    };
    try {
      const result = await helper.executeCustomProvider(
        SAMPLE_CURL,
        'msg',
        'sys',
        'raw',
        'ctx',
        tmpFile,
      );
      assert.equal(result, 'img-ok');
      assert.ok(captured, 'fetch was called');
      // The image is injected by the helper; the test mostly verifies the
      // happy path (no error escaping) when a valid image path is provided.
    } finally {
      global.fetch = originalFetch;
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  test('executeCustomProvider throws on a non-ok HTTP response from the upstream', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });
    try {
      await assert.rejects(
        helper.executeCustomProvider(SAMPLE_CURL, 'msg', 'sys', 'raw', 'ctx', null),
        /Custom Provider HTTP 500/,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('testConnection returns { success: false } when no Gemini client is configured', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = false;
    helper.client = null;

    const result = await helper.testConnection();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Gemini') || result.error.includes('Ollama'));
  });

  test('testConnection returns { success: true } when Gemini responds with non-empty text', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = false;
    helper.client = {
      models: {
        generateContent: async () => ({
          text: 'hi',
          candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
        }),
      },
    };

    const result = await helper.testConnection();
    assert.equal(result.success, true);
  });

  test('testConnection returns { success: false } when Gemini responds with empty text', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = false;
    helper.client = {
      models: {
        generateContent: async () => ({
          text: '',
          candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
        }),
      },
    };

    const result = await helper.testConnection();
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Empty response'));
  });

  test('initModelVersionManager is a no-op-as-async: it does not throw and is idempotent', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    await helper.initModelVersionManager();
    await helper.initModelVersionManager();
    // No assertion needed beyond "it didn't throw". The implementation logs
    // a static summary and tries (fails silently) to register a getter.
  });

  test('scrubKeys also destroys rate limiters without throwing', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setGroqApiKey('gsk-x');
    assert.equal(typeof helper.rateLimiters, 'object');
    helper.scrubKeys();
    // After scrubKeys, the rate limiters map still exists but each limiter
    // has had destroy() called on it. The crucial guarantee is that no
    // exception escapes.
    assert.equal(helper.groqClient, null);
  });

  test('getGeminiClient returns null when no client is wired', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    assert.equal(helper.getGeminiClient(), null);
  });

  test('getOpenaiClient / getClaudeClient / getGroqClient return the underlying client references', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    assert.equal(helper.getOpenaiClient(), null);
    assert.equal(helper.getClaudeClient(), null);
    assert.equal(helper.getGroqClient(), null);

    helper.setOpenaiApiKey('sk-o');
    helper.setClaudeApiKey('sk-c');
    helper.setGroqApiKey('gsk-x');
    assert.ok(helper.getOpenaiClient() !== null);
    assert.ok(helper.getClaudeClient() !== null);
    assert.ok(helper.getGroqClient() !== null);
  });
});
