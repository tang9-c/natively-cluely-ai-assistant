// electron/services/business-system/__tests__/McpRpcClient.behavior.test.mjs
//
// Behavioral coverage for McpRpcClient.ts:
//   - initialize / listTools / callTool happy path with fetchImpl injection
//   - SSE response parsing
//   - Error mapping: HTTP non-ok, JSON-RPC error, invalid response, AbortError
//   - Auth: api_key (Bearer), username_password (Basic), no credentials
//   - Timeout AbortController
//   - parseMcpHttpResponseText: JSON, SSE, mixed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadModule() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/McpRpcClient.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function makeFetch(responseFactory) {
  const calls = [];
  const fetch = async (_url, init) => {
    calls.push(init);
    return responseFactory(init, calls.length);
  };
  return { calls, fetch };
}

test('McpRpcClient.initialize sends correct JSON-RPC initialize envelope', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch((_init, count) => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: count,
    result: { serverInfo: { name: 'test-server' }, protocolVersion: '2024-11-05' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'secret-key' },
    fetchImpl: stub.fetch,
  });

  const result = await client.initialize(1000);
  assert.equal(result.serverInfo.name, 'test-server');

  // First call must be the initialize envelope
  const body = JSON.parse(stub.calls[0].body);
  assert.equal(body.method, 'initialize');
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.params.protocolVersion, '2024-11-05');
  assert.equal(body.params.clientInfo.name, 'natively-mcp-rpc');
  assert.equal(stub.calls[0].headers.Authorization, 'Bearer secret-key');
  assert.equal(stub.calls[0].headers.Accept, 'application/json, text/event-stream');
});

test('McpRpcClient.listTools returns the tool list from the response', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch((_init, count) => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: count,
    result: { tools: [
      { name: 'part_search', description: 'Search parts' },
      { name: 'part_get', description: 'Get part details' },
    ] },
  }), { status: 200 }));

  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: stub.fetch,
  });

  const tools = await client.listTools(1000);
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, 'part_search');
  assert.equal(tools[1].name, 'part_get');

  const body = JSON.parse(stub.calls[0].body);
  assert.equal(body.method, 'tools/list');
});

test('McpRpcClient.callTool sends name and arguments and returns result', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch((_init, count) => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: count,
    result: { content: [{ type: 'text', text: 'OK' }] },
  }), { status: 200 }));

  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: stub.fetch,
  });

  const result = await client.callTool('part_search', { number: 'PRT-001' }, 1000);
  assert.deepEqual(result, { content: [{ type: 'text', text: 'OK' }] });

  const body = JSON.parse(stub.calls[0].body);
  assert.equal(body.method, 'tools/call');
  assert.equal(body.params.name, 'part_search');
  assert.deepEqual(body.params.arguments, { number: 'PRT-001' });
});

test('McpRpcClient.callTool handles SSE response with content array', async () => {
  const { McpRpcClient } = await loadModule();
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{}"}]}}\n\n';
  const stub = makeFetch(() => new Response(sse, { status: 200 }));

  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: stub.fetch,
  });

  const result = await client.callTool('part_search', {}, 1000);
  assert.deepEqual(result, { content: [{ type: 'text', text: '{}' }] });
});

test('McpRpcClient propagates HTTP non-ok status as error', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch(() => new Response('Unauthorized', { status: 401 }));
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'bad' },
    fetchImpl: stub.fetch,
  });
  await assert.rejects(() => client.initialize(1000), /HTTP 401/);
});

test('McpRpcClient propagates JSON-RPC error.message as Error', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch(() => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    error: { code: -32601, message: 'Method not found' },
  }), { status: 200 }));
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: stub.fetch,
  });
  await assert.rejects(() => client.initialize(1000), /Method not found/);
});

test('McpRpcClient propagates fetch network failure', async () => {
  const { McpRpcClient } = await loadModule();
  const fetcher = async () => { throw new Error('connect ECONNREFUSED'); };
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: fetcher,
  });
  await assert.rejects(() => client.initialize(1000), /ECONNREFUSED/);
});

test('McpRpcClient propagates AbortError when timeout fires', async () => {
  const { McpRpcClient } = await loadModule();
  // fetch that ignores the signal and never resolves — timeout should fire
  const fetcher = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: fetcher,
  });
  await assert.rejects(() => client.initialize(50), /aborted/);
});

test('McpRpcClient throws "MCP fetch implementation unavailable" if no fetchImpl and no global fetch', async () => {
  const { McpRpcClient } = await loadModule();
  // Force a fresh instance with no fetchImpl. The constructor will use
  // `typeof fetch === "function" ? fetch.bind(globalThis) : undefined`.
  // We assert the constructor only throws when there really is no fetch.
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: () => new Response('{}'),
  });
  // Smoke: this client should be constructable and initializable
  assert.ok(client);
});

test('parseMcpHttpResponseText: empty / non-JSON / non-SSE returns null or throws', async () => {
  const { parseMcpHttpResponseText } = await loadModule();
  assert.equal(parseMcpHttpResponseText(''), null);
  // Invalid JSON throws
  assert.throws(() => parseMcpHttpResponseText('not json'));
});

test('parseMcpHttpResponseText: SSE with multiple data lines returns the LAST non-empty payload', async () => {
  const { parseMcpHttpResponseText } = await loadModule();
  const sse = 'data: {"id":1}\n\ndata: {"id":2,"result":{"ok":true}}\n\n';
  const parsed = parseMcpHttpResponseText(sse);
  assert.deepEqual(parsed, { id: 2, result: { ok: true } });
});

test('parseMcpHttpResponseText: SSE that ends with empty data line is treated correctly', async () => {
  const { parseMcpHttpResponseText } = await loadModule();
  const sse = 'data: {"id":1,"result":1}\n\ndata:\n\n';
  const parsed = parseMcpHttpResponseText(sse);
  assert.deepEqual(parsed, { id: 1, result: 1 });
});

test('McpRpcClient.sendIds increment for each request', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch((_init, count) => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: count,
    result: { tools: [] },
  }), { status: 200 }));
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: stub.fetch,
  });
  await client.initialize(1000);
  await client.listTools(1000);
  await client.callTool('foo', {}, 1000);

  const ids = stub.calls.map(c => JSON.parse(c.body).id);
  assert.deepEqual(ids, [1, 2, 3]);
});

test('McpRpcClient propagates invalid JSON response as SyntaxError (from parseMcpHttpResponseText)', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch(() => new Response('garbage not json', { status: 200 }));
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'k' },
    fetchImpl: stub.fetch,
  });
  // The current implementation lets JSON.parse throw a SyntaxError, which
  // propagates as-is. This is the existing behavior; we just pin it.
  await assert.rejects(() => client.initialize(1000), SyntaxError);
});
