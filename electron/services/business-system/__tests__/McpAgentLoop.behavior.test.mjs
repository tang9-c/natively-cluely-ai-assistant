import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadModule() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/McpAgentLoop.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

const source = {
  id: 'windchill', name: 'Windchill', kind: 'plm', url: 'https://mcp.example.test/mcp',
  authType: 'api_key', enabled: true, isDefault: true,
};
const tool = (name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });
const textResult = (text) => ({ content: [{ type: 'text', text }] });

function scriptedAdapter(script) {
  return {
    provider: 'openai',
    model: 'gpt-test',
    turns: [],
    async runTurn(input) {
      this.turns.push(structuredClone(input));
      const next = script.shift();
      return typeof next === 'function' ? next(input) : next;
    },
  };
}

function harness({ adapter, callTool, listTools = async () => [tool('part_search')], totalTimeoutMs } = {}) {
  const events = [];
  const client = {
    connectCalls: 0,
    closeCalls: 0,
    callCount: 0,
    async connect() { this.connectCalls += 1; },
    async listTools() { return listTools(); },
    async callTool(name, args) {
      this.callCount += 1;
      return callTool ? callTool(name, args) : textResult('ok');
    },
    onToolsChanged(handler) { this.toolsChangedHandler = handler; },
    async close() { this.closeCalls += 1; },
  };
  const cache = {
    invalidated: [],
    async getOrLoad({ load }) { return load(); },
    invalidate(sourceId) { this.invalidated.push(sourceId); },
  };
  const logger = {
    success(name, payload) { events.push(['success', name, payload]); },
    failure(name, payload) { events.push(['failure', name, payload]); },
  };
  return {
    client, cache, events,
    deps: {
      clientFactory: () => client,
      catalogCache: cache,
      adapterFactory: () => adapter,
      logger,
      traceIdFactory: () => 'trace-test',
      ...(totalTimeoutMs ? { totalTimeoutMs } : {}),
    },
  };
}

const request = () => ({
  source,
  credentials: { apiKey: 'secret' },
  credentialRevision: 4,
  question: 'A-1 状态是什么？',
  recentContext: '会议中正在讨论 A-1',
});

test('feeds an MCP result back to the same model before returning its final answer', async () => {
  const { McpAgentLoop } = await loadModule();
  const adapter = scriptedAdapter([
    { type: 'tool_calls', calls: [{ callId: 'c1', name: 'part_search', arguments: { number: 'A-1' } }] },
    { type: 'answer', text: 'A-1 已发布。' },
  ]);
  const h = harness({ adapter, callTool: async () => textResult('{"state":"RELEASED"}') });

  const result = await new McpAgentLoop(h.deps).run(request());

  assert.deepEqual(result, { status: 'ok', answer: 'A-1 已发布。', traceId: 'trace-test', toolCalls: 1 });
  assert.equal(adapter.turns[1].messages.at(-1).role, 'tool');
  assert.equal(adapter.turns[1].messages.at(-2).role, 'assistant');
  assert.equal(h.client.connectCalls, 1);
  assert.equal(h.client.closeCalls, 1);
  h.client.toolsChangedHandler();
  assert.deepEqual(h.cache.invalidated, ['windchill']);
});

test('does not retry a failed tools/call and lets the model observe the stable error', async () => {
  const { McpAgentLoop } = await loadModule();
  const adapter = scriptedAdapter([
    { type: 'tool_calls', calls: [{ callId: 'c1', name: 'part_search', arguments: { number: 'A-1' } }] },
    (turn) => {
      const result = turn.messages.at(-1).result;
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /^mcp_/);
      return { type: 'answer', text: '查询失败，请稍后重试。' };
    },
  ]);
  const h = harness({ adapter, callTool: async () => { throw new Error('ECONNRESET'); } });

  const result = await new McpAgentLoop(h.deps).run(request());

  assert.equal(result.status, 'ok');
  assert.equal(h.client.callCount, 1);
});

test('executes parallel calls requested in one model turn sequentially', async () => {
  const { McpAgentLoop } = await loadModule();
  const order = [];
  const adapter = scriptedAdapter([
    { type: 'tool_calls', calls: [
      { callId: 'c1', name: 'first', arguments: {} },
      { callId: 'c2', name: 'second', arguments: {} },
    ] },
    { type: 'answer', text: 'done' },
  ]);
  const h = harness({
    adapter,
    listTools: async () => [tool('first'), tool('second')],
    callTool: async (name) => {
      order.push(`start:${name}`);
      await Promise.resolve();
      order.push(`end:${name}`);
      return textResult(name);
    },
  });

  await new McpAgentLoop(h.deps).run(request());

  assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
  assert.equal(adapter.turns[1].messages.at(-3).role, 'assistant');
  assert.equal(adapter.turns[1].messages.at(-2).callId, 'c1');
  assert.equal(adapter.turns[1].messages.at(-1).callId, 'c2');
});

test('stops after eight model turns with mcp_agent_limit_reached', async () => {
  const { McpAgentLoop } = await loadModule();
  const adapter = scriptedAdapter(Array.from({ length: 8 }, (_, index) => ({
    type: 'tool_calls',
    calls: [{ callId: `c${index}`, name: 'part_search', arguments: {} }],
  })));
  const h = harness({ adapter });

  const result = await new McpAgentLoop(h.deps).run(request());

  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, 'mcp_agent_limit_reached');
  assert.equal(adapter.turns.length, 8);
  assert.equal(h.client.callCount, 8);
  assert.equal(h.client.closeCalls, 1);
});

test('normalizes initialization and discovery failures to stable MCP error codes', async (t) => {
  const { McpAgentLoop } = await loadModule();
  const cases = [
    ['401 Unauthorized', 'mcp_auth_failed'],
    ['request timed out', 'mcp_timeout'],
    ['repeated tools/list cursor', 'mcp_protocol_error'],
    ['connect ECONNREFUSED', 'mcp_unavailable'],
  ];
  for (const [message, expected] of cases) {
    await t.test(expected, async () => {
      const adapter = scriptedAdapter([{ type: 'answer', text: 'unused' }]);
      const h = harness({ adapter, listTools: async () => { throw new Error(message); } });
      const result = await new McpAgentLoop(h.deps).run(request());
      assert.equal(result.errorCode, expected);
      assert.equal(h.client.closeCalls, 1);
    });
  }
});
