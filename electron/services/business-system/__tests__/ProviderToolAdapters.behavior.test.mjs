import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function load(name) {
  const modulePath = path.resolve(root, `dist-electron/electron/services/business-system/${name}.js`);
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

const tools = [{
  name: 'part_get',
  description: 'Get a part',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object', properties: { state: { type: 'string' } } },
}];

const input = (messages = [{ role: 'user', text: '查询零件' }]) => ({
  messages,
  tools,
  timeoutMs: 1000,
});

test('Anthropic uses input_schema and parses native tool_use blocks', async () => {
  const { AnthropicToolAdapter } = await load('AnthropicToolAdapter');
  let request;
  const adapter = new AnthropicToolAdapter({
    provider: 'claude',
    model: 'claude-test',
    createMessage: async (value) => {
      request = value;
      return { content: [{ type: 'tool_use', id: 'a1', name: 'part_get', input: { id: 'OR:1' } }] };
    },
  });

  const turn = await adapter.runTurn(input());

  assert.deepEqual(request.tools[0].input_schema, tools[0].inputSchema);
  assert.deepEqual(turn, {
    type: 'tool_calls',
    calls: [{ callId: 'a1', name: 'part_get', arguments: { id: 'OR:1' } }],
  });
});

test('Anthropic feeds prior tool_use and tool_result blocks back without inventing values', async () => {
  const { AnthropicToolAdapter } = await load('AnthropicToolAdapter');
  let request;
  const adapter = new AnthropicToolAdapter({
    provider: 'claude', model: 'claude-test',
    createMessage: async (value) => {
      request = value;
      return { content: [{ type: 'text', text: '完成' }] };
    },
  });
  const call = { callId: 'a1', name: 'part_get', arguments: { id: 'OR:1' } };

  await adapter.runTurn(input([
    { role: 'system', text: 'Use tools.' },
    { role: 'user', text: '查零件' },
    { role: 'assistant', toolCalls: [call] },
    { role: 'tool', callId: 'a1', name: 'part_get', result: { content: [{ type: 'text', text: 'released' }] } },
  ]));

  assert.equal(request.system, 'Use tools.');
  assert.deepEqual(request.messages[1].content[0].input, { id: 'OR:1' });
  assert.equal(request.messages[2].content[0].type, 'tool_result');
  assert.equal(request.messages[2].content[0].tool_use_id, 'a1');
});

test('Gemini uses functionDeclarations and parses native functionCall parts', async () => {
  const { GeminiToolAdapter } = await load('GeminiToolAdapter');
  let request;
  const adapter = new GeminiToolAdapter({
    provider: 'gemini',
    model: 'gemini-test',
    generateContent: async (value) => {
      request = value;
      return { candidates: [{ content: { parts: [
        { functionCall: { id: 'g1', name: 'part_get', args: { id: 'OR:1' } } },
      ] } }] };
    },
  });

  const turn = await adapter.runTurn(input());

  assert.equal(request.config.tools[0].functionDeclarations.length, tools.length);
  assert.deepEqual(request.config.tools[0].functionDeclarations[0].parametersJsonSchema, tools[0].inputSchema);
  assert.deepEqual(request.config.tools[0].functionDeclarations[0].responseJsonSchema, tools[0].outputSchema);
  assert.deepEqual(turn, {
    type: 'tool_calls',
    calls: [{ callId: 'g1', name: 'part_get', arguments: { id: 'OR:1' } }],
  });
});

test('Anthropic and Gemini normalize full-catalog rejection without shrinking the catalog', async () => {
  const { AnthropicToolAdapter } = await load('AnthropicToolAdapter');
  const { GeminiToolAdapter } = await load('GeminiToolAdapter');
  const rejectCatalog = async () => {
    const error = new Error('400 tools schema exceeds provider limit');
    error.status = 400;
    throw error;
  };
  const adapters = [
    new AnthropicToolAdapter({ provider: 'claude', model: 'claude-test', createMessage: rejectCatalog }),
    new GeminiToolAdapter({ provider: 'gemini', model: 'gemini-test', generateContent: rejectCatalog }),
  ];

  for (const adapter of adapters) {
    await assert.rejects(
      () => adapter.runTurn(input()),
      (error) => error?.code === 'mcp_tool_catalog_unsupported',
    );
  }
});

test('Anthropic and Gemini classify oversized initial catalogs and later tool results by stage', async () => {
  const { AnthropicToolAdapter } = await load('AnthropicToolAdapter');
  const { GeminiToolAdapter } = await load('GeminiToolAdapter');
  const factories = [
    (reject) => new AnthropicToolAdapter({ provider: 'claude', model: 'claude-test', createMessage: reject }),
    (reject) => new GeminiToolAdapter({ provider: 'gemini', model: 'gemini-test', generateContent: reject }),
  ];
  const toolResultMessages = [
    { role: 'user', text: '查零件' },
    { role: 'assistant', toolCalls: [{ callId: 'c1', name: 'part_get', arguments: { id: 'OR:1' } }] },
    { role: 'tool', callId: 'c1', name: 'part_get', result: { content: [{ type: 'text', text: 'large result' }] } },
  ];

  for (const makeAdapter of factories) {
    const rejectCatalog = async () => {
      const error = new Error('request entity too large');
      error.status = 413;
      throw error;
    };
    await assert.rejects(
      () => makeAdapter(rejectCatalog).runTurn(input()),
      (error) => error?.code === 'mcp_tool_catalog_unsupported',
    );

    const rejectResult = async () => {
      const error = new Error('context_length_exceeded: tool result message too large');
      error.status = 400;
      throw error;
    };
    await assert.rejects(
      () => makeAdapter(rejectResult).runTurn(input(toolResultMessages)),
      (error) => error?.code === 'mcp_tool_result_unsupported',
    );
  }
});

test('selected-model factory enforces data-scope policy before the first provider call', async () => {
  const { createSelectedModelToolAdapter } = await load('SelectedModelToolAdapterFactory');
  let providerCalls = 0;
  const helper = {
    assertMcpToolCallingDataScopes() {
      const error = new Error('transcript denied');
      error.name = 'ProviderScopeError';
      throw error;
    },
    getSelectedToolCallingBinding() {
      return {
        kind: 'openai_compatible', provider: 'openai', model: 'gpt-test',
        client: { chat: { completions: { create: async () => { providerCalls += 1; } } } },
      };
    },
  };

  assert.throws(
    () => createSelectedModelToolAdapter(helper, { question: '秘密问题', recentContext: '秘密上下文' }),
    /transcript denied/,
  );
  assert.equal(providerCalls, 0);
});

test('selected-model factory returns stable unsupported error instead of falling back providers', async () => {
  const { createSelectedModelToolAdapter } = await load('SelectedModelToolAdapterFactory');
  const helper = {
    assertMcpToolCallingDataScopes() {},
    getSelectedToolCallingBinding: () => ({ kind: 'unsupported', provider: 'ollama', model: 'local' }),
  };

  assert.throws(
    () => createSelectedModelToolAdapter(helper, { question: 'q', recentContext: '' }),
    (error) => error?.code === 'mcp_tool_calling_unsupported',
  );
});
