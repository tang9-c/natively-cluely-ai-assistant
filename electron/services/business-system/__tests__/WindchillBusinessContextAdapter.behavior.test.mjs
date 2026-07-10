// electron/services/business-system/__tests__/WindchillBusinessContextAdapter.behavior.test.mjs
//
// Behavioral coverage for WindchillBusinessContextAdapter.ts:
//   - extractPartNumberFromQuery: letter+digit, digit+*, BOLT-001, etc.
//   - mapWindchillErrorToStatus: 401/403, AbortError, ECONNREFUSED
//   - wrapWindchillPartResults: single hit, empty, multiple hits
//   - query: sourceHint routing, sourceUrl, apiKey, toolCache, full flow

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadAdapter() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/WindchillBusinessContextAdapter.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function makeStubFetch(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      if (typeof r === 'function') return r(init);
      return new Response(JSON.stringify(r.body), {
        status: r.status || 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}

test('extractPartNumberFromQuery: letter+digit, BOLT-001, BOLT 001, wildcard', async () => {
  const { extractPartNumberFromQuery } = await loadAdapter();
  assert.equal(extractPartNumberFromQuery('查询物料 a12345 的状态'), 'a12345');
  assert.equal(extractPartNumberFromQuery('BOLT-001 在哪里'), 'BOLT-001');
  assert.equal(extractPartNumberFromQuery('BOLT 001 在哪里'), 'BOLT-001'); // space → dash
  assert.equal(extractPartNumberFromQuery('00000* 开头的物料'), '00000*');
  assert.equal(extractPartNumberFromQuery('PRT-9999'), 'PRT-9999');
  assert.equal(extractPartNumberFromQuery('随便聊聊别的'), null);
});

test('extractPartNumberFromQuery: pure numeric (3+ digits) is also matched', async () => {
  const { extractPartNumberFromQuery } = await loadAdapter();
  assert.equal(extractPartNumberFromQuery('查一下 999 的信息'), '999');
  assert.equal(extractPartNumberFromQuery('订单 12345 状态'), '12345');
});

test('mapWindchillErrorToStatus: 401/403 statusCode → "auth_failed"', async () => {
  const { mapWindchillErrorToStatus } = await loadAdapter();
  assert.equal(mapWindchillErrorToStatus({ statusCode: 401 }), 'auth_failed');
  assert.equal(mapWindchillErrorToStatus({ statusCode: 403 }), 'auth_failed');
  assert.equal(mapWindchillErrorToStatus({ message: '401 Unauthorized' }), 'auth_failed');
  assert.equal(mapWindchillErrorToStatus({ message: 'Forbidden (403)' }), 'auth_failed');
});

test('mapWindchillErrorToStatus: AbortError / ETIMEDOUT / ABORT_ERR → "timeout"', async () => {
  const { mapWindchillErrorToStatus } = await loadAdapter();
  assert.equal(mapWindchillErrorToStatus({ name: 'AbortError' }), 'timeout');
  assert.equal(mapWindchillErrorToStatus({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(mapWindchillErrorToStatus({ code: 'ABORT_ERR' }), 'timeout');
  assert.equal(mapWindchillErrorToStatus({ message: 'Request timed out after 2000ms' }), 'timeout');
  assert.equal(mapWindchillErrorToStatus({ message: 'fetch was aborted' }), 'timeout');
});

test('mapWindchillErrorToStatus: ECONNREFUSED / ENOTFOUND / unknown → "unavailable"', async () => {
  const { mapWindchillErrorToStatus } = await loadAdapter();
  assert.equal(mapWindchillErrorToStatus({ code: 'ECONNREFUSED' }), 'unavailable');
  assert.equal(mapWindchillErrorToStatus({ code: 'ENOTFOUND' }), 'unavailable');
  assert.equal(mapWindchillErrorToStatus({ message: 'fetch failed' }), 'unavailable');
  assert.equal(mapWindchillErrorToStatus({}), 'unavailable');
});

test('wrapWindchillPartResults: single hit → status "ok" with structured evidence', async () => {
  const { wrapWindchillPartResults } = await loadAdapter();
  const odata = { value: [{
    ID: 'OR:wt.part.WTPart:238446',
    Name: 'Plate-A',
    Number: 'PRT-001',
    State: { Display: 'Released' },
  }] };
  const result = wrapWindchillPartResults(odata, 'Windchill PLM');
  assert.equal(result.status, 'ok');
  assert.equal(result.sourceName, 'Windchill PLM');
  assert.equal(result.evidence.sourceTool, 'part_search');
  assert.equal(result.evidence.records.length, 1);
  assert.equal(result.evidence.records[0].title, 'PRT-001 / Plate-A');
});

test('wrapWindchillPartResults: empty value array → status "no_result"', async () => {
  const { wrapWindchillPartResults } = await loadAdapter();
  const result = wrapWindchillPartResults({ value: [] }, 'Windchill');
  assert.equal(result.status, 'no_result');
  assert.equal(result.sourceName, 'Windchill');
  // no_result has no evidence.records
  assert.equal(result.evidence?.records?.length ?? 0, 0);
});

test('wrapWindchillPartResults: 3+ hits → status "ambiguous"', async () => {
  const { wrapWindchillPartResults } = await loadAdapter();
  const odata = { value: [
    { ID: 'OR:1', Number: 'PRT-001' },
    { ID: 'OR:2', Number: 'PRT-002' },
    { ID: 'OR:3', Number: 'PRT-003' },
  ] };
  const result = wrapWindchillPartResults(odata, 'Windchill');
  assert.equal(result.status, 'ambiguous');
  assert.match(result.summary, /3/);
  assert.equal(result.evidence.recordCount, 3);
});

test('query: sourceHint !== "plm" returns "no_result" without any network call', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch });
  const result = await adapter.query(
    { query: '查询物料 a12345', sourceHint: 'qms', recentContext: '' },
    { apiKey: 'k' },
    100,
  );
  assert.equal(result.status, 'no_result');
  assert.equal(stub.calls.length, 0, 'no network call when sourceHint mismatches');
});

test('query: missing sourceUrl returns "not_configured"', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch });
  const result = await adapter.query(
    { query: '查 a12345', sourceHint: 'plm' },
    { apiKey: 'k' },
    100,
  );
  assert.equal(result.status, 'not_configured');
  assert.equal(result.errorCode, 'no_url');
});

