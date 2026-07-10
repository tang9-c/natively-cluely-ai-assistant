// electron/services/business-system/__tests__/BusinessSystemContextService.behavior.test.mjs
//
// Behavioral coverage for BusinessSystemContextService.ts:
//   - resolve() with no trigger → kind "skipped"
//   - resolve() with explicit trigger but no MCP source → fixed_reply missing_query_anchor
//   - resolve() with disabled source → kind "skipped"
//   - resolve() with no sourceHint match → kind "skipped"
//   - resolve() with ok MCP result → context candidate
//   - resolve() with error MCP result → fixed_reply
//   - businessSystemDegradedReasonForStatus maps statuses
//   - toBusinessSystemFixedReply for various statuses

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
    id: 'plm-default',
    name: 'PLM 知识源',
    kind: 'plm',
    url: 'https://plm.example.test/mcp',
    authType: 'api_key',
    enabled: true,
    isDefault: true,
    ...overrides,
  };
}

function credentialsManagerStub(sources, credentials = { apiKey: 'secret-key' }) {
  return {
    getBusinessSystemKnowledgeSources: () => sources,
    getBusinessSystemCredentials: () => credentials,
  };
}

test('resolve: no explicit trigger → kind "skipped" without calling MCP', async () => {
  const { BusinessSystemContextService } = await loadService();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => { called = true; return { status: 'ok' }; } },
  });
  const result = await service.resolve({ question: '今天天气怎么样' });
  assert.equal(result.kind, 'skipped');
  assert.equal(called, false);
});

test('resolve: enabled=false on all sources → degraded fixed_reply without calling MCP', async () => {
  const { BusinessSystemContextService } = await loadService();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source({ enabled: false })]),
    mcpClient: { query: async () => { called = true; return { status: 'ok' }; } },
  });
  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  // With no enabled source, the service degrades to a fixed_reply rather than skipping
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'not_configured');
  assert.equal(called, false);
});

test('resolve: sourceHint does not match any source → degraded fixed_reply', async () => {
  const { BusinessSystemContextService } = await loadService();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source({ kind: 'qms' })]),
    mcpClient: { query: async () => { called = true; return { status: 'ok' }; } },
  });
  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  // sourceHint is plm, but only qms is configured → no match
  // The service degrades gracefully to a fixed_reply
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'not_configured');
  assert.equal(called, false);
});

test('resolve: explicit trigger but no anchor → fixed_reply missing_query_anchor', async () => {
  const { BusinessSystemContextService } = await loadService();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => { called = true; return { status: 'ok' }; } },
  });
  const result = await service.resolve({ question: '根据 PLM 回答一下这个怎么样' });
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'missing_query_anchor');
  assert.equal(called, false);
});

test('resolve: with anchor and ok MCP → context candidate', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async (_s, _c, input) => {
        return { status: 'ok', sourceName: 'PLM', summary: `found ${input.query}` };
      },
    },
  });
  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(result.kind, 'context');
  assert.equal(result.candidate.source, 'business_system');
  assert.equal(result.candidate.sourceId, 'plm-default');
});

test('resolve: with anchor and unavailable MCP → fixed_reply unavailable', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async () => ({ status: 'unavailable', sourceName: 'PLM' }),
    },
  });
  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'unavailable');
});

test('resolve: with anchor and no_result MCP → fixed_reply no_result', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => ({ status: 'no_result', sourceName: 'PLM' }) },
  });
  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'no_result');
});

test('resolve: with anchor and auth_failed MCP → fixed_reply auth_failed', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => ({ status: 'auth_failed', sourceName: 'PLM' }) },
  });
  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'auth_failed');
});

test('resolve: missing credentialsManager throws (current behavior — caller must inject one)', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({});
  // The current implementation accesses credentialsManager without a guard;
  // callers must always inject one. We pin the existing behavior here.
  await assert.rejects(
    () => service.resolve({ question: '查一下 PLM 物料 a12345' }),
    /getBusinessSystemKnowledgeSources/,
  );
});

test('businessSystemDegradedReasonForStatus maps every documented status', async () => {
  const { businessSystemDegradedReasonForStatus } = await loadService();
  const cases = [
    ['missing_query_anchor', 'business_system_missing_query_anchor'],
    ['unsupported_operation', 'business_system_unsupported_operation'],
    ['auth_failed', 'business_system_auth_failed'],
    ['timeout', 'business_system_timeout'],
    ['no_result', 'business_system_no_result'],
    ['ambiguous', 'business_system_ambiguous'],
    ['not_configured', 'business_system_not_configured'],
    ['unavailable', 'business_system_unavailable'],
    ['error', 'business_system_error'],
  ];
  for (const [status, expected] of cases) {
    assert.equal(businessSystemDegradedReasonForStatus(status), expected,
      `expected ${status} → ${expected}`);
  }
  // unknown status returns undefined
  assert.equal(businessSystemDegradedReasonForStatus('totally_unknown'), undefined);
});

test('toBusinessSystemFixedReply: not_configured returns Chinese fixed message', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  const reply = toBusinessSystemFixedReply({ status: 'not_configured' });
  assert.equal(reply.kind, 'fixed_reply');
  assert.equal(reply.status, 'not_configured');
  assert.match(reply.answer, /当前没有配置/);
});

test('toBusinessSystemFixedReply: missing_query_anchor includes source name when provided', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  const reply = toBusinessSystemFixedReply({ status: 'missing_query_anchor', sourceName: 'PLM' });
  assert.equal(reply.kind, 'fixed_reply');
  assert.equal(reply.sourceName, 'PLM');
  assert.match(reply.answer, /缺少/);
});

test('toBusinessSystemFixedReply: no_result uses default source name when not provided', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  const reply = toBusinessSystemFixedReply({ status: 'no_result' });
  assert.equal(reply.kind, 'fixed_reply');
  // Default source name fallback
  assert.match(reply.answer, /没有从.+确认到/);
});

test('toBusinessSystemFixedReply: ambiguous uses provided source name', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  const reply = toBusinessSystemFixedReply({ status: 'ambiguous', sourceName: 'Windchill' });
  assert.equal(reply.kind, 'fixed_reply');
  assert.match(reply.answer, /Windchill/);
});
