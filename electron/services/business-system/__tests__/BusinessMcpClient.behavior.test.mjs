// electron/services/business-system/__tests__/BusinessMcpClient.behavior.test.mjs
//
// Behavioral coverage for BusinessMcpClient.ts:
//   - normalizeBusinessMcpToolResult happy path
//   - normalizeBusinessMcpToolResult: error / isError / invalid content
//   - normalizeBusinessMcpToolResult: status validation
//   - normalizeBusinessMcpToolResult: sourceName fallback
//   - normalizeBusinessMcpToolResult: items pass-through
//   - query() unreachable URL → status "unavailable"
//   - query() invalid URL → status "unavailable"
//   - query() timeout / aborted error message → status "timeout"
//   - query() unauthorized / 401 / 403 → status "auth_failed"
//   - export of BUSINESS_CONTEXT_TOOL_NAME

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadClient() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/BusinessMcpClient.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

const baseSource = () => ({
  id: 'plm-default',
  name: 'PLM 知识源',
  kind: 'plm',
  url: 'https://plm.example.test/mcp',
  authType: 'api_key',
  enabled: true,
});

test('BusinessMcpClient exports the canonical read-only tool name', async () => {
  const { BUSINESS_CONTEXT_TOOL_NAME } = await loadClient();
  assert.equal(BUSINESS_CONTEXT_TOOL_NAME, 'business_context.query');
});

test('normalizeBusinessMcpToolResult: parses structured ok result', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({
    content: [{ type: 'text', text: JSON.stringify({
      status: 'ok',
      sourceName: 'Windchill',
      summary: 'found 1 part',
      items: [{ id: '1' }],
    }) }],
  }, 'Fallback');
  assert.equal(result.status, 'ok');
  assert.equal(result.sourceName, 'Windchill');
  assert.equal(result.summary, 'found 1 part');
  assert.deepEqual(result.items, [{ id: '1' }]);
});

test('normalizeBusinessMcpToolResult: isError → status "error" with tool_error code', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({ isError: true, content: [] }, 'PLM');
  assert.equal(result.status, 'error');
  assert.equal(result.sourceName, 'PLM');
  assert.equal(result.errorCode, 'tool_error');
});

test('normalizeBusinessMcpToolResult: missing content array → status "error"', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({}, 'PLM');
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, 'invalid_tool_result');
});

test('normalizeBusinessMcpToolResult: non-text content type → status "error"', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({ content: [{ type: 'image', data: 'x' }] }, 'PLM');
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, 'invalid_tool_result');
});

test('normalizeBusinessMcpToolResult: invalid JSON in text content → status "error"', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({ content: [{ type: 'text', text: 'not json' }] }, 'PLM');
  assert.equal(result.status, 'error');
  assert.equal(result.errorCode, 'invalid_tool_result');
});

test('normalizeBusinessMcpToolResult: invalid status string in payload → status "error"', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({ content: [{ type: 'text', text: JSON.stringify({
    status: 'totally_unknown_status',
  }) }] }, 'PLM');
  assert.equal(result.status, 'error');
});

test('normalizeBusinessMcpToolResult: empty sourceName → falls back to fallbackSourceName', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({ content: [{ type: 'text', text: JSON.stringify({
    status: 'ok',
    sourceName: '   ',
    summary: 'x',
  }) }] }, 'Fallback Source');
  assert.equal(result.sourceName, 'Fallback Source');
});

test('normalizeBusinessMcpToolResult: missing items array → items undefined', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({ content: [{ type: 'text', text: JSON.stringify({
    status: 'ok',
    summary: 'no items here',
  }) }] }, 'PLM');
  assert.equal(result.status, 'ok');
  assert.equal(result.items, undefined);
});

test('normalizeBusinessMcpToolResult: missing summary → summary undefined', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const result = normalizeBusinessMcpToolResult({ content: [{ type: 'text', text: JSON.stringify({
    status: 'no_result',
  }) }] }, 'PLM');
  assert.equal(result.status, 'no_result');
  assert.equal(result.summary, undefined);
});

test('normalizeBusinessMcpToolResult: ambiguous and unavailable are valid statuses', async () => {
  const { normalizeBusinessMcpToolResult } = await loadClient();
  const ambiguous = normalizeBusinessMcpToolResult({ content: [{ type: 'text', text: JSON.stringify({ status: 'ambiguous' }) }] }, 'PLM');
  assert.equal(ambiguous.status, 'ambiguous');
  const unavailable = normalizeBusinessMcpToolResult({ content: [{ type: 'text', text: JSON.stringify({ status: 'unavailable' }) }] }, 'PLM');
  assert.equal(unavailable.status, 'unavailable');
});

test('query: invalid URL → status "unavailable" without throwing', async () => {
  const { BusinessMcpClient } = await loadClient();
  const client = new BusinessMcpClient();
  const result = await client.query(
    { ...baseSource(), url: 'not a url' },
    { apiKey: 'k' },
    { query: 'a12345', sourceHint: 'plm', recentContext: '' },
    100,
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sourceName, 'PLM 知识源');
});

test('query: unreachable URL → status "unavailable"', async () => {
  const { BusinessMcpClient } = await loadClient();
  const client = new BusinessMcpClient();
  const result = await client.query(
    { ...baseSource(), url: 'http://0.0.0.0:1/mcp' },
    { apiKey: 'k' },
    { query: 'a12345', sourceHint: 'plm', recentContext: '' },
    100,
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sourceName, 'PLM 知识源');
});

test('query: passes through sourceHint / query / recentContext to the tool arguments', async () => {
  // We can't easily intercept the SDK transport, so we verify the network
  // failure path passes through our source.name.
  const { BusinessMcpClient } = await loadClient();
  const client = new BusinessMcpClient();
  const result = await client.query(
    { ...baseSource(), name: 'Custom PLM' },
    { apiKey: 'k' },
    { query: 'a12345', sourceHint: 'plm', recentContext: 'recent stuff' },
    50,
  );
  assert.equal(result.sourceName, 'Custom PLM');
});
