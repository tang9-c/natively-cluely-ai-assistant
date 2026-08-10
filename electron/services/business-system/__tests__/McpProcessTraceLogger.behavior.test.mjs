import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadModule() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/McpProcessTraceLogger.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('trace logger never emits credentials, questions, argument values, or result bodies', async () => {
  const { McpProcessTraceLogger } = await loadModule();
  const output = [];
  const logger = new McpProcessTraceLogger({
    isVerbose: () => true,
    sink: { log: (line) => output.push(line), warn: (line) => output.push(line) },
  });

  logger.success('mcp_tool_call_completed', {
    traceId: 'trace-1',
    toolName: 'part_get',
    authorization: 'Bearer secret-token-value',
    question: '查秘密物料',
    argumentShape: { number: { type: 'string', length: 10 } },
    arguments: { number: 'SECRET-123' },
    resultShape: { contentTypes: ['text'], bytes: 19 },
    result: { text: 'confidential record' },
  });

  const text = output.join('\n');
  assert.match(text, /mcp_tool_call_completed|part_get|argumentShape|resultShape/);
  assert.doesNotMatch(text, /secret-token|秘密物料|SECRET-123|confidential record/);
});

test('verbose-off suppresses success details but always emits a minimal failure', async () => {
  const { McpProcessTraceLogger } = await loadModule();
  const logs = [];
  const warnings = [];
  const logger = new McpProcessTraceLogger({
    isVerbose: () => false,
    sink: { log: (line) => logs.push(line), warn: (line) => warnings.push(line) },
  });

  logger.success('mcp_connected', { traceId: 'trace-2', hostname: 'mcp.example.test' });
  logger.failure('mcp_failed', {
    traceId: 'trace-2', stage: 'discovery', errorCode: 'mcp_timeout',
    errorMessage: 'request included SECRET-456', question: 'private question',
  });

  assert.equal(logs.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /trace-2|discovery|mcp_timeout/);
  assert.doesNotMatch(warnings[0], /SECRET-456|private question/);
});
