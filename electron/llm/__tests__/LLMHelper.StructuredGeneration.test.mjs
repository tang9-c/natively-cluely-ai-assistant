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
  test('denied reference files never reach cloud structured providers when no local model is available', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const calls = { codex: 0, openai: 0, claude: 0, gemini: 0, doubao: 0, custom: 0, qcloud: 0 };
    helper.getProviderScopePolicy = () => ({ reference_files: false, transcript: true });
    helper.codexCliConfig = { ...helper.codexCliConfig, enabled: true, model: 'cloud-codex' };
    helper.generateWithCodexCli = async () => {
      calls.codex += 1;
      return '{"source":"codex"}';
    };
    helper.openaiClient = { chat: { completions: { create: async () => {
      calls.openai += 1;
      return { choices: [{ message: { content: '{"source":"openai"}' } }] };
    } } } };
    helper.claudeClient = { messages: { stream: () => {
      calls.claude += 1;
      return { finalMessage: async () => ({ content: [{ type: 'text', text: '{"source":"claude"}' }] }) };
    } } };
    helper.client = { models: { generateContent: async () => {
      calls.gemini += 1;
      return { text: '{"source":"gemini"}', candidates: [{}] };
    } } };
    helper.doubaoClient = { chat: { completions: { create: async () => {
      calls.doubao += 1;
      return { choices: [{ message: { content: '{"source":"doubao"}' } }] };
    } } } };
    helper.customProvider = { name: 'cloud-custom', curlCommand: 'curl https://example.test' };
    helper.executeCustomProvider = async () => {
      calls.custom += 1;
      return '{"source":"custom"}';
    };
    helper.setNativelyKey('test-qcloud-key');
    helper.generateWithNatively = async () => {
      calls.qcloud += 1;
      return '{"source":"qcloud"}';
    };
    helper.useOllama = false;

    await assert.rejects(
      helper.generateContentStructured('UNIQUE_PRIVATE_RESUME_SENTINEL', {
        dataScopes: ['reference_files'],
        maxRotations: 1,
      }),
      error => error.name === 'ProviderScopeError',
    );
    assert.deepEqual(calls, { codex: 0, openai: 0, claude: 0, gemini: 0, doubao: 0, custom: 0, qcloud: 0 });
  });

  test('denied reference files use Ollama without attempting cloud structured providers', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let cloudCalls = 0;
    let localCalls = 0;
    helper.getProviderScopePolicy = () => ({ reference_files: false, transcript: true });
    helper.codexCliConfig = { ...helper.codexCliConfig, enabled: true, model: 'cloud-codex' };
    helper.generateWithCodexCli = async () => {
      cloudCalls += 1;
      return '{"source":"codex"}';
    };
    helper.useOllama = true;
    helper.checkOllamaAvailable = async () => true;
    helper.callOllama = async () => {
      localCalls += 1;
      return '{"source":"ollama"}';
    };

    const result = await helper.generateContentStructured('UNIQUE_PRIVATE_RESUME_SENTINEL', {
      dataScopes: ['reference_files'],
      maxRotations: 1,
    });

    assert.equal(result, '{"source":"ollama"}');
    assert.equal(localCalls, 1);
    assert.equal(cloudCalls, 0);
  });

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

  test('selected_model_only executes only the selected QCLOUD model', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const calls = { qcloud: 0, openai: 0 };
    helper.setModel('natively');
    helper.setNativelyKey('test-qcloud-key');
    helper.openaiClient = {};
    helper.generateWithNatively = async (_message, _system, _images, options) => {
      calls.qcloud += 1;
      assert.equal(options.qcloudModel, 'lite32k');
      assert.ok(options.abortSignal instanceof AbortSignal);
      return '{"source":"qcloud"}';
    };
    helper.generateWithOpenai = async () => {
      calls.openai += 1;
      return '{"source":"openai"}';
    };

    const result = await helper.generateContentStructured('return json', {
      providerStrategy: 'selected_model_only',
      totalTimeoutMs: 6000,
      perProviderTimeoutMs: 6000,
      maxOutputTokens: 256,
      maxRotations: 1,
      dataScopes: ['transcript'],
    });

    assert.equal(result, '{"source":"qcloud"}');
    assert.deepEqual(calls, { qcloud: 1, openai: 0 });
  });

  test('selected_model_only executes selected Ollama without trying configured cloud providers', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const calls = { ollama: 0, openai: 0 };
    helper.setModel('ollama-local-semantic-model');
    helper.openaiClient = {};
    helper.callOllama = async (_message, _system, _images, options) => {
      calls.ollama += 1;
      assert.ok(options.abortSignal instanceof AbortSignal);
      return '{"source":"ollama"}';
    };
    helper.generateWithOpenai = async () => {
      calls.openai += 1;
      return '{"source":"openai"}';
    };

    const result = await helper.generateContentStructured('return json', {
      providerStrategy: 'selected_model_only',
      totalTimeoutMs: 6000,
      perProviderTimeoutMs: 6000,
      maxRotations: 1,
      dataScopes: ['transcript'],
    });

    assert.equal(result, '{"source":"ollama"}');
    assert.deepEqual(calls, { ollama: 1, openai: 0 });
  });

  test('selected_model_only executes selected custom provider without fallback', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const calls = { custom: 0, qcloud: 0 };
    const custom = {
      id: 'custom-semantic-model',
      name: 'Custom Semantic Model',
      curlCommand: 'curl https://example.test',
    };
    helper.setModel(custom.id, [custom]);
    helper.setNativelyKey('test-qcloud-key');
    helper.executeCustomProvider = async (...args) => {
      calls.custom += 1;
      assert.ok(args[6]?.abortSignal instanceof AbortSignal);
      return '{"source":"custom"}';
    };
    helper.generateWithNatively = async () => {
      calls.qcloud += 1;
      return '{"source":"qcloud"}';
    };

    const result = await helper.generateContentStructured('return json', {
      providerStrategy: 'selected_model_only',
      totalTimeoutMs: 6000,
      perProviderTimeoutMs: 6000,
      maxRotations: 1,
      dataScopes: ['transcript'],
    });

    assert.equal(result, '{"source":"custom"}');
    assert.deepEqual(calls, { custom: 1, qcloud: 0 });
  });

  test('selected_model_only honors each selected standard, Codex, and cURL model', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const cases = [
      ['gpt-5.4', 'generateWithOpenai', 'openai'],
      ['claude-sonnet-4-6', 'generateWithClaude', 'claude'],
      ['gemini-3.1-flash-lite-preview', 'generateStructuredWithSelectedGemini', 'gemini'],
      ['doubao-seed-2-0-lite-260215', 'generateWithDoubao', 'doubao'],
      ['llama-3.3-70b-versatile', 'generateWithGroq', 'groq'],
      ['codex-cli:gpt-5-codex', 'generateWithCodexCli', 'codex'],
    ];

    for (const [modelId, selectedMethod, expectedSource] of cases) {
      const helper = new LLMHelper();
      const calls = [];
      helper.openaiClient = {};
      helper.claudeClient = {};
      helper.client = {};
      helper.doubaoClient = {};
      helper.groqClient = {};
      helper.setCodexCliConfig({ enabled: true, model: 'gpt-5-codex' });
      helper.setModel(modelId);
      let selectedSignal;
      for (const method of [
        'generateWithOpenai',
        'generateWithClaude',
        'generateStructuredWithSelectedGemini',
        'generateWithDoubao',
        'generateWithGroq',
        'generateWithCodexCli',
        'generateWithNatively',
        'callOllama',
      ]) {
        helper[method] = async (...args) => {
          calls.push(method);
          selectedSignal = method === 'generateStructuredWithSelectedGemini'
            ? args[2]?.abortSignal
            : method === 'generateWithCodexCli'
              ? args[3]
              : method === 'generateWithGroq'
                ? args[3]?.abortSignal
                : args[4]?.abortSignal;
          return JSON.stringify({ source: method });
        };
      }

      const result = await helper.generateContentStructured('return json', {
        providerStrategy: 'selected_model_only',
        totalTimeoutMs: 6000,
        dataScopes: ['transcript'],
      });

      assert.equal(JSON.parse(result).source, selectedMethod, expectedSource);
      assert.deepEqual(calls, [selectedMethod], modelId);
      assert.ok(selectedSignal instanceof AbortSignal, `${modelId} should receive an AbortSignal`);
    }

    const helper = new LLMHelper();
    const calls = [];
    helper.switchToCurl({
      id: 'curl-selected',
      name: 'Selected cURL',
      curlCommand: 'curl https://example.test',
      responsePath: 'choices.0.message.content',
    });
    let curlSignal;
    helper.chatWithCurl = async (...args) => {
      calls.push('curl');
      curlSignal = args[3]?.abortSignal;
      return '{"source":"curl"}';
    };
    helper.generateWithNatively = async () => {
      calls.push('qcloud');
      return '{"source":"qcloud"}';
    };
    const result = await helper.generateContentStructured('return json', {
      providerStrategy: 'selected_model_only',
      totalTimeoutMs: 6000,
      dataScopes: ['transcript'],
    });
    assert.equal(result, '{"source":"curl"}');
    assert.deepEqual(calls, ['curl']);
    assert.ok(curlSignal instanceof AbortSignal);
  });

  test('selected_model_only fails once without trying another configured provider', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const calls = { openai: 0, qcloud: 0 };
    helper.setModel('gpt-5.4');
    helper.openaiClient = {};
    helper.setNativelyKey('test-qcloud-key');
    helper.generateWithOpenai = async () => {
      calls.openai += 1;
      throw new Error('provider busy');
    };
    helper.generateWithNatively = async () => {
      calls.qcloud += 1;
      return '{"source":"qcloud"}';
    };

    await assert.rejects(
      helper.generateContentStructured('return json', {
        providerStrategy: 'selected_model_only',
        totalTimeoutMs: 6000,
        dataScopes: ['transcript'],
      }),
      error => error.code === 'selected_cloud_model_unavailable',
    );
    assert.deepEqual(calls, { openai: 1, qcloud: 0 });
  });

  test('selected_model_only enforces one total timeout budget', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const custom = {
      id: 'slow-custom',
      name: 'Slow Custom',
      curlCommand: 'curl https://example.test',
    };
    helper.setModel(custom.id, [custom]);
    helper.executeCustomProvider = async () => new Promise(() => {});
    const startedAt = Date.now();

    await assert.rejects(
      helper.generateContentStructured('return json', {
        providerStrategy: 'selected_model_only',
        totalTimeoutMs: 40,
        perProviderTimeoutMs: 6000,
        dataScopes: ['transcript'],
      }),
      error => error.code === 'selected_model_unavailable',
    );
    assert.ok(Date.now() - startedAt < 250);
  });

  test('selected_model_only forwards the caller abort signal to the selected provider', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const controller = new AbortController();
    let providerSignal;
    helper.setModel('natively');
    helper.setNativelyKey('test-qcloud-key');
    helper.generateWithNatively = async (_message, _system, _images, options) => {
      providerSignal = options.abortSignal;
      return new Promise((resolve, reject) => {
        providerSignal.addEventListener('abort', () => {
          reject(providerSignal.reason ?? new Error('aborted'));
        }, { once: true });
      });
    };

    const request = helper.generateContentStructured('return json', {
      providerStrategy: 'selected_model_only',
      totalTimeoutMs: 6000,
      dataScopes: ['transcript'],
      abortSignal: controller.signal,
    });
    await Promise.resolve();
    controller.abort(new Error('caller cancelled'));

    await assert.rejects(request, error => error.code === 'selected_cloud_model_unavailable');
    assert.ok(providerSignal instanceof AbortSignal);
    assert.equal(providerSignal.aborted, true);
    assert.equal(providerSignal.reason?.message, 'caller cancelled');
  });

  test('selected_model_only timeout aborts a queued provider limiter wait', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let limiterSignal;
    helper.setModel('natively');
    helper.setNativelyKey('test-qcloud-key');
    helper.rateLimiters.qcloud.acquire = signal => {
      limiterSignal = signal;
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };

    await assert.rejects(
      helper.generateContentStructured('return json', {
        providerStrategy: 'selected_model_only',
        totalTimeoutMs: 40,
        dataScopes: ['transcript'],
      }),
      error => error.code === 'selected_cloud_model_timeout',
    );

    assert.ok(limiterSignal instanceof AbortSignal);
    assert.equal(limiterSignal.aborted, true);
  });

  test('selected QCLOUD reports limiter queue, network first byte, and response completion timings', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const originalFetch = globalThis.fetch;
    const timingEvents = [];
    helper.setModel('natively');
    helper.setNativelyKey('test-qcloud-key');
    helper.rateLimiters.qcloud.acquire = async () => {
      await new Promise(resolve => setTimeout(resolve, 12));
    };
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"actions":[]}' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    try {
      const result = await helper.generateContentStructured('return json', {
        providerStrategy: 'selected_model_only',
        totalTimeoutMs: 1000,
        dataScopes: ['transcript'],
        requestId: 'latency-qcloud-test',
        timingSink: event => timingEvents.push(event),
      });

      assert.equal(result, '{"actions":[]}');
      assert.deepEqual(
        timingEvents.map(event => event.stage),
        ['provider_queue_complete', 'provider_first_byte', 'provider_response_complete'],
      );
      assert.ok(timingEvents[0].durationMs >= 8);
      assert.equal(timingEvents[1].measurement, 'network_body_chunk');
      assert.ok(timingEvents.every(event => event.requestId === 'latency-qcloud-test'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('selected cloud timeout preserves timeout classification without fallback', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gpt-5.4');
    helper.openaiClient = {};
    helper.generateWithOpenai = async () => new Promise(() => {});

    await assert.rejects(
      helper.generateContentStructured('return json', {
        providerStrategy: 'selected_model_only',
        totalTimeoutMs: 40,
        dataScopes: ['transcript'],
      }),
      error => error.code === 'selected_cloud_model_timeout',
    );
  });

  test('transcript scope blocks selected remote models but not selected Ollama', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const remote = new LLMHelper();
    let remoteCalls = 0;
    remote.setModel('gpt-5.4');
    remote.openaiClient = {};
    remote.getProviderScopePolicy = () => ({ transcript: false });
    remote.generateWithOpenai = async () => {
      remoteCalls += 1;
      return '{"source":"openai"}';
    };
    await assert.rejects(
      remote.generateContentStructured('return json', {
        providerStrategy: 'selected_model_only',
        dataScopes: ['transcript'],
      }),
      error => error.name === 'ProviderScopeError',
    );
    assert.equal(remoteCalls, 0);

    const local = new LLMHelper();
    local.setModel('ollama-local-semantic-model');
    local.getProviderScopePolicy = () => ({ transcript: false });
    local.callOllama = async () => '{"source":"ollama"}';
    const result = await local.generateContentStructured('return json', {
      providerStrategy: 'selected_model_only',
      dataScopes: ['transcript'],
    });
    assert.equal(result, '{"source":"ollama"}');
  });
});
