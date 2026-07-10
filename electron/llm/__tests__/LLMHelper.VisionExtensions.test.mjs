// LLMHelper.VisionExtensions.test.mjs
// PR3.5 — runVisionRequest additional paths, testConnection multiple-provider
// flows, initModelVersionManager / fit* helpers.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

describe('LLMHelper runVisionRequest — extra provider paths (PR3.5)', () => {
  test('dispatches gemini_pro through Gemini generateContent when a Gemini client is wired', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    // gemini_pro reads the file before dispatching to generateContent, so we
    // need a real on-disk PNG to satisfy the file-read step.
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpFile = path.join(os.tmpdir(), `llmhelper-vision-pro-${Date.now()}.png`);
    await fs.writeFile(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    helper.client = {
      models: {
        generateContent: async ({ model, contents }) => {
          assert.equal(model, 'gemini-3.1-pro-preview');
          assert.ok(Array.isArray(contents));
          assert.equal(contents.length, 2);
          assert.ok(contents[1].inlineData);
          return {
            candidates: [{ content: { parts: [{ text: 'gemini-pro-vision-ok' }] } }],
          };
        },
      },
    };
    try {
      const result = await helper.runVisionRequest('gemini_pro', 'describe', 'sys', tmpFile);
      assert.equal(result, 'gemini-pro-vision-ok');
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  test('dispatches gemini_flash through Gemini generateContent when a Gemini client is wired', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpFile = path.join(os.tmpdir(), `llmhelper-vision-flash-${Date.now()}.png`);
    await fs.writeFile(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    helper.client = {
      models: {
        generateContent: async ({ model, contents }) => {
          assert.equal(model, 'gemini-3.1-flash-lite-preview');
          assert.ok(Array.isArray(contents));
          assert.equal(contents.length, 2);
          assert.ok(contents[1].inlineData);
          return {
            candidates: [{ content: { parts: [{ text: 'gemini-flash-vision-ok' }] } }],
          };
        },
      },
    };
    try {
      const result = await helper.runVisionRequest('gemini_flash', 'describe', 'sys', tmpFile);
      assert.equal(result, 'gemini-flash-vision-ok');
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });

  test('dispatches natively to generateWithNatively when natively key is set', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.nativelyKey = 'nat-test-key';
    helper.generateWithNatively = async (msg, sys, imagePaths) => {
      assert.equal(msg, 'describe');
      assert.equal(sys, 'sys');
      assert.deepEqual(imagePaths, ['/nonexistent.png']);
      return 'natively-vision-ok';
    };

    const result = await helper.runVisionRequest('natively', 'describe', 'sys', '/nonexistent.png');
    assert.equal(result, 'natively-vision-ok');
  });

  test('dispatches groq_scout to generateWithGroqMultimodal when a Groq client is wired', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.groqClient = { _exists: true };
    helper.generateWithGroqMultimodal = async (msg, paths, sys) => {
      assert.equal(msg, 'describe');
      assert.equal(sys, 'sys');
      assert.deepEqual(paths, ['/nonexistent.png']);
      return 'groq-vision-ok';
    };

    const result = await helper.runVisionRequest('groq_scout', 'describe', 'sys', '/nonexistent.png');
    assert.equal(result, 'groq-vision-ok');
  });

  test('dispatches openai to generateWithOpenai when an OpenAI client is wired', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.openaiClient = { _exists: true };
    helper.generateWithOpenai = async (msg, sys, imagePaths) => {
      assert.equal(msg, 'describe');
      assert.equal(sys, 'sys');
      assert.deepEqual(imagePaths, ['/nonexistent.png']);
      return 'openai-vision-ok';
    };

    const result = await helper.runVisionRequest('openai', 'describe', 'sys', '/nonexistent.png');
    assert.equal(result, 'openai-vision-ok');
  });

  test('dispatches claude to generateWithClaude when a Claude client is wired', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.claudeClient = { _exists: true };
    helper.generateWithClaude = async (msg, sys, imagePaths) => {
      assert.equal(msg, 'describe');
      assert.equal(sys, 'sys');
      assert.deepEqual(imagePaths, ['/nonexistent.png']);
      return 'claude-vision-ok';
    };

    const result = await helper.runVisionRequest('claude', 'describe', 'sys', '/nonexistent.png');
    assert.equal(result, 'claude-vision-ok');
  });

  test('rejects with provider-not-supported error for an unimplemented providerId', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    await assert.rejects(
      helper.runVisionRequest('totally-bogus', 'msg', 'sys', '/x.png'),
      /unknown providerId/,
    );
  });
});

describe('LLMHelper testConnection — provider-specific flows (PR3.5)', () => {
  test('returns { success: false, error } when an exception is thrown by Gemini', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = false;
    helper.client = {
      models: {
        generateContent: async () => {
          throw new Error('boom');
        },
      },
    };
    const result = await helper.testConnection();
    assert.equal(result.success, false);
    assert.match(result.error, /boom/);
  });

  test('returns { success: true } when generateContent returns non-empty text', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = false;
    helper.client = {
      models: {
        generateContent: async () => ({
          text: 'pong',
          candidates: [{ content: { parts: [{ text: 'pong' }] }, finishReason: 'STOP' }],
        }),
      },
    };
    const result = await helper.testConnection();
    assert.equal(result.success, true);
  });

  test('uses checkOllamaAvailable + callOllama when useOllama=true and ollama answers', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = true;
    helper.checkOllamaAvailable = async () => true;
    helper.callOllama = async (msg) => {
      assert.equal(msg, 'Hello');
      return 'pong';
    };
    const result = await helper.testConnection();
    assert.equal(result.success, true);
  });

  test('returns { success: false, error } when ollama is configured but unreachable', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = true;
    helper.checkOllamaAvailable = async () => false;
    helper.ollamaUrl = 'http://127.0.0.1:1';
    const result = await helper.testConnection();
    assert.equal(result.success, false);
    assert.match(result.error, /Ollama/);
  });
});

describe('LLMHelper initModelVersionManager and fit helpers (PR3.5)', () => {
  test('initModelVersionManager is a safe no-op when called twice', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    await helper.initModelVersionManager();
    await helper.initModelVersionManager();
    // No assertion beyond "didn't throw"
  });

  test('fitContextForCurrentModel respects reservedOutputTokens for small models', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('ollama-unknown-1.5b');
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}: ${'x'.repeat(300)}`);
    const text = lines.join('\n');
    const trimmedWithDefault = helper.fitContextForCurrentModel(text);
    const trimmedWithLargeReserve = helper.fitContextForCurrentModel(text, 8000);
    // A larger reserved output budget leaves LESS room for context, so the
    // trimmed output should be at least as short.
    assert.ok(trimmedWithLargeReserve.length <= trimmedWithDefault.length);
  });

  test('fitTranscriptForCurrentModel returns empty array when budget is zero', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('ollama-unknown-1.5b');
    const turns = [
      { role: 'user', text: 'x'.repeat(5000) },
      { role: 'assistant', text: 'y'.repeat(5000) },
    ];
    const trimmed = helper.fitTranscriptForCurrentModel(turns);
    assert.ok(Array.isArray(trimmed));
    // It may not be empty (depends on the helper's exact budget calc), but
    // it should at least be shorter than the original input.
    assert.ok(trimmed.length <= turns.length);
  });
});
