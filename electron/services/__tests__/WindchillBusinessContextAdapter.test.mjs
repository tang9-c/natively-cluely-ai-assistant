import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadAdapter() {
  const modulePath = path.resolve(
    root,
    'dist-electron/electron/services/business-system/WindchillBusinessContextAdapter.js'
  );
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

// RED #1: sourceHint 路由。当 sourceHint 不是 'plm' 时,adapter 应直接返回 no_result,
// 而不调用任何外部资源。我们用一个不可达的 URL,确认网络层不会被触发。
test('WindchillBusinessContextAdapter: sourceHint !== "plm" returns no_result without side effects', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const adapter = createWindchillBusinessContextAdapter({
    url: 'http://0.0.0.0:1/mcp',
    apiKey: 'whatever',
    sourceName: 'Windchill PLM',
  });

  const result = await adapter.query(
    {
      query: '查询物料 a12345',
      sourceHint: 'qms',
      recentContext: '',
    },
    { apiKey: 'whatever' },
    100
  );

  assert.equal(result.status, 'no_result');
});

// RED #2: 从自然语言 query 中抽取 part number。这是无副作用的纯函数,
// 用它来决定调 part_search 时传 number 还是走 list-all 路径。
test('extractPartNumberFromQuery: returns the token matching letter+digits / wildcard pattern', async () => {
  const { extractPartNumberFromQuery } = await loadAdapter();

  assert.equal(extractPartNumberFromQuery('查询物料 a12345 的状态'), 'a12345');
  assert.equal(extractPartNumberFromQuery('查一下 999 的信息'), '999');
  assert.equal(extractPartNumberFromQuery('00000* 开头的物料'), '00000*');
  assert.equal(extractPartNumberFromQuery('BOLT-001 在哪里'), 'BOLT-001');
  assert.equal(extractPartNumberFromQuery('随便聊聊别的'), null);
});

// RED #3: Windchill OData 响应 → BusinessSystemQueryResult。这是纯函数包装层,
// 输入是 part_search 返回的 OData JSON,输出符合项目规定的 status/sourceName/summary/items。
test('wrapWindchillPartResults: single hit → status "ok" with one item', async () => {
  const { wrapWindchillPartResults } = await loadAdapter();

  const odata = {
    value: [{
      ID: 'OR:wt.part.WTPart:238446',
      Name: 'Plate-A',
      Number: 'PRT-001',
      State: { Display: 'Released' },
    }],
  };

  const result = wrapWindchillPartResults(odata, 'Windchill PLM');
  assert.equal(result.status, 'ok');
  assert.equal(result.sourceName, 'Windchill PLM');
  assert.match(result.summary, /PRT-001/);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'OR:wt.part.WTPart:238446');
  assert.equal(result.items[0].number, 'PRT-001');
});

test('wrapWindchillPartResults: empty value → status "no_result"', async () => {
  const { wrapWindchillPartResults } = await loadAdapter();
  const result = wrapWindchillPartResults({ value: [] }, 'Windchill PLM');
  assert.equal(result.status, 'no_result');
  assert.equal(result.sourceName, 'Windchill PLM');
  assert.equal(result.items, undefined);
});

test('wrapWindchillPartResults: multiple hits → status "ambiguous"', async () => {
  const { wrapWindchillPartResults } = await loadAdapter();
  const odata = {
    value: [
      { ID: 'OR:1', Name: 'Plate', Number: 'PRT-001', State: { Display: 'Released' } },
      { ID: 'OR:2', Name: 'Plate', Number: 'PRT-002', State: { Display: 'Released' } },
      { ID: 'OR:3', Name: 'Plate', Number: 'PRT-003', State: { Display: 'Released' } },
    ],
  };
  const result = wrapWindchillPartResults(odata, 'Windchill PLM');
  assert.equal(result.status, 'ambiguous');
  assert.match(result.summary, /3/);
  assert.equal(result.items.length, 3);
});

// RED #4: 错误 → BusinessSystemQueryResult.status 映射。这是纯函数,
// 让网络层捕获异常后只需要调它就能得到正确状态。
test('mapWindchillErrorToStatus: maps ECONNREFUSED / ENOTFOUND → "unavailable"', async () => {
  const { mapWindchillErrorToStatus } = await loadAdapter();
  assert.equal(mapWindchillErrorToStatus({ code: 'ECONNREFUSED' }), 'unavailable');
  assert.equal(mapWindchillErrorToStatus({ code: 'ENOTFOUND' }), 'unavailable');
  assert.equal(mapWindchillErrorToStatus({ message: 'fetch failed' }), 'unavailable');
});

