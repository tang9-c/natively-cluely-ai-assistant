import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
const doubaoConstantsPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/DoubaoModelConstants.js');

describe('LLMHelper structured generation', () => {
  test('generateContentStructured() falls back when Doubao exceeds per-provider timeout', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.doubaoClient = {
      chat: {
        completions: {
          create: () => new Promise(() => {}),
        },
      },
    };
    // Regression guard: the Doubao-timeout → Groq-fallback path that this test
    // previously covered was removed in debug session 2026-06-22 because Groq
    // (llama-3.3-70b-versatile) returns 403 in this environment. The chain
    // now must surface a structured "All reasoning models failed" error
    // quickly instead of hanging on the per-provider timeout. The new
    // behavior under test is: per-provider timeout is respected (no hang)
    // AND the function throws rather than silently rotating forever.
    helper.groqClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
        },
      },
    };

    const started = Date.now();
    await assert.rejects(
      helper.generateContentStructured('return json', {
        taskLabel: 'test',
        perProviderTimeoutMs: 40,
        maxOutputTokens: 128,
        maxRotations: 1,
      }),
      /All reasoning models failed/,
    );
    // Per-provider timeout must fire promptly; without the fix the chain
    // would loop forever through the hung Doubao provider.
    assert.ok(
      Date.now() - started < 2000,
      `expected fast failure, took ${Date.now() - started}ms`,
    );
  });

  test('generateContentStructured() passes Research-sized max output tokens to Doubao', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let capturedBody = null;
    helper.doubaoClient = {
      chat: {
        completions: {
          create: async (body) => {
            capturedBody = body;
            return { choices: [{ message: { content: '{"ok":true}' } }] };
          },
        },
      },
    };

    const result = await helper.generateContentStructured('return json', {
      taskLabel: 'company-research',
      perProviderTimeoutMs: 1000,
      maxOutputTokens: 8192,
      maxRotations: 1,
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(capturedBody.max_completion_tokens, 8192);
  });

  test('generateContentStructured() clamps Doubao max_completion_tokens to provider ceiling', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let capturedBody = null;
    helper.doubaoClient = {
      chat: {
        completions: {
          create: async (body) => {
            capturedBody = body;
            return { choices: [{ message: { content: '{"ok":true}' } }] };
          },
        },
      },
    };

    const result = await helper.generateContentStructured('return json', {
      taskLabel: 'company-research',
      perProviderTimeoutMs: 1000,
      maxOutputTokens: 65536,
      maxRotations: 1,
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(capturedBody.max_completion_tokens, 12288);
  });

  // Phase 4.4 (debug session 2026-06-22): regression guard for the
  // structured-generation chain. Groq's `llama-3.3-70b-versatile` returns 403
  // in this environment (model retired / key revoked). It must NOT be part of
  // the structured-generation provider chain — removing it prevents the
  // Doubao-timeout → Groq-403 loop that the ResearchDossierBuilder hits.
  // Chat / streaming paths are unaffected; they keep using Groq.
  test('generateContentStructured() does NOT call Groq even when groqClient is configured', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let groqCalls = 0;
    // Doubao hangs (mirrors the real 35s-timeout symptom). Without the
    // removal fix, the chain would fall through to Groq after the timeout;
    // with the fix, Groq must stay at zero calls.
    helper.doubaoClient = {
      chat: {
        completions: {
          create: () => new Promise(() => {}),
        },
      },
    };
    helper.groqClient = {
      chat: {
        completions: {
          create: async () => {
            groqCalls++;
            return { choices: [{ message: { content: '{"ok":true}' } }] };
          },
        },
      },
    };

    await assert.rejects(
      helper.generateContentStructured('return json', {
        taskLabel: 'company-research',
        perProviderTimeoutMs: 30,
        maxOutputTokens: 2048,
        maxRotations: 1,
      }),
      /All reasoning models failed/,
    );

    assert.equal(groqCalls, 0, 'Groq must not be invoked from generateContentStructured');
  });

  // Phase 4.1 (debug session): regression guard for the company-research
  // structured-generation path. The Lite Doubao model can't complete a
  // research-sized prompt within the 35s per-provider budget; switching to
  // the Pro tier is the documented fix.
  test('generateContentStructured() routes company-research to Doubao Pro model', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const { DOUBAO_PRO_MODEL } = cjsRequire(doubaoConstantsPath);
    const helper = new LLMHelper();
    let capturedBody = null;
    helper.doubaoClient = {
      chat: {
        completions: {
          create: async (body) => {
            capturedBody = body;
            return { choices: [{ message: { content: '{"ok":true}' } }] };
          },
        },
      },
    };

    await helper.generateContentStructured('return json', {
      taskLabel: 'company-research',
      perProviderTimeoutMs: 1000,
      maxOutputTokens: 2048,
      maxRotations: 1,
    });

    assert.ok(capturedBody, 'Doubao client was not called');
    assert.equal(
      capturedBody.model,
      DOUBAO_PRO_MODEL,
      'company-research must route to the Doubao Pro model, not the Lite tier',
    );
  });

  test('generateContentStructured() keeps Ollama available by default', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let ollamaCalls = 0;
    helper.useOllama = true;
    helper.ollamaModel = 'local-structured-model';
    helper.checkOllamaAvailable = async () => true;
    helper.callOllama = async () => {
      ollamaCalls += 1;
      return '{"source":"ollama"}';
    };

    const result = await helper.generateContentStructured('return json', {
      maxRotations: 1,
      perProviderTimeoutMs: 100,
    });

    assert.equal(result, '{"source":"ollama"}');
    assert.equal(ollamaCalls, 1);
  });

  test('cloud-only structured generation excludes local and unverified providers', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const calls = { ollamaAvailability: 0, ollama: 0, custom: 0, curl: 0, codex: 0 };
    helper.useOllama = true;
    helper.checkOllamaAvailable = async () => {
      calls.ollamaAvailability += 1;
      return true;
    };
    helper.callOllama = async () => {
      calls.ollama += 1;
      return '{"source":"ollama"}';
    };
    helper.customProvider = { name: 'unverified-custom', curlCommand: 'curl https://example.test' };
    helper.executeCustomProvider = async () => {
      calls.custom += 1;
      return '{"source":"custom"}';
    };
    helper.activeCurlProvider = { name: 'unverified-curl' };
    helper.chatWithCurl = async () => {
      calls.curl += 1;
      return '{"source":"curl"}';
    };
    helper.codexCliConfig = { ...helper.codexCliConfig, enabled: true, model: 'local-codex' };
    helper.generateWithCodexCli = async () => {
      calls.codex += 1;
      return '{"source":"codex"}';
    };

    await assert.rejects(
      helper.generateContentStructured('PRIVATE_TRANSCRIPT_MUST_NOT_BE_LOGGED', {
        requireCloudProvider: true,
        maxRotations: 1,
        perProviderTimeoutMs: 100,
      }),
      /No cloud reasoning model available/,
    );
    assert.deepEqual(calls, { ollamaAvailability: 0, ollama: 0, custom: 0, curl: 0, codex: 0 });
  });

  test('cloud-only structured generation does not log provider-echoed prompt content', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const sentinel = 'PRIVATE_TRANSCRIPT_ECHO_8C31';
    const warnings = [];
    const originalWarn = console.warn;
    helper.openaiClient = {};
    helper.generateWithOpenai = async () => {
      throw new Error(`provider rejected request containing ${sentinel}`);
    };
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    try {
      await assert.rejects(
        helper.generateContentStructured(sentinel, {
          requireCloudProvider: true,
          maxRotations: 1,
          perProviderTimeoutMs: 100,
        }),
        error => {
          assert.doesNotMatch(error.message, new RegExp(sentinel));
          return true;
        },
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.doesNotMatch(warnings.join('\n'), new RegExp(sentinel));
  });
});
