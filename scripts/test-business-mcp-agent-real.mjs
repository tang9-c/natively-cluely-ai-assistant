#!/usr/bin/env node

import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readRequiredFlag(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`missing_${name.slice(2)}`);
  return value;
}

function readOptionalFlag(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function configureSelectedProvider(llm, provider, modelOverride) {
  if (provider === 'doubao') {
    const key = process.env.DOUBAO_LLM_API_KEY || process.env.DOUBAO_API_KEY;
    if (!key) throw new Error('missing_doubao_key');
    const model = modelOverride || 'doubao-seed-2-0-lite-260215';
    llm.setDoubaoApiKey(key);
    llm.setModel(model);
    return;
  }
  if (provider === 'natively' || provider === 'qcloud') {
    const key = process.env.NATIVE_API_KEY || process.env.QCLOUD_API_KEY;
    if (!key) throw new Error('missing_qcloud_key');
    llm.setNativelyKey(key);
    llm.setModel('natively');
    return;
  }
  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('missing_openai_key');
    llm.setOpenaiApiKey(process.env.OPENAI_API_KEY);
    llm.setModel(modelOverride || 'gpt-5.4');
    return;
  }
  if (provider === 'claude') {
    const key = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('missing_claude_key');
    llm.setClaudeApiKey(key);
    llm.setModel(modelOverride || 'claude-sonnet-4-6');
    return;
  }
  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('missing_gemini_key');
    llm.setApiKey(process.env.GEMINI_API_KEY);
    llm.setModel(modelOverride || 'gemini-3.1-flash-lite-preview');
    return;
  }
  if (provider === 'groq') {
    if (!process.env.GROQ_API_KEY) throw new Error('missing_groq_key');
    llm.setGroqApiKey(process.env.GROQ_API_KEY);
    llm.setModel(modelOverride || 'llama-3.3-70b-versatile');
    return;
  }
  throw new Error('unsupported_provider');
}

async function main() {
  const url = readRequiredFlag('--url');
  const provider = readRequiredFlag('--provider').toLowerCase();
  const modelOverride = readOptionalFlag('--model');
  const token = process.env.Windchill_MCP_KEY;
  if (!token) throw new Error('missing_windchill_mcp_key');
  new URL(url);

  const { LLMHelper } = require('../dist-electron/electron/LLMHelper.js');
  const { McpAgentLoop } = require('../dist-electron/electron/services/business-system/McpAgentLoop.js');
  const { McpRpcClient } = require('../dist-electron/electron/services/business-system/McpRpcClient.js');
  const { createSelectedModelToolAdapter } = require(
    '../dist-electron/electron/services/business-system/SelectedModelToolAdapterFactory.js'
  );

  const metrics = {
    status: 'failed',
    provider,
    model: modelOverride || 'default',
    toolCount: 0,
    catalogBytes: 0,
    connectMs: 0,
    discoveryMs: 0,
    modelTurns: 0,
    toolCallCount: 0,
    toolCallMs: 0,
    totalMs: 0,
  };
  const startedAt = Date.now();
  const llm = new LLMHelper();
  configureSelectedProvider(llm, provider, modelOverride);

  const loop = new McpAgentLoop({
    logger: { success() {}, failure() {} },
    clientFactory: (source, credentials) => {
      const client = new McpRpcClient({
        url: source.url,
        authType: source.authType,
        credentials,
        clientInfo: { name: 'natively-business-mcp-agent-real-test', version: '1.0.0' },
      });
      return {
        onToolsChanged: (handler) => client.onToolsChanged(handler),
        close: () => client.close(),
        async connect(timeoutMs, signal) {
          const started = Date.now();
          try {
            return await client.connect(timeoutMs, signal);
          } finally {
            metrics.connectMs += Date.now() - started;
          }
        },
        async listTools(timeoutMs, signal) {
          const started = Date.now();
          try {
            const tools = await client.listTools(timeoutMs, signal);
            metrics.toolCount = tools.length;
            metrics.catalogBytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
            return tools;
          } finally {
            metrics.discoveryMs += Date.now() - started;
          }
        },
        async callTool(name, args, timeoutMs, signal) {
          const started = Date.now();
          try {
            return await client.callTool(name, args, timeoutMs, signal);
          } finally {
            metrics.toolCallMs += Date.now() - started;
          }
        },
      };
    },
    adapterFactory: (payload) => {
      const adapter = createSelectedModelToolAdapter(llm, payload);
      metrics.provider = adapter.provider;
      metrics.model = adapter.model;
      return {
        provider: adapter.provider,
        model: adapter.model,
        async runTurn(input) {
          metrics.modelTurns += 1;
          return adapter.runTurn(input);
        },
      };
    },
  });

  const result = await loop.run({
    source: {
      id: 'real-test-source',
      name: 'Real MCP test source',
      kind: 'plm',
      url,
      authType: 'api_key',
      enabled: true,
      isDefault: true,
    },
    credentials: { apiKey: token },
    credentialRevision: 1,
    question: '查询当前 Windchill 服务器信息，只读取，不执行任何修改。',
    recentContext: '',
  });
  metrics.toolCallCount = result.toolCalls;
  metrics.totalMs = Date.now() - startedAt;
  if (result.status === 'ok') {
    metrics.status = 'passed';
  } else {
    metrics.status = result.errorCode;
    metrics.errorCode = result.errorCode;
  }
  return metrics;
}

const originalConsole = { log: console.log, warn: console.warn, error: console.error };
console.log = () => {};
console.warn = () => {};
console.error = () => {};

main().then((metrics) => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  originalConsole.log(JSON.stringify(metrics));
  if (!['passed', 'mcp_tool_calling_unsupported', 'mcp_tool_catalog_unsupported'].includes(metrics.status)) {
    process.exitCode = 1;
  }
}).catch(() => {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  originalConsole.log(JSON.stringify({ status: 'failed', errorCode: 'test_configuration_or_runtime_error' }));
  process.exitCode = 1;
});
