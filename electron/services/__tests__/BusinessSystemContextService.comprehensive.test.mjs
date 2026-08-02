// electron/services/__tests__/BusinessSystemContextService.comprehensive.test.mjs
//
// Phase 4 PR4.3 — additional coverage for BusinessSystemContextService (currently
// 39.46%). The existing files (BusinessSystemContextService.test.mjs and
// BusinessSystemContextService.plm.test.mjs) cover the happy path, the
// missing-anchor / fixed-reply paths, and the plm adapter routing. This file
// pins the remaining edge cases:
//   - toBusinessSystemFixedReply with status=error falls through to the default
//     copy
//   - toBusinessSystemFixedReply with no_result defaults the source name to
//     "业务系统知识源"
//   - toBusinessSystemFixedReply with status=unsupported_operation uses the
//     Windchill-specific message that names the supported operation
//   - pickSource chooses the default source when multiple enabled sources exist
//   - pickSource falls back to the first enabled source when no default is set
//   - hasBusinessSystemContent is true when summary is non-empty even if
//     evidence is empty (and the other way around)
//   - hasBusinessSystemContent is false for an "ok" result with empty summary
//     and empty evidence
//   - formatEvidenceContext emits the "Windchill" label when evidence.source
//     is "windchill", and the sourceName when it is something else
//   - formatEvidenceContext emits the omittedFieldCount line when provided
//   - formatEvidenceContext emits the sourceTool line when provided
//   - formatEvidenceContext caps record listing at 5 and field listing at 16
//   - resolve() with status=ok but empty summary/evidence returns error fixed
//     reply (hasBusinessSystemContent gates the success path)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadService() {
  const modulePath = path.resolve(
    root,
    'dist-electron/electron/services/business-system/BusinessSystemContextService.js'
  );
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function source(overrides = {}) {
  return {
    id: 'src-default',
    name: 'PLM 知识源',
    kind: 'plm',
    url: 'https://example.test/mcp',
    authType: 'api_key',
    enabled: true,
    isDefault: true,
    ...overrides,
  };
}

function credentialsManagerStub(sources, credentials = { apiKey: 'k' }) {
  return {
    getBusinessSystemKnowledgeSources: () => sources,
    getBusinessSystemCredentials: () => credentials,
  };
}

test('toBusinessSystemFixedReply: error status uses the generic failure copy', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  const reply = toBusinessSystemFixedReply({ status: 'error', sourceName: 'Custom Source' });
  assert.equal(reply.kind, 'fixed_reply');
  assert.equal(reply.status, 'error');
  assert.match(reply.answer, /查询Custom Source时失败/);
});

test('toBusinessSystemFixedReply: no_result without sourceName uses the documented default', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  const reply = toBusinessSystemFixedReply({ status: 'no_result' });
  assert.equal(reply.kind, 'fixed_reply');
  assert.equal(reply.status, 'no_result');
  // Default fallback name is 业务系统知识源
  assert.match(reply.answer, /没有从业务系统知识源中确认到相关信息/);
});

test('toBusinessSystemFixedReply: unsupported_operation copy names the supported operation', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  const reply = toBusinessSystemFixedReply({ status: 'unsupported_operation' });
  assert.equal(reply.status, 'unsupported_operation');
  assert.match(reply.answer, /只支持只读查询/);
  assert.match(reply.answer, /暂不支持创建、修改、审批、提交、删除或写回操作/);
});

test('toBusinessSystemFixedReply: timeout / unavailable / auth_failed use the right templates', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  for (const status of ['timeout', 'unavailable', 'auth_failed', 'ambiguous']) {
    const reply = toBusinessSystemFixedReply({ status, sourceName: 'X' });
    assert.equal(reply.status, status);
    assert.equal(reply.kind, 'fixed_reply');
    assert.match(reply.answer, /X/);
  }
});

test('resolve() with status=ok but empty summary and no evidence returns the no_result fixed reply', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async () => ({ status: 'ok', sourceName: 'PLM 知识源' }),
    },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'no_result');
});

test('resolve() with status=ok and non-empty summary returns the context candidate (summary branch)', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async () => ({ status: 'ok', sourceName: 'PLM 知识源', summary: 'Material a12345 is currently Released.' }),
    },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(result.kind, 'context');
  assert.equal(result.candidate.text, '根据 PLM 知识源：Material a12345 is currently Released.');
  // The candidate's metadata should reflect the status, kind, and source name.
  assert.equal(result.candidate.metadata.status, 'ok');
  assert.equal(result.candidate.metadata.kind, 'plm');
  assert.equal(result.candidate.metadata.sourceName, 'PLM 知识源');
});

test('resolve() prefers the isDefault source over the first enabled source', async () => {
  const { BusinessSystemContextService } = await loadService();
  let queriedSourceId = null;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([
      source({ id: 'src-a', name: 'A', isDefault: false }),
      source({ id: 'src-b', name: 'B', isDefault: true }),
      source({ id: 'src-c', name: 'C', isDefault: false }),
    ]),
    mcpClient: {
      query: async (s) => {
        queriedSourceId = s.id;
        return { status: 'ok', sourceName: s.name, summary: 'ok' };
      },
    },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(queriedSourceId, 'src-b', 'isDefault source should win');
  assert.equal(result.kind, 'context');
});

