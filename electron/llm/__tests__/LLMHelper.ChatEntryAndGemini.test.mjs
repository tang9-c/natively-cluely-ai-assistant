// LLMHelper.ChatEntryAndGemini.test.mjs
// PR3.5 — chat() entry point, generateWithPro / generateWithFlash direct Gemini
// dispatch, and executeCustomProvider response-format edge cases.

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
  "-d '{\"model\":\"x\",\"messages\":[{\"role\":\"user\",\"content\":\"{{TEXT}}\"}]}'";

describe('LLMHelper chat() entry + Gemini direct dispatch (PR3.5)', () => {
  test('chat() aggregates streamChat output into a single string', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    // Pre-set model so streamChat picks a deterministic path.
    helper.setModel('gemini');
    // Stub the underlying streamChat to yield three chunks.
    helper.streamChat = async function* () {
      yield 'hello ';
      yield 'there ';
      yield 'world';
    };

    const result = await helper.chat('msg');
    assert.equal(result, 'hello there world');
  });

  test('chat() returns empty string when streamChat yields nothing', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gemini');
    helper.streamChat = async function* () {
      // empty stream
    };

    const result = await helper.chat('msg');
    assert.equal(result, '');
  });

  test('chat() forwards optional imagePaths and context into streamChat', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gemini');
    let capturedArgs = null;
    helper.streamChat = async function* (...args) {
      capturedArgs = args;
      yield 'ok';
    };

    await helper.chat('msg', ['/tmp/a.png'], 'extra context', 'sys-override', true);
    assert.equal(capturedArgs[0], 'msg');
    assert.deepEqual(capturedArgs[1], ['/tmp/a.png']);
    assert.equal(capturedArgs[2], 'extra context');
    assert.equal(capturedArgs[3], 'sys-override');
    // The 5th arg is skipKnowledgeMode, 6th skipModeInjection.
    assert.equal(capturedArgs[5], true);
  });

  test('generateWithPro calls Gemini Pro model and returns text', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let captured = null;
    helper.client = {
      models: {
        generateContent: async (req) => {
          captured = req;
          return { text: 'pro-response' };
        },
      },
    };

    const result = await helper.generateWithPro([{ text: 'ping' }]);
    assert.equal(result, 'pro-response');
    // Don't pin to a specific model name; the constants may evolve. Just
    // assert that the model id ends with 'pro'.
    assert.match(captured.model, /pro/);
  });

  test('generateWithFlash calls Gemini Flash model and returns text', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let captured = null;
    helper.client = {
      models: {
        generateContent: async (req) => {
          captured = req;
          return { text: 'flash-response' };
        },
      },
    };

    const result = await helper.generateWithFlash([{ text: 'ping' }]);
    assert.equal(result, 'flash-response');
    assert.match(captured.model, /flash/);
  });

  test('generateWithPro throws when Gemini client is not initialized', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.client = null;
    await assert.rejects(helper.generateWithPro([{ text: 'x' }]), /Gemini client not initialized/);
  });

  test('generateWithFlash throws when Gemini client is not initialized', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.client = null;
    await assert.rejects(helper.generateWithFlash([{ text: 'x' }]), /Gemini client not initialized/);
  });

  test('generateWithPro returns empty string when Gemini returns no text', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.client = {
      models: {
        generateContent: async () => ({ text: '' }),
      },
    };
    const result = await helper.generateWithPro([{ text: 'x' }]);
    assert.equal(result, '');
  });

  test('generateWithFlash returns empty string when Gemini returns no text', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.client = {
      models: {
        generateContent: async () => ({ text: '' }),
      },
    };
    const result = await helper.generateWithFlash([{ text: 'x' }]);
    assert.equal(result, '');
  });
});

describe('LLMHelper executeCustomProvider response shapes (PR3.5)', () => {
  test('extracts Anthropic-style { content: [{ text }] } from custom response', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'claude-shape' }] }),
    });
    try {
      const result = await helper.executeCustomProvider(
        SAMPLE_CURL,
        'msg',
        'sys',
        'raw',
        'ctx',
        null,
      );
      assert.equal(result, 'claude-shape');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('extracts Ollama-style { response } from custom response', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: 'ollama-shape' }),
    });
    try {
      const result = await helper.executeCustomProvider(
        SAMPLE_CURL,
        'msg',
        'sys',
        'raw',
        'ctx',
        null,
      );
      assert.equal(result, 'ollama-shape');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('falls back to JSON.stringify for unknown response shape', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ weird: { nested: 'shape' } }),
    });
    try {
      const result = await helper.executeCustomProvider(
        SAMPLE_CURL,
        'msg',
        'sys',
        'raw',
        'ctx',
        null,
      );
      // The helper stringifies unknown shapes so the caller still has *some*
      // response to display.
      assert.equal(typeof result, 'string');
      assert.ok(result.includes('nested'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('executeCustomProvider injects $USER_MESSAGE separately from $TEXT', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let capturedBody = null;
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      capturedBody = opts.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      };
    };
    try {
      await helper.executeCustomProvider(
        "curl -X POST 'https://example.test/v1/chat' " +
        "-H 'Content-Type: application/json' " +
        "-d '{\"combined\":\"{{TEXT}}\",\"rawUser\":\"{{USER_MESSAGE}}\",\"sys\":\"{{SYSTEM_PROMPT}}\"}'",
        'combined-payload',
        'system-only',
        'raw-user-only',
        'ctx-only',
        null,
      );
      const body = typeof capturedBody === 'string' ? JSON.parse(capturedBody) : capturedBody;
      assert.equal(body.combined, 'combined-payload');
      assert.equal(body.rawUser, 'raw-user-only');
      assert.equal(body.sys, 'system-only');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('executeCustomProvider tolerates a missing image (imagePath nonexistent)', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'no-image-ok' } }] }),
    });
    try {
      const result = await helper.executeCustomProvider(
        SAMPLE_CURL,
        'msg',
        'sys',
        'raw',
        'ctx',
        '/nonexistent/path/image.png',
      );
      assert.equal(result, 'no-image-ok');
    } finally {
      global.fetch = originalFetch;
    }
  });
});