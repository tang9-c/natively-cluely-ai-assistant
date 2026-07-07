import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

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

test('parseMcpHttpResponseText parses plain JSON-RPC response', async () => {
  const { parseMcpHttpResponseText } = await loadModule();
  const parsed = parseMcpHttpResponseText('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
  assert.deepEqual(parsed, { jsonrpc: '2.0', id: 1, result: { ok: true } });
});

test('parseMcpHttpResponseText parses SSE data payload', async () => {
  const { parseMcpHttpResponseText } = await loadModule();
  const parsed = parseMcpHttpResponseText('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n');
  assert.deepEqual(parsed, { jsonrpc: '2.0', id: 2, result: { tools: [] } });
});

test('parseMcpHttpResponseText parses SSE response that starts with data payload', async () => {
  const { parseMcpHttpResponseText } = await loadModule();
  const parsed = parseMcpHttpResponseText('data: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{}"}]}}\n\n');
  assert.deepEqual(parsed, {
    jsonrpc: '2.0',
    id: 3,
    result: { content: [{ type: 'text', text: '{}' }] },
  });
});

test('McpRpcClient sends api-key auth and accepts JSON/SSE', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch((_init, count) => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: count,
    result: count === 1 ? { serverInfo: { name: 'x' } } : { tools: [{ name: 'part_search' }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'secret' },
    fetchImpl: stub.fetch,
  });

  await client.initialize(1000);
  const tools = await client.listTools(1000);

  assert.equal(tools[0].name, 'part_search');
  assert.equal(stub.calls[0].headers.Authorization, 'Bearer secret');
  assert.equal(stub.calls[0].headers.Accept, 'application/json, text/event-stream');
});

test('McpRpcClient sends basic auth for username/password sources', async () => {
  const { McpRpcClient } = await loadModule();
  const stub = makeFetch(() => new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', { status: 200 }));
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'username_password',
    credentials: { username: 'alice', password: 'pw' },
    fetchImpl: stub.fetch,
  });

  await client.listTools(1000);

  assert.match(stub.calls[0].headers.Authorization, /^Basic /);
  assert.doesNotMatch(stub.calls[0].headers.Authorization, /alice/);
  assert.doesNotMatch(stub.calls[0].headers.Authorization, /pw/);
});

test('McpRpcClient maps non-ok HTTP to error result with status code', async () => {
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