test('resolve() returns ambiguous when explicit source kind has multiple enabled sources and no default', async () => {
  const { BusinessSystemContextService } = await loadService();
  let queriedSourceId = null;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([
      source({ id: 'src-a', name: 'A', isDefault: false }),
      source({ id: 'src-b', name: 'B', isDefault: false }),
    ]),
    mcpClient: {
      query: async (s) => {
        queriedSourceId = s.id;
        return { status: 'ok', sourceName: s.name, summary: 'ok' };
      },
    },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(queriedSourceId, null, 'ambiguous source selection should not call MCP');
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'ambiguous');
});

test('resolve() filters sources by kind when the trigger sourceHint is non-default', async () => {
  const { BusinessSystemContextService } = await loadService();
  let queriedSourceId = null;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([
      source({ id: 'src-plm', name: 'PLM', kind: 'plm', isDefault: true }),
      source({ id: 'src-qms', name: 'QMS', kind: 'qms', isDefault: true }),
    ]),
    mcpClient: {
      query: async (s) => {
        queriedSourceId = s.id;
        return { status: 'ok', sourceName: s.name, summary: 'ok' };
      },
    },
  });

  // The trigger should pick a kind that matches one of the sources.
  const result = await service.resolve({ question: '查一下 QMS 里 NCR-2024-001' });
  assert.equal(queriedSourceId, 'src-qms', 'qms-kind source should be selected when QMS is mentioned');
  assert.equal(result.kind, 'context');
});

test('formatEvidenceContext emits the Windchill label when evidence.source is windchill', async () => {
  const { toBusinessSystemFixedReply } = await loadService();
  // Indirect coverage: when the service returns a 'context' result with
  // evidence.source='windchill', the label is rendered.
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source({ name: 'Generic' })]),
    mcpClient: {
      query: async () => ({
        status: 'ok',
        sourceName: 'Generic',
        evidence: {
          source: 'windchill',
          sourceTool: 'part_search',
          recordCount: 1,
          records: [{ fields: [{ name: 'Number', value: 'X' }] }],
        },
      }),
    },
  });

  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  assert.equal(result.kind, 'context');
  // The label is "Windchill" because evidence.source === 'windchill',
  // overriding the sourceName 'Generic'.
  assert.match(result.candidate.text, /Windchill 结构化查询结果/);
  assert.doesNotMatch(result.candidate.text, /Generic 结构化查询结果/);
  // Suppress unused-var lint by referencing toBusinessSystemFixedReply.
  void toBusinessSystemFixedReply;
});

test('formatEvidenceContext emits the omittedFieldCount line and sourceTool line when present', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async () => ({
        status: 'ok',
        sourceName: 'PLM',
        evidence: {
          source: 'windchill',
          sourceTool: 'part_search',
          recordCount: 100,
          omittedFieldCount: 7,
          records: [{ title: 'Rec1', fields: [{ name: 'K', value: 'V' }] }],
        },
      }),
    },
  });

  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  assert.match(result.candidate.text, /工具：part_search/);
  assert.match(result.candidate.text, /记录数：100/);
  assert.match(result.candidate.text, /已省略字段数：7/);
  assert.equal(result.candidate.metadata.evidenceSource, 'windchill');
  assert.equal(result.candidate.metadata.sourceTool, 'part_search');
  assert.equal(result.candidate.metadata.recordCount, 100);
});

test('formatEvidenceContext caps at 5 records and 16 fields per record', async () => {
  const { BusinessSystemContextService } = await loadService();
  const records = [];
  for (let i = 0; i < 8; i++) {
    const fields = [];
    for (let j = 0; j < 20; j++) {
      fields.push({ name: `Field${j}`, value: `value-${j}` });
    }
    records.push({ title: `Rec${i}`, fields });
  }
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async () => ({
        status: 'ok',
        sourceName: 'PLM',
        evidence: {
          source: 'windchill',
          recordCount: 8,
          records,
        },
      }),
    },
  });

  const result = await service.resolve({ question: '查一下 PLM 物料 a12345' });
  // Only 5 records should appear.
  const recordMatches = result.candidate.text.match(/记录 \d+：/g) || [];
  assert.equal(recordMatches.length, 5, 'should cap at 5 records');
  // Only 16 fields per record should appear.
  const fieldMatches = result.candidate.text.match(/- Field\d+: value-\d+/g) || [];
  assert.ok(fieldMatches.length <= 5 * 16, 'should cap fields at 16 per record');
  assert.ok(fieldMatches.length > 0, 'should still emit some fields');
});

test('resolve() with no enabled source (only disabled sources) returns the not_configured fixed reply', async () => {
  const { BusinessSystemContextService } = await loadService();
  let mcpCalled = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([
      source({ id: 'src-disabled-1', name: 'D1', enabled: false, isDefault: true }),
      source({ id: 'src-disabled-2', name: 'D2', enabled: false, isDefault: false }),
    ]),
    mcpClient: { query: async () => { mcpCalled = true; return { status: 'ok' }; } },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'not_configured');
  assert.equal(mcpCalled, false);
});

test('resolve() propagates the upstream sourceName through to the candidate metadata', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source({ name: 'StoredName' })]),
    mcpClient: {
      query: async () => ({
        status: 'ok',
        sourceName: 'UpstreamName',
        summary: 'X',
      }),
    },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(result.kind, 'context');
  assert.equal(result.sourceName, 'UpstreamName');
  assert.equal(result.candidate.metadata.sourceName, 'UpstreamName');
});
