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

function createSession(pages) {
  const calls = [];
  let listChangedHandler;
  return {
    calls,
    session: {
      async connect(timeoutMs) {
        calls.push(['connect', timeoutMs]);
        return { serverInfo: { name: 'test-mcp', version: '1.0.0' } };
      },
      async listTools(cursor, timeoutMs) {
        calls.push(['listTools', cursor, timeoutMs]);
        return pages[cursor ?? 'first'];
      },
      async callTool(name, args, timeoutMs) {
        calls.push(['callTool', name, args, timeoutMs]);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
      onToolsChanged(handler) {
        listChangedHandler = handler;
      },
      async close() {
        calls.push(['close']);
      },
    },
    emitToolsChanged() {
      listChangedHandler?.();
    },
  };
}

test('McpRpcClient uses an SDK session and preserves every tool field across all pages', async () => {
  const { McpRpcClient } = await loadModule();
  const fake = createSession({
    first: {
      tools: [{
        name: 'part_search',
        title: 'Part search',
        description: 'Search parts',
        inputSchema: { type: 'object', properties: { number: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        annotations: { readOnlyHint: true },
        execution: { taskSupport: 'forbidden' },
        icons: [{ src: 'https://example.test/icon.png' }],
        _meta: { vendor: 'windchill' },
      }],
      nextCursor: 'page-2',
    },
    'page-2': {
      tools: [{
        name: 'part_get',
        inputSchema: { type: 'object', properties: {}, required: [] },
      }],
    },
  });
  let factoryConfig;
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'api_key',
    credentials: { apiKey: 'secret-key' },
    sessionFactory: (config) => {
      factoryConfig = config;
      return fake.session;
    },
  });

  const initialized = await client.initialize(1000);
  const tools = await client.listTools(3000);

  assert.equal(initialized.serverInfo.name, 'test-mcp');
  assert.deepEqual(fake.calls.slice(0, 3), [
    ['connect', 1000],
    ['listTools', undefined, 3000],
    ['listTools', 'page-2', 3000],
  ]);
  assert.equal(factoryConfig.headers.Authorization, 'Bearer secret-key');
  assert.equal(tools.length, 2);
  assert.deepEqual(tools[0].outputSchema, {
    type: 'object',
    properties: { id: { type: 'string' } },
  });
  assert.deepEqual(tools[0].annotations, { readOnlyHint: true });
  assert.deepEqual(tools[0].execution, { taskSupport: 'forbidden' });
  assert.deepEqual(tools[0]._meta, { vendor: 'windchill' });
});

test('McpRpcClient rejects repeated pagination cursors instead of returning a partial catalog', async () => {
  const { McpRpcClient } = await loadModule();
  const fake = createSession({
    first: { tools: [{ name: 'one', inputSchema: { type: 'object' } }], nextCursor: 'same' },
    same: { tools: [{ name: 'two', inputSchema: { type: 'object' } }], nextCursor: 'same' },
  });
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'none',
    sessionFactory: () => fake.session,
  });

  await assert.rejects(() => client.listTools(3000), /repeated tools\/list cursor/i);
});

test('McpRpcClient applies one timeout budget to the complete paginated catalog', async () => {
  const { McpRpcClient } = await loadModule();
  let now = 0;
  const calls = [];
  const session = {
    async connect() {},
    async listTools(cursor, timeoutMs) {
      calls.push([cursor, timeoutMs]);
      now += 600;
      return { tools: [], nextCursor: cursor ? 'page-3' : 'page-2' };
    },
    async callTool() {},
    onToolsChanged() {},
    async close() {},
  };
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'none',
    now: () => now,
    sessionFactory: () => session,
  });

  await assert.rejects(() => client.listTools(1000), /tools\/list timed out/i);
  assert.deepEqual(calls, [[undefined, 1000], ['page-2', 400]]);
});

test('McpRpcClient forwards list_changed notifications, tool calls, and close to the SDK session', async () => {
  const { McpRpcClient } = await loadModule();
  const fake = createSession({ first: { tools: [] } });
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'none',
    sessionFactory: () => fake.session,
  });
  let changedCount = 0;
  client.onToolsChanged(() => { changedCount += 1; });

  fake.emitToolsChanged();
  const result = await client.callTool('server_status', { verbose: false }, 2500);
  await client.close();

  assert.equal(changedCount, 1);
  assert.deepEqual(result, { content: [{ type: 'text', text: 'ok' }] });
  assert.deepEqual(fake.calls, [
    ['callTool', 'server_status', { verbose: false }, 2500],
    ['close'],
  ]);
});

test('McpRpcClient builds Basic auth from the knowledge-source credential record', async () => {
  const { McpRpcClient } = await loadModule();
  const fake = createSession({ first: { tools: [] } });
  let factoryConfig;
  new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'username_password',
    credentials: { username: 'windchill-user', password: 'secret-password' },
    sessionFactory: (config) => {
      factoryConfig = config;
      return fake.session;
    },
  });

  assert.equal(
    factoryConfig.headers.Authorization,
    `Basic ${Buffer.from('windchill-user:secret-password').toString('base64')}`,
  );
});

test('McpRpcClient never retries a failed tools/call automatically', async () => {
  const { McpRpcClient } = await loadModule();
  let attempts = 0;
  const fake = createSession({ first: { tools: [] } });
  fake.session.callTool = async () => {
    attempts += 1;
    throw new Error('network failed');
  };
  const client = new McpRpcClient({
    url: 'https://example.test/mcp',
    authType: 'none',
    sessionFactory: () => fake.session,
  });

  await assert.rejects(() => client.callTool('part_create', { name: 'x' }, 1000), /network failed/);
  assert.equal(attempts, 1);
});
