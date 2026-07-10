// LLMHelper.VisionAndContext.test.mjs
// PR3.3 — runVisionRequest dispatch, canUseLocalFallback/ollama plumbing,
// fitContextForCurrentModel / fitTranscriptForCurrentModel token budgets,
// extractFromCommonFormats response shaping, and switchToCurl.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

describe('LLMHelper vision + context utilities (PR3.3)', () => {
  test('switchToCurl stores the active curl provider and clears ollama/custom', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.useOllama = true;
    helper.customProvider = { id: 'x', name: 'X' };

    helper.switchToCurl({ id: 'curl-1', name: 'CurlOne', curlCommand: 'curl http://x' });

    assert.equal(helper.useOllama, false);
    assert.equal(helper.customProvider, null);
    assert.deepEqual(helper.activeCurlProvider, { id: 'curl-1', name: 'CurlOne', curlCommand: 'curl http://x' });
  });

  test('extractFromCommonFormats returns text from a variety of response shapes', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    assert.equal(helper.extractFromCommonFormats('plain string'), 'plain string');
    assert.equal(helper.extractFromCommonFormats({ response: 'ollama' }), 'ollama');
    assert.equal(
      helper.extractFromCommonFormats({ choices: [{ message: { content: 'openai-style' } }] }),
      'openai-style',
    );
    assert.equal(
      helper.extractFromCommonFormats({ choices: [{ delta: { content: 'stream-delta' } }] }),
      'stream-delta',
    );
    assert.equal(
      helper.extractFromCommonFormats({ content: [{ text: 'claude-style' }] }),
      'claude-style',
    );
    assert.equal(helper.extractFromCommonFormats({ text: 'gemini-style' }), 'gemini-style');
    assert.equal(helper.extractFromCommonFormats({ output: 'generic-output' }), 'generic-output');
    assert.equal(helper.extractFromCommonFormats({ result: 'generic-result' }), 'generic-result');
    // Empty choices -> empty string
    assert.equal(helper.extractFromCommonFormats({ choices: [] }), '');
    // Unknown shape -> stringified JSON fallback
    const fallback = helper.extractFromCommonFormats({ something: 'else' });
    assert.equal(fallback, JSON.stringify({ something: 'else' }));
    // Null / empty -> empty
    assert.equal(helper.extractFromCommonFormats(null), '');
    assert.equal(helper.extractFromCommonFormats(undefined), '');
  });

  test('fitContextForCurrentModel returns input unchanged for large-context models (Gemini/Claude/OpenAI)', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gemini');
    const long = 'x'.repeat(200_000);
    assert.equal(helper.fitContextForCurrentModel(long), long, 'no trimming for 100k+ context');
  });

  test('fitContextForCurrentModel trims from the front when the budget is exceeded for small models', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    // An unknown ollama model with a sub-13B size falls into the local-small
    // tier (8k context) and is NOT in the KNOWN_OLLAMA_NATIVE_CTX table, so
    // its max context stays at 8k — well under the 100k skip threshold.
    helper.setModel('ollama-unknown-1.5b');
    // Build a transcript that's guaranteed to overflow.
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}: ${'x'.repeat(200)}`);
    const text = lines.join('\n');
    const trimmed = helper.fitContextForCurrentModel(text);
    assert.ok(trimmed.length < text.length, `expected trim, got ${trimmed.length} vs ${text.length}`);
    assert.ok(trimmed.includes('line 999'), 'keeps the latest line at the tail');
  });

  test('fitContextForCurrentModel returns falsy input untouched', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    assert.equal(helper.fitContextForCurrentModel(null), null);
    assert.equal(helper.fitContextForCurrentModel(''), '');
    assert.equal(helper.fitContextForCurrentModel(undefined), undefined);
  });

  test('fitTranscriptForCurrentModel truncates turns to the model budget', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('ollama-unknown-1.5b');
    const turns = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(500),
    }));
    const trimmed = helper.fitTranscriptForCurrentModel(turns);
    assert.ok(Array.isArray(trimmed), 'returns an array');
    assert.ok(trimmed.length < turns.length, `expected trim, got ${trimmed.length} of ${turns.length}`);
  });

  test('canUseLocalFallback returns false when ollama is not running', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.ollamaUrl = 'http://127.0.0.1:1'; // unreachable port

    const result = await helper.canUseLocalFallback(false);
    assert.equal(result, false);
  });

  test('hasNatively / hasGroq / hasOpenai / hasClaude / hasDoubao return true only when wired', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    assert.equal(helper.hasDoubao(), false);
    assert.equal(helper.hasGroq(), false);
    assert.equal(helper.hasOpenai(), false);
    assert.equal(helper.hasClaude(), false);

    helper.setDoubaoApiKey('sk-doubao');
    helper.setGroqApiKey('gsk-x');
    helper.setOpenaiApiKey('sk-o');
    helper.setClaudeApiKey('sk-c');

    assert.equal(helper.hasDoubao(), true);
    assert.equal(helper.hasGroq(), true);
    assert.equal(helper.hasOpenai(), true);
    assert.equal(helper.hasClaude(), true);
  });

  test('runVisionRequest rejects with a clear error when an unknown providerId is passed', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    await assert.rejects(
      helper.runVisionRequest('unknown-provider', 'hi', 'sys', '/tmp/img.png'),
      /runVisionRequest: unknown providerId/,
    );
  });

  test('runVisionRequest dispatches doubao -> generateWithDoubao', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let capturedModel = null;
    helper.doubaoClient = {
      chat: {
        completions: {
          create: async (body) => {
            capturedModel = body.model;
            return { choices: [{ message: { content: 'vision-ok' } }] };
          },
        },
      },
    };
    // The vision path with non-existent imagePaths skips the image part,
    // so this works as a pure text call.
    const result = await helper.runVisionRequest('doubao', 'describe', 'sys', '/nonexistent.png');
    assert.equal(result, 'vision-ok');
    assert.ok(capturedModel, 'doubao client was invoked');
  });

  test('runVisionRequest dispatches custom -> executeCustomProvider when a custom provider is configured', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.customProvider = {
      id: 'mine',
      name: 'MyCurl',
      curlCommand: "curl -X POST 'http://example.test/v1/chat' -H 'Content-Type: application/json' -d '{\"messages\":[{\"role\":\"user\",\"content\":\"$TEXT\"}]}'",
    };
    // Stub global fetch so the curl-derived request returns a parseable response.
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'custom-curl-ok' } }] }),
      };
    };
    try {
      const result = await helper.runVisionRequest('custom', 'describe', 'sys', '/nonexistent.png');
      assert.equal(result, 'custom-curl-ok');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('runVisionRequest rejects when gemini_flash is requested but no Gemini client is wired', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    // Create a real on-disk image so the implementation gets past the
    // filesystem read step and reaches the client-missing check.
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpFile = path.join(os.tmpdir(), `llmhelper-vision-${Date.now()}.png`);
    await fs.writeFile(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes
    try {
      await assert.rejects(
        helper.runVisionRequest('gemini_flash', 'describe', 'sys', tmpFile),
        /Gemini client not initialized/,
      );
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });
});