test('query: missing apiKey returns "auth_failed"', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch });
  const result = await adapter.query(
    { query: '查 a12345', sourceHint: 'plm', sourceUrl: 'https://example/mcp' },
    {},
    100,
  );
  assert.equal(result.status, 'auth_failed');
  assert.equal(result.errorCode, 'no_api_key');
});

test('query: full happy path → initialize + tools/list + tools/call(part_search) → ok', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([
    { body: { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'windchill' } } } },
    { body: { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'part_search' }] } } },
    { body: { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: JSON.stringify({
      value: [{ ID: 'OR:1', Name: 'Plate', Number: 'PRT-001', State: { Display: 'Released' } }],
    }) }] } } },
  ]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch });

  const result = await adapter.query(
    { query: '查 PRT-001', sourceHint: 'plm', sourceUrl: 'https://example/mcp' },
    { apiKey: 'k' },
    2000,
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.evidence.sourceTool, 'part_search');
  assert.equal(stub.calls.length, 3);
});

test('query: toolCache reuses tools/list response when within TTL', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([
    { body: { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'windchill' } } } },
    { body: { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'part_search' }] } } },
    { body: { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: JSON.stringify({
      value: [{ ID: 'OR:1', Name: 'P1', Number: 'PRT-001' }],
    }) }] } } },
    // For the second query, we don't expect tools/list, only initialize + tools/call
    { body: { jsonrpc: '2.0', id: 5, result: { serverInfo: { name: 'windchill' } } } },
    { body: { jsonrpc: '2.0', id: 6, result: { content: [{ type: 'text', text: JSON.stringify({
      value: [{ ID: 'OR:2', Name: 'P2', Number: 'PRT-002' }],
    }) }] } } },
  ]);
  // Use a fixed nowMs so the cache TTL is deterministic
  let now = 1_000_000;
  const adapter = createWindchillBusinessContextAdapter({
    fetchImpl: stub.fetch,
    nowMs: () => now,
  });

  // First query: triggers initialize + tools/list + tools/call
  await adapter.query(
    { query: '查 PRT-001', sourceHint: 'plm', sourceUrl: 'https://cache.example/mcp' },
    { apiKey: 'k' },
    2000,
  );
  const firstCallCount = stub.calls.length;

  // Advance time but stay within cache TTL (10 minutes)
  now += 30_000;

  // Second query: should NOT re-list tools (cache hit)
  await adapter.query(
    { query: '查 PRT-002', sourceHint: 'plm', sourceUrl: 'https://cache.example/mcp' },
    { apiKey: 'k' },
    2000,
  );
  // First query: 3 calls. Second query should be 2 calls (initialize + tools/call).
  assert.equal(stub.calls.length, firstCallCount + 2,
    'second query should skip tools/list due to cache');
});

