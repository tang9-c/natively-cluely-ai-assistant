import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadModule() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/OpenAICompatibleToolAdapter.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function makeTools(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${index}`,
    description: `Tool ${index}`,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string', title: `Value ${index}` } },
      required: ['value'],
    },
  }));
}

function baseInput(overrides = {}) {
  return {
    messages: [{ role: 'user', text: '查询零件' }],
    tools: makeTools(2),
    timeoutMs: 1000,
    ...overrides,
  };
}

test('passes every MCP tool and its input schema to OpenAI-compatible providers without filtering', async () => {
  const { OpenAICompatibleToolAdapter } = await loadModule();
  const requests = [];
  const adapter = new OpenAICompatibleToolAdapter({
    provider: 'doubao',
    model: 'doubao-test',
    createCompletion: async (request) => {
      requests.push(request);
      return { choices: [{ message: { content: '完成' } }] };
    },
  });
  const tools = makeTools(198);

  const turn = await adapter.runTurn(baseInput({ tools }));

  assert.deepEqual(turn, { type: 'answer', text: '完成' });
  assert.equal(requests[0].tools.length, 198);
  assert.deepEqual(requests[0].tools[197].function.parameters, tools[197].inputSchema);
});

test('parses native parallel tool calls and uses only provider-generated arguments', async () => {
  const { OpenAICompatibleToolAdapter } = await loadModule();
  const adapter = new OpenAICompatibleToolAdapter({
    provider: 'openai',
    model: 'gpt-test',
    createCompletion: async () => ({ choices: [{ message: { tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'part_search', arguments: '{"number":"A-1"}' } },
      { id: 'c2', type: 'function', function: { name: 'project_list', arguments: '{}' } },
    ] } }] }),
  });

  const turn = await adapter.runTurn(baseInput());

  assert.equal(turn.type, 'tool_calls');
  assert.deepEqual(turn.calls, [
    { callId: 'c1', name: 'part_search', arguments: { number: 'A-1' } },
    { callId: 'c2', name: 'project_list', arguments: {} },
  ]);
});

test('maps prior assistant calls and MCP result content into native tool messages', async () => {
  const { OpenAICompatibleToolAdapter } = await loadModule();
  let request;
  const adapter = new OpenAICompatibleToolAdapter({
    provider: 'qcloud',
    model: 'lite32k',
    createCompletion: async (value) => {
      request = value;
      return { choices: [{ message: { content: '已完成' } }] };
    },
  });
  const call = { callId: 'call-1', name: 'part_get', arguments: { id: 'OR:1' } };

  await adapter.runTurn(baseInput({ messages: [
    { role: 'user', text: '查零件' },
    { role: 'assistant', toolCalls: [call] },
    { role: 'tool', callId: 'call-1', name: 'part_get', result: { content: [{ type: 'text', text: '{"state":"RELEASED"}' }] } },
  ] }));

  assert.equal(request.messages[1].tool_calls[0].function.arguments, '{"id":"OR:1"}');
  assert.equal(request.messages[2].role, 'tool');
  assert.equal(request.messages[2].tool_call_id, 'call-1');
  assert.equal(request.messages[2].content, '[{"type":"text","text":"{\\"state\\":\\"RELEASED\\"}"}]');
});

test('rejects malformed provider arguments and classifies rejected tool catalogs', async () => {
  const { OpenAICompatibleToolAdapter } = await loadModule();
  const malformed = new OpenAICompatibleToolAdapter({
    provider: 'openai', model: 'gpt-test',
    createCompletion: async () => ({ choices: [{ message: { tool_calls: [
      { id: 'c1', function: { name: 'part_get', arguments: '["not-an-object"]' } },
    ] } }] }),
  });
  await assert.rejects(
    () => malformed.runTurn(baseInput()),
    (error) => error?.code === 'mcp_protocol_error',
  );

  const rejected = new OpenAICompatibleToolAdapter({
    provider: 'openai', model: 'gpt-test',
    createCompletion: async () => {
      const error = new Error('400 invalid tools schema: too many functions');
      error.status = 400;
      throw error;
    },
  });
  await assert.rejects(
    () => rejected.runTurn(baseInput()),
    (error) => error?.code === 'mcp_tool_catalog_unsupported',
  );
});
