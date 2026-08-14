import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

async function drainStream(stream) {
  let text = '';
  for await (const chunk of stream) {
    text += chunk;
  }
  return text;
}

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('QCLOUD meeting summary defaults to the core budget and honors a call-scoped override', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '会议摘要' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');

    assert.equal(await helper.generateMeetingSummary('summary prompt', 'meeting context'), '会议摘要');
    assert.equal(await helper.generateMeetingSummary('title prompt', 'meeting context', undefined, { maxOutputTokens: 64 }), '会议摘要');

    assert.deepEqual(
      requests.map(({ model, max_tokens, prompt_cache_key }) => ({
        model,
        max_tokens,
        hasCacheKey: /^[a-f0-9]{32}$/.test(prompt_cache_key),
      })),
      [
        { model: 'lite32k', max_tokens: 4096, hasCacheKey: true },
        { model: 'lite32k', max_tokens: 64, hasCacheKey: true },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QCLOUD streamChat surfaces QCLOUD failures instead of reporting no provider', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Invalid token' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');

    await assert.rejects(
      drainStream(helper.streamChat('会议中该怎么回复客户？', undefined, '模式：销售', undefined, true)),
      (error) => {
        assert.match(error.message, /QCLOUD API/i);
        assert.match(error.message, /401|Invalid token/i);
        assert.doesNotMatch(error.message, /No AI provider configured/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QCLOUD streamChatWithGemini surfaces QCLOUD failures when it is the only provider', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Invalid token' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');

    const text = await drainStream(helper.streamChatWithGemini('搜索所有会议：客户试点怎么开始？', undefined, undefined, true));

    assert.match(text, /QCLOUD API/i);
    assert.match(text, /401|Invalid token/i);
    assert.doesNotMatch(text, /All AI services are currently unavailable/i);
    assert.doesNotMatch(text, /No AI provider configured/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selected QCLOUD streaming acquires the provider limiter before fetch', async () => {
  const originalFetch = globalThis.fetch;
  const order = [];
  globalThis.fetch = async () => {
    order.push('fetch');
    return sseResponse([
      'data: {"delta":"hello"}\n',
      'data: [DONE]\n',
    ]);
  };

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');
    helper.rateLimiters.qcloud.acquire = async () => { order.push('limiter'); };

    assert.equal(await drainStream(helper.streamChat('hello', undefined, undefined, undefined, true)), 'hello');
    assert.deepEqual(order, ['limiter', 'fetch']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selected QCLOUD applies the realtime input budget at the provider boundary', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return sseResponse([
      'data: {"delta":"ok","usage":{"prompt_tokens":100,"completion_tokens":1,"total_tokens":101}}\n',
      'data: [DONE]\n',
    ]);
  };

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');
    const latest = 'USER QUESTION:\n必须保留的最新问题';
    const context = `${'<mode>稳定模式提示</mode>'}\n${'旧内容'.repeat(20_000)}\n${latest}`;

    assert.equal(await drainStream(helper.streamChat(
      '直接回答', undefined, context, undefined, true, true, ['transcript'],
      { qcloudRequestClass: 'realtime_answer' },
    )), 'ok');

    const sent = requestBody.messages[0].content;
    assert.ok(sent.length <= 12_000);
    assert.match(sent, /^CONTEXT:\n<mode>稳定模式提示<\/mode>/);
    assert.match(sent, /USER QUESTION:\n直接回答$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QCLOUD derives a stable provider cache key only from the system prompt', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return sseResponse(['data: {"delta":"ok"}\n', 'data: [DONE]\n']);
  };

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');

    await drainStream(helper.streamChat('动态用户内容一', undefined, undefined, '稳定系统提示', true));
    await drainStream(helper.streamChat('完全不同的动态用户内容二', undefined, undefined, '稳定系统提示', true));
    await drainStream(helper.streamChat('无系统提示', undefined, undefined, undefined, true));

    assert.match(requests[0].prompt_cache_key, /^[a-f0-9]{32}$/);
    assert.deepEqual(requests[0].stream_options, { include_usage: true });
    assert.equal(requests[1].prompt_cache_key, requests[0].prompt_cache_key);
    assert.doesNotMatch(requests[0].prompt_cache_key, /动态用户内容/);
    assert.match(requests[2].prompt_cache_key, /^[a-f0-9]{32}$/);
    assert.notEqual(requests[2].prompt_cache_key, requests[0].prompt_cache_key);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selected QCLOUD does not append another provider after a partial stream failure', async () => {
  const originalFetch = globalThis.fetch;
  let groqCalls = 0;
  const encoder = new TextEncoder();
  let pulls = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(encoder.encode('data: {"delta":"partial"}\n'));
        return;
      }
      controller.error(new Error('connection reset'));
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');
    helper.groqClient = {
      chat: { completions: { create: async () => { groqCalls++; return []; } } },
    };

    await assert.rejects(
      drainStream(helper.streamChat('hello', undefined, undefined, undefined, true)),
      /stream_interrupted/i,
    );
    assert.equal(groqCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selected QCLOUD aborts when no meaningful token arrives before the configured deadline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');

    await assert.rejects(
      drainStream(helper.streamChat(
        'hello', undefined, undefined, undefined, true, true, [],
        { firstTokenTimeoutMs: 20, idleTimeoutMs: 50, totalTimeoutMs: 100 },
      )),
      /first token timeout/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selected QCLOUD rejects transcript scope even when reference-file scope is also present', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return sseResponse(['data: {"delta":"should not run"}\n', 'data: [DONE]\n']);
  };

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');
    helper.getProviderScopePolicy = () => ({ transcript: false, reference_files: true });

    await assert.rejects(
      drainStream(helper.streamChat(
        'private meeting transcript',
        undefined,
        '<uploaded_material_context>reference</uploaded_material_context>',
        undefined,
        true,
      )),
      /transcript|scope/i,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selected QCLOUD total timeout also cancels limiter queue waiting', { timeout: 500 }, async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return sseResponse(['data: {"delta":"late"}\n', 'data: [DONE]\n']);
  };

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');
    helper.rateLimiters.qcloud.acquire = (signal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });

    await assert.rejects(
      drainStream(helper.streamChat(
        'hello', undefined, undefined, undefined, true, true, [],
        { totalTimeoutMs: 20 },
      )),
      /total timeout/i,
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('selected QCLOUD cancels limiter queue waiting when the caller aborts', { timeout: 500 }, async () => {
  const { LLMHelper } = await import(pathToFileURL(helperPath).href);
  const helper = new LLMHelper();
  helper.setNativelyKey('test-qcloud-key');
  helper.setModel('natively');
  helper.rateLimiters.qcloud.acquire = (signal) => new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const controller = new AbortController();
  const pending = drainStream(helper.streamChat(
    'hello', undefined, undefined, undefined, true, true, [],
    { abortSignal: controller.signal, totalTimeoutMs: 400 },
  ));

  controller.abort(new Error('request superseded'));

  await assert.rejects(pending, /request superseded/i);
});
