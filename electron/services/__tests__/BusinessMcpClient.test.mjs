import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadClient() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/BusinessMcpClient.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('BusinessMcpClient exports the fixed read-only tool name', async () => {
  const { BUSINESS_CONTEXT_TOOL_NAME } = await loadClient();
  assert.equal(BUSINESS_CONTEXT_TOOL_NAME, 'business_context.query');
});

test('BusinessMcpClient source does not expose generic caller-controlled tool execution', () => {
  const source = fs.readFileSync(path.join(root, 'electron/services/business-system/BusinessMcpClient.ts'), 'utf8');

  assert.match(source, /BUSINESS_CONTEXT_TOOL_NAME\s*=\s*'business_context\.query'/);
  assert.doesNotMatch(source, /callTool\(\s*\{\s*name:\s*toolName/);
  assert.doesNotMatch(source, /callTool\(\s*\{\s*name:\s*input\.tool/);
  assert.doesNotMatch(source, /StdioClientTransport/);
});

test('normalizes malformed tool content as error instead of trusting arbitrary text', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const normalized = normalizeBusinessMcpToolResult({
    content: [{ type: 'text', text: 'plain text that is not JSON' }],
  }, 'PLM 知识源');

  assert.equal(normalized.status, 'error');
  assert.equal(normalized.sourceName, 'PLM 知识源');
});

test('normalizes structured ok result', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const normalized = normalizeBusinessMcpToolResult({
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'ok',
        sourceName: 'PLM 知识源',
        summary: '物料 a12345 当前可用。',
        items: [],
      }),
    }],
  }, 'Fallback Source');

  assert.equal(normalized.status, 'ok');
  assert.equal(normalized.sourceName, 'PLM 知识源');
  assert.match(normalized.summary, /a12345/);
});

test('normalizes invalid endpoint URL instead of throwing', async () => {
  const { BusinessMcpClient } = await loadClient();
  const client = new BusinessMcpClient();

  const result = await client.query({
    id: 'bad-url',
    name: 'PLM 知识源',
    kind: 'plm',
    url: 'not a valid url',
    authType: 'api_key',
    enabled: true,
  }, { apiKey: 'secret-key' }, { query: '根据 PLM 查一下物料 a12345' }, 10);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.sourceName, 'PLM 知识源');
});

test('applies the business read timeout to MCP initialization as well as tool calls', () => {
  const source = fs.readFileSync(path.join(root, 'electron/services/business-system/BusinessMcpClient.ts'), 'utf8');

  assert.match(source, /client\.connect\(\s*transport\s*,\s*\{\s*timeout:\s*timeoutMs\s*\}/);
  assert.match(source, /client\.callTool\([\s\S]*\{\s*timeout:\s*timeoutMs\s*\}/);
});