test('mapWindchillErrorToStatus: maps 401 / 403 message → "auth_failed"', async () => {
  const { mapWindchillErrorToStatus } = await loadAdapter();
  assert.equal(mapWindchillErrorToStatus({ message: '401 Unauthorized' }), 'auth_failed');
  assert.equal(mapWindchillErrorToStatus({ message: 'Forbidden (403)' }), 'auth_failed');
  assert.equal(mapWindchillErrorToStatus({ statusCode: 401 }), 'auth_failed');
});

test('mapWindchillErrorToStatus: maps timeout / AbortError → "timeout"', async () => {
  const { mapWindchillErrorToStatus } = await loadAdapter();
  assert.equal(mapWindchillErrorToStatus({ name: 'AbortError' }), 'timeout');
  assert.equal(mapWindchillErrorToStatus({ code: 'ETIMEDOUT' }), 'timeout');
  assert.equal(mapWindchillErrorToStatus({ message: 'Request timed out after 2000ms' }), 'timeout');
});

test('mapWindchillErrorToStatus: unknown tool from server → "unavailable" (not ok / not no_result)', async () => {
  const { mapWindchillErrorToStatus } = await loadAdapter();
  assert.equal(mapWindchillErrorToStatus({ message: 'Unknown tool: business_context.query' }), 'unavailable');
});

// Query 完整路径测试:用 stub fetch 验证 initialize + tools/call(part_search) + wrap 全链路。
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

test('query: happy path → initialize + tools/call(part_search) + wrap to ok', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();

  const stub = makeStubFetch([
    { body: { jsonrpc: '2.0', id: 1, result: { capabilities: {} } } },
    { body: { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({
      value: [{ ID: 'OR:1', Name: 'Plate', Number: 'PRT-001', State: { Display: 'Released' } }],
    }) }] } } },
  ]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch, sourceName: 'Windchill PLM' });

  const result = await adapter.query(
    { query: '根据PLM查一下物料 PRT-001', sourceHint: 'plm', sourceUrl: 'https://example/mcp' },
    { apiKey: 'secret' },
    2000,
  );

  assert.equal(stub.calls.length, 2);
  assert.match(stub.calls[0].init.body, /"method":"initialize"/);
  assert.match(stub.calls[1].init.body, /"name":"part_search"/);
  assert.match(stub.calls[1].init.body, /"number":"PRT-001"/);
  assert.equal(result.status, 'ok');
  assert.equal(result.items[0].number, 'PRT-001');
});

test('query: missing sourceUrl → status "not_configured"', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const adapter = createWindchillBusinessContextAdapter({});
  const result = await adapter.query(
    { query: 'x', sourceHint: 'plm' },
    { apiKey: 'k' },
    2000,
  );
  assert.equal(result.status, 'not_configured');
  assert.equal(result.errorCode, 'no_url');
});

test('query: missing apiKey → status "auth_failed"', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const adapter = createWindchillBusinessContextAdapter({});
  const result = await adapter.query(
    { query: 'x', sourceHint: 'plm', sourceUrl: 'https://example/mcp' },
    {},
    2000,
  );
  assert.equal(result.status, 'auth_failed');
  assert.equal(result.errorCode, 'no_api_key');
});

test('query: fetch returns non-ok → mapped via mapWindchillErrorToStatus', async () => {
  const { createWindchillBusinessContextAdapter } = await loadAdapter();
  const stub = makeStubFetch([
    { status: 401, body: { message: 'Unauthorized' } },
  ]);
  const adapter = createWindchillBusinessContextAdapter({ fetchImpl: stub.fetch });
  const result = await adapter.query(
    { query: 'x', sourceHint: 'plm', sourceUrl: 'https://example/mcp' },
    { apiKey: 'bad' },
    2000,
  );
  assert.equal(result.status, 'auth_failed');
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
    { query: 'x', sourceHint: 'plm', sourceUrl: 'https://example/mcp' },
    { apiKey: 'k' },
    2000,
  );
  assert.equal(result.status, 'unavailable');
  assert.match(result.errorCode, /windchill/);
});
