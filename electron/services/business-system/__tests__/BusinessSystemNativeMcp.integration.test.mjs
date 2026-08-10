import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadService() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/BusinessSystemContextService.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function source(overrides = {}) {
  return {
    id: 'source-1', name: '业务知识源', kind: 'plm', url: 'https://mcp.example.test/mcp',
    authType: 'api_key', enabled: true, isDefault: true, ...overrides,
  };
}

function credentialsManager(sources) {
  return {
    getBusinessSystemKnowledgeSources: () => sources,
    getBusinessSystemCredentials: () => ({ apiKey: 'source-owned-key' }),
    getBusinessSystemCredentialRevision: () => 7,
  };
}

function serviceDeps(sources, run, enabled = true) {
  return {
    credentialsManager: credentialsManager(sources),
    agentLoop: { run },
    settingsManager: { getNativeMcpToolCallingEnabled: () => enabled },
  };
}

test('PLM and generic business sources use the same MCP agent loop with source-owned credentials', async () => {
  const { BusinessSystemContextService } = await loadService();
  const calls = [];
  const run = async (input) => {
    calls.push(input);
    return { status: 'ok', answer: `动态结果-${input.source.kind}`, traceId: 'trace-1', toolCalls: 1 };
  };
  const plmService = new BusinessSystemContextService(serviceDeps([source()], run));
  const genericService = new BusinessSystemContextService(serviceDeps([
    source({ id: 'erp-1', kind: 'erp', name: 'ERP', url: 'https://erp.example.test/mcp' }),
  ], run));

  const plm = await plmService.resolve({ question: '根据 PLM 查询物料 A123' });
  const erp = await genericService.resolve({ question: '根据 ERP 查询订单 SO-123' });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].source.url, 'https://mcp.example.test/mcp');
  assert.equal(calls[0].credentials.apiKey, 'source-owned-key');
  assert.equal(calls[0].credentialRevision, 7);
  assert.equal(calls[1].source.kind, 'erp');
  assert.equal(plm.answer, '动态结果-plm');
  assert.equal(erp.answer, '动态结果-erp');
  assert.match(plm.candidate.text, /动态结果-plm/);
});

test('write requests are passed to MCP instead of being denied by a client-side safety rule', async () => {
  const { BusinessSystemContextService } = await loadService();
  const calls = [];
  const service = new BusinessSystemContextService(serviceDeps([source()], async (input) => {
    calls.push(input);
    return { status: 'ok', answer: '服务器已处理请求', traceId: 'trace-write', toolCalls: 1 };
  }));

  const result = await service.resolve({ question: '在 PLM 中修改物料 A123 的状态' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].question, '在 PLM 中修改物料 A123 的状态');
  assert.equal(result.kind, 'context');
});

test('source selection still prefers the matching default before entering the generic agent loop', async () => {
  const { BusinessSystemContextService } = await loadService();
  let selectedId;
  const sources = [
    source({ id: 'plm-a', isDefault: false }),
    source({ id: 'plm-b', isDefault: true }),
  ];
  const service = new BusinessSystemContextService(serviceDeps(sources, async (input) => {
    selectedId = input.source.id;
    return { status: 'ok', answer: 'selected', traceId: 'trace-selected', toolCalls: 0 };
  }));

  const result = await service.resolve({ question: '根据 PLM 查询物料 A123' });

  assert.equal(result.kind, 'context');
  assert.equal(selectedId, 'plm-b');
});

test('disabled native MCP gate reports unavailable and invokes no legacy or agent path', async () => {
  const { BusinessSystemContextService } = await loadService();
  let agentCalls = 0;
  const service = new BusinessSystemContextService(serviceDeps([source()], async () => {
    agentCalls += 1;
    return { status: 'ok', answer: 'should not run', traceId: 'trace-x', toolCalls: 0 };
  }, false));

  const result = await service.resolve({ question: '根据 PLM 查询物料 A123' });

  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'unavailable');
  assert.equal(agentCalls, 0);
});

test('stable agent failures map to existing business-system fixed replies', async (t) => {
  const { BusinessSystemContextService } = await loadService();
  const cases = [
    ['mcp_auth_failed', 'auth_failed'],
    ['mcp_timeout', 'timeout'],
    ['mcp_unavailable', 'unavailable'],
    ['mcp_protocol_error', 'error'],
    ['mcp_tool_calling_unsupported', 'unavailable'],
    ['mcp_tool_catalog_unsupported', 'error'],
    ['mcp_tool_result_unsupported', 'error'],
    ['mcp_agent_limit_reached', 'error'],
  ];
  for (const [errorCode, expectedStatus] of cases) {
    await t.test(errorCode, async () => {
      const service = new BusinessSystemContextService(serviceDeps([source()], async () => ({
        status: 'error', errorCode, traceId: 'trace-error', toolCalls: 0,
      })));
      const result = await service.resolve({ question: '根据 PLM 查询物料 A123' });
      assert.equal(result.status, expectedStatus);
    });
  }
});
