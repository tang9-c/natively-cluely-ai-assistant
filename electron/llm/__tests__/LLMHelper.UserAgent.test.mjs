import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { createRequire, Module } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
// Node-mode Electron has no app object. Supply a release version deliberately
// different from package.json, so a hardcoded/build-time version cannot pass.
const originalLoad = Module._load;
function loadWithAppVersion(file) {
  Module._load = function (id, ...args) {
    if (id === 'electron') return { app: { getVersion: () => '9.8.7' } };
    return originalLoad.call(this, id, ...args);
  };
  try {
    return require(file);
  } finally {
    Module._load = originalLoad;
  }
}
const { LLMHelper } = loadWithAppVersion('../../../dist-electron/electron/LLMHelper.js');
const { createSelectedModelToolAdapter } = require('../../../dist-electron/electron/services/business-system/SelectedModelToolAdapterFactory.js');

async function captureWire(run) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ headers: req.headers, body: JSON.parse(body || '{}') });
    if (requests.at(-1).body.stream) {
      res.setHeader('content-type', 'text/event-stream');
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        content: [{ type: 'text', text: 'ok' }],
        candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        data: [{ id: 'gpt-5', index: 0, embedding: [0.6, 0.8] }],
        models: [],
        embedding: requests.at(-1).body.prompt ? [0.6, 0.8] : { values: [0.6, 0.8] },
      }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const originalFetch = global.fetch;
  const originalHttp = http.request;
  const originalHttps = https.request;
  // Axios uses the Node transport. Keep its serialization, redirect only the
  // destination (including environment proxy paths), so no TLS/account is needed.
  http.request = https.request = (options, callback) => originalHttp({ ...options,
    protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1',
    port: server.address().port, agent: undefined, createConnection: undefined,
  }, callback);
  // Redirect only the transport destination; real application/SDK header and
  // payload construction is exercised. No request may leave the loopback host.
  global.fetch = (url, options) => originalFetch(`http://127.0.0.1:${server.address().port}/`, options);
  try {
    await run(requests, `http://127.0.0.1:${server.address().port}`, originalFetch);
  } finally {
    global.fetch = originalFetch;
    http.request = originalHttp;
    https.request = originalHttps;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function assertRequest(request) {
  assert.equal(request.headers['user-agent'], 'CueUp/9.8.7');
  assert.equal(request.headers.authorization, 'Bearer local-dummy');
  assert.match(request.headers['content-type'], /application\/json/);
}

test('QCLOUD ordinary generation sends the running app identity on the wire', async () => {
  await captureWire(async requests => {
    const helper = new LLMHelper();
    helper.setNativelyKey('local-dummy');
    helper.setModel('natively');
    assert.equal(await helper.generatePptxKnowledgeWithNatively('local probe'), 'ok');
    assert.equal(requests.length, 1);
    assertRequest(requests[0]);
    assert.equal(requests[0].body.messages.at(-1).content, 'local probe');
  });
});

test('all SDK clients retain the app identity after construction and key replacement', async () => {
  await captureWire(async requests => {
    const helper = new LLMHelper('local-dummy', false, undefined, undefined,
      'local-dummy', 'local-dummy', 'local-dummy', 'local-dummy');
    for (const replaceKey of [false, true]) {
      if (replaceKey) {
        helper.setApiKey('local-dummy');
        helper.setGroqApiKey('local-dummy');
        helper.setOpenaiApiKey('local-dummy');
        helper.setClaudeApiKey('local-dummy');
        helper.setDoubaoApiKey('local-dummy');
      }
      for (const client of [helper.groqClient, helper.openaiClient, helper.doubaoClient]) {
        await client.chat.completions.create({ model: 'local-probe', messages: [{ role: 'user', content: 'local probe' }] });
        assertRequest(requests.at(-1));
      }
      await helper.claudeClient.messages.create({ model: 'local-probe', max_tokens: 1, messages: [{ role: 'user', content: 'local probe' }] });
      assert.equal(requests.at(-1).headers['user-agent'], 'CueUp/9.8.7');
      assert.equal(requests.at(-1).headers['x-api-key'], 'local-dummy');
      await helper.client.models.generateContent({ model: 'local-probe', contents: 'local probe' });
      assert.equal(requests.at(-1).headers['user-agent'], 'CueUp/9.8.7');
      assert.equal(requests.at(-1).headers['x-goog-api-key'], 'local-dummy');
    }
    await helper.switchToGemini('local-dummy', 'gemini-3.1-flash-lite-preview');
    const adapter = createSelectedModelToolAdapter(helper, { question: 'local probe', recentContext: '' });
    assert.deepEqual(await adapter.runTurn({ messages: [{ role: 'user', text: 'local probe' }], tools: [], timeoutMs: 2000 }), { type: 'answer', text: 'ok' });
    assert.equal(requests.at(-1).headers['user-agent'], 'CueUp/9.8.7');
    assert.equal(requests.length, 11);
  });
});

test('custom cURL ordinary and streaming requests replace mixed-case User-Agent headers', async () => {
  await captureWire(async requests => {
    const helper = new LLMHelper();
    const curlCommand = `curl https://local.invalid/chat -H 'uSeR-aGeNt: Legacy/1' -H 'Authorization: Bearer local-dummy' -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"{{MESSAGE}}"}]}'`;
    assert.equal(await helper.executeCustomProvider(curlCommand, 'local probe', '', 'local probe', ''), 'ok');
    assertRequest(requests[0]);
    helper.customProvider = { name: 'local', curlCommand };
    const chunks = [];
    for await (const chunk of helper.streamWithCustom('local probe')) chunks.push(chunk);
    assert.deepEqual(chunks, ['ok']);
    assertRequest(requests[1]);
  });
});

test('raw cURL Axios requests replace mixed-case identity without losing authorization', async () => {
  await captureWire(async requests => {
    const helper = new LLMHelper();
    helper.activeCurlProvider = {
      curlCommand: `curl https://example.com/chat -H 'uSeR-aGeNt: Legacy/1' -H 'Authorization: Bearer local-dummy' -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"{{TEXT}}"}]}'`,
      responsePath: 'choices.0.message.content',
    };
    assert.equal(await helper.chatWithCurl('local probe'), 'ok');
    assert.equal(requests.length, 1);
    assertRequest(requests[0]);
  });
});

test('embedding HTTP providers use the same app identity', async () => {
  await captureWire(async requests => {
    for (const name of ['QCloud', 'OpenAI', 'Gemini', 'Doubao']) {
      const className = `${name}EmbeddingProvider`;
      const { [className]: Provider } = loadWithAppVersion(`../../../dist-electron/electron/rag/providers/${className}.js`);
      const provider = new Provider('local-dummy', 'local-probe', 2);
      assert.deepEqual(await provider.embed('local probe'), [0.6, 0.8]);
      assert.equal(requests.at(-1).headers['user-agent'], 'CueUp/9.8.7', name);
    }
    const { OllamaEmbeddingProvider } = loadWithAppVersion('../../../dist-electron/electron/rag/providers/OllamaEmbeddingProvider.js');
    assert.deepEqual(await new OllamaEmbeddingProvider().embed('local probe'), [0.6, 0.8]);
    assert.equal(requests.at(-1).headers['user-agent'], 'CueUp/9.8.7');
  });
});

test('shared transport preserves Request payloads, caller headers and cancellation', async () => {
  await captureWire(async (requests, destination, originalFetch) => {
    global.fetch = originalFetch;
    const { llmFetch } = loadWithAppVersion('../../../dist-electron/electron/llm/LlmHttpTransport.js');
    for (const headers of [
      { 'uSeR-aGeNt': 'Legacy/1', Authorization: 'Bearer local-dummy' },
      [['user-agent', 'Legacy/1'], ['Authorization', 'Bearer local-dummy']],
      new Headers({ 'USER-AGENT': 'Legacy/1', Authorization: 'Bearer local-dummy' }),
    ]) {
      const request = new Request(destination, { method: 'POST', headers, body: '{"probe":true}' });
      await llmFetch(request);
      assert.equal(request.headers.get('user-agent'), 'Legacy/1');
      assert.equal(requests.at(-1).headers['user-agent'], 'CueUp/9.8.7');
      assert.equal(requests.at(-1).headers.authorization, 'Bearer local-dummy');
      assert.deepEqual(requests.at(-1).body, { probe: true });
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(llmFetch(destination, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(requests.length, 3);
  });
});

test('model discovery sends the app identity for every cloud provider', async () => {
  await captureWire(async requests => {
    const { fetchProviderModels } = loadWithAppVersion('../../../dist-electron/electron/utils/modelFetcher.js');
    for (const provider of ['openai', 'groq', 'claude', 'gemini', 'doubao']) {
      await fetchProviderModels(provider, 'local-dummy');
      assert.equal(requests.at(-1).headers['user-agent'], 'CueUp/9.8.7', provider);
    }
    assert.equal(requests.length, 5);
  });
});

test('QCLOUD SSE generation keeps the app identity and streaming behavior', async () => {
  await captureWire(async requests => {
    const helper = new LLMHelper();
    helper.setNativelyKey('local-dummy');
    const chunks = [];
    for await (const chunk of helper.streamWithNatively('local probe')) chunks.push(chunk);
    assert.deepEqual(chunks, ['ok']);
    assert.equal(requests.length, 1);
    assertRequest(requests[0]);
    assert.equal(requests[0].body.stream, true);
  });
});

test('QCLOUD selected-model tool calls override the SDK identity without losing tools', async () => {
  await captureWire(async requests => {
    const helper = new LLMHelper();
    helper.setNativelyKey('local-dummy');
    helper.setModel('natively');
    const adapter = createSelectedModelToolAdapter(helper, { question: 'local probe', recentContext: '' });
    assert.deepEqual(await adapter.runTurn({
      messages: [{ role: 'user', text: 'local probe' }],
      tools: [{ name: 'lookup', description: 'lookup', inputSchema: { type: 'object', properties: {} } }],
      timeoutMs: 2000,
    }), { type: 'answer', text: 'ok' });
    assert.equal(requests.length, 1);
    assertRequest(requests[0]);
    assert.equal(requests[0].body.tools[0].function.name, 'lookup');
  });
});