test('query: toolCache expires after TTL', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([
    { body: { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'windchill' } } } },
    { body: { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'part_search' }] } } },
    { body: { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: JSON.stringify({
      value: [{ ID: 'OR:1', Number: 'PRT-001' }],
    }) }] } } },
    { body: { jsonrpc: '2.0', id: 4, result: { serverInfo: { name: 'windchill' } } } },
    { body: { jsonrpc: '2.0', id: 5, result: { tools: [{ name: 'part_search' }] } } },
    { body: { jsonrpc: '2.0', id: 6, result: { content: [{ type: 'text', text: JSON.stringify({
      value: [{ ID: 'OR:2', Number: 'PRT-002' }],
    }) }] } } },
  ]);
  let now = 1_000_000;
  const adapter = createWindchillBusinessContextAdapter({
    fetchImpl: stub.fetch,
    nowMs: () => now,
  });

  await adapter.query(
    { query: '查 PRT-001', sourceHint: 'plm', sourceUrl: 'https://ttl.example/mcp' },
    { apiKey: 'k' },
    2000,
  );

  // Advance time beyond cache TTL (default 10 minutes = 600_000 ms)
  now += 700_000;

  await adapter.query(
    { query: '查 PRT-002', sourceHint: 'plm', sourceUrl: 'https://ttl.example/mcp' },
    { apiKey: 'k' },
    2000,
  );
  // Both queries: 3 calls each, total 6
  assert.equal(stub.calls.length, 6, 'tools/list called again after cache expiry');
});

test('query: fetch throws ECONNREFUSED → status "unavailable"', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const fetcher = async () => {
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    throw err;
  };
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: fetcher });
  const result = await adapter.query(
    { query: '查 PRT-500', sourceHint: 'plm', sourceUrl: 'https://example-500/mcp' },
    { apiKey: 'k' },
    2000,
  );
  assert.equal(result.status, 'unavailable');
});

test('query: vague query without anchor → status "missing_query_anchor" without network', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch });
  const result = await adapter.query(
    { query: '查一下这个', sourceHint: 'plm', sourceUrl: 'https://example-anchor/mcp' },
    { apiKey: 'k' },
    2000,
  );
  assert.equal(result.status, 'missing_query_anchor');
  assert.equal(stub.calls.length, 0, 'no network call when anchor is missing');
});

test('query: explicit unsupported write intent (approve) → "unsupported_operation" without network', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch });
  const result = await adapter.query(
    { query: '请 approve ECN-123', sourceHint: 'plm', sourceUrl: 'https://example-write/mcp' },
    { apiKey: 'k' },
    2000,
  );
  assert.equal(result.status, 'unsupported_operation');
  assert.equal(stub.calls.length, 0);
});
