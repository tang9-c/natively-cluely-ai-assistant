import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

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

test('skips MCP when question is not explicitly triggered', async () => {
  const { BusinessSystemContextService } = await loadService();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => { called = true; return { status: 'ok', sourceName: 'PLM', summary: 'bad' }; } },
  });

  const result = await service.resolve({ question: '这个项目进度怎么样' });

  assert.equal(result.kind, 'skipped');
  assert.equal(called, false);
});

test('returns fixed missing-anchor message without calling MCP', async () => {
  const { BusinessSystemContextService } = await loadService();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => { called = true; return { status: 'ok', sourceName: 'PLM', summary: 'bad' }; } },
  });

  const result = await service.resolve({ question: '根据 PLM 回答一下这个怎么样' });

  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'missing_query_anchor');
  assert.match(result.answer, /缺少要查询的物料、项目、图纸、需求或问题线索/);
  assert.equal(called, false);
});

test('maps ok MCP result to a business_system context candidate', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async (_source, _credentials, input) => {
        assert.match(input.query, /a12345/);
        return { status: 'ok', sourceName: 'PLM 知识源', summary: '物料 a12345 当前可用。' };
      },
    },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345 是什么状态' });

  assert.equal(result.kind, 'context');
  assert.equal(result.status, 'ok');
  assert.equal(result.candidate.source, 'business_system');
  assert.equal(result.candidate.sourceId, 'plm-default');
  assert.match(result.candidate.text, /根据 PLM 知识源/);
});

test('ERP lookup only routes to ERP source and does not fall back to PLM default', async () => {
  const { BusinessSystemContextService } = await loadService();
  const calls = [];
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([
      source({ id: 'plm-default', name: 'PLM 默认源', kind: 'plm', isDefault: true }),
      source({ id: 'erp-source', name: 'ERP 源', kind: 'erp', isDefault: false }),
    ]),
    mcpClient: {
      query: async (selectedSource, _credentials, input) => {
        calls.push({ selectedSource, input });
        return { status: 'ok', sourceName: selectedSource.name, summary: 'ERP 物料 A123 当前可用。' };
      },
    },
  });

  const result = await service.resolve({ question: '查询 ERP 里物料 A123 的库存状态' });

  assert.equal(result.kind, 'context');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].selectedSource.id, 'erp-source');
  assert.equal(calls[0].input.sourceHint, 'erp');
});

test('business query without system hint is ambiguous when multiple enabled sources have no unique default', async () => {
  const { BusinessSystemContextService } = await loadService();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([
      source({ id: 'plm-source', name: 'PLM 源', kind: 'plm', isDefault: false }),
      source({ id: 'qms-source', name: 'QMS 源', kind: 'qms', isDefault: false }),
    ]),
    mcpClient: {
      query: async () => {
        called = true;
        return { status: 'ok', sourceName: 'bad', summary: 'bad' };
      },
    },
  });

  const result = await service.resolve({ question: '查一下物料 A123 是什么状态' });

  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'ambiguous');
  assert.equal(called, false);
});

test('business system context service exposes deterministic answer for successful structured result', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source({ name: 'PLM 源' })]),
    mcpClient: {
      query: async () => ({
        status: 'ok',
        sourceName: 'PLM 源',
        evidence: {
          source: 'mcp',
          recordCount: 1,
          records: [{
            title: 'golf car BOM',
            fields: [
              { name: '状态', value: '已发布' },
              { name: '版本', value: 'B' },
            ],
          }],
        },
      }),
    },
  });

  const result = await service.resolve({ question: '查一下 PLM 里 golf car 的 BOM 发布了没有' });

  assert.equal(result.kind, 'context');
  assert.match(result.answer, /已从 PLM 源 查询到以下结果/);
  assert.match(result.answer, /记录 1：golf car BOM/);
  assert.match(result.answer, /状态: 已发布/);
  assert.doesNotMatch(result.answer, /建议|推断/);
});

test('status ok without summary or evidence is returned as no_result', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => ({ status: 'ok', sourceName: 'PLM 源' }) },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345 是什么状态' });

  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'no_result');
});

test('maps evidence-only MCP result to an LLM-ready business_system context candidate', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source({ name: 'Windchill 知识源' })]),
    mcpClient: {
      query: async () => ({
        status: 'ok',
        sourceName: 'Windchill 知识源',
        evidence: {
          source: 'windchill',
          sourceTool: 'part_search',
          recordCount: 1,
          records: [{
            title: '0000000001 / 测试部件1',
            fields: [
              { name: 'Number', value: '0000000001' },
              { name: 'Name', value: '测试部件1' },
              { name: 'State', value: 'In Work' },
            ],
          }],
        },
      }),
    },
  });

  const result = await service.resolve({ question: '查一下 Windchill 里 0000000001 这个料的信息' });

  assert.equal(result.kind, 'context');
  assert.match(result.candidate.text, /Windchill 结构化查询结果/);
  assert.match(result.candidate.text, /工具：part_search/);
  assert.match(result.candidate.text, /Number: 0000000001/);
  assert.match(result.candidate.text, /请用中文自然汇报/);
  assert.doesNotMatch(result.candidate.text, /[{}]/);
});

test('maps ambiguous MCP result to a fixed reply', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: { query: async () => ({ status: 'ambiguous', sourceName: 'PLM 知识源', items: [{ id: 1 }, { id: 2 }] }) },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下 B55 项目' });

  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'ambiguous');
  assert.match(result.answer, /返回了多个可能结果/);
});

test('maps explicit business-object lookup without PLM wording to the default source', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async (_source, _credentials, input) => {
        assert.equal(input.sourceHint, 'business_system');
        assert.equal(input.query, '查一下 B55 项目进度怎么样，是谁负责');
        return { status: 'ok', sourceName: 'PLM 知识源', summary: 'B55 项目当前进度为设计验证，负责人是李四。' };
      },
    },
  });

  const result = await service.resolve({ question: '查一下 B55 项目进度怎么样，是谁负责' });

  assert.equal(result.kind, 'context');
  assert.match(result.candidate.text, /负责人是李四/);
});

test('does not leak credentials in service output', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()], { apiKey: 'secret-key', username: 'alice', password: 'secret-pass' }),
    mcpClient: { query: async () => ({ status: 'auth_failed', sourceName: 'PLM 知识源' }) },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /secret-key/);
  assert.doesNotMatch(serialized, /secret-pass/);
  assert.doesNotMatch(serialized, /alice/);
});

test('query result sourceName is optional at the service boundary', () => {
  const source = fs.readFileSync(path.join(root, 'electron/services/business-system/BusinessSystemTypes.ts'), 'utf8');

  assert.match(source, /sourceName\?:\s*string/);
});

test('fixed replies ignore caller-provided answer text and always use status templates', async () => {
  const { toBusinessSystemFixedReply } = await loadService();

  const fixed = toBusinessSystemFixedReply({
    status: 'missing_query_anchor',
    answer: 'caller supplied raw answer should not be returned',
  });

  assert.equal(fixed.kind, 'fixed_reply');
  assert.equal(fixed.status, 'missing_query_anchor');
  assert.match(fixed.answer, /缺少要查询的物料、项目、图纸、需求或问题线索/);
  assert.doesNotMatch(fixed.answer, /caller supplied raw answer/);
});

test('maps every non-ok business system status to fixed reply copy and legal degraded reason', async () => {
  const {
    toBusinessSystemFixedReply,
    businessSystemDegradedReasonForStatus,
  } = await loadService();

  const cases = [
    ['not_configured', /没有配置可用的业务系统知识源/, 'business_system_not_configured'],
    ['missing_query_anchor', /缺少要查询/, 'business_system_missing_query_anchor'],
    ['no_result', /没有从PLM 知识源中确认到相关信息/, 'business_system_no_result'],
    ['ambiguous', /返回了多个可能结果/, 'business_system_ambiguous'],
    ['auth_failed', /认证失败/, 'business_system_auth_failed'],
    ['timeout', /查询超时/, 'business_system_timeout'],
    ['unavailable', /当前不可用/, 'business_system_unavailable'],
    ['unsupported_operation', /当前只支持只读查询，暂不支持创建、修改、审批、提交、删除或写回操作/, 'business_system_unsupported_operation'],
    ['error', /查询PLM 知识源时失败/, 'business_system_error'],
  ];

  for (const [status, answerPattern, reason] of cases) {
    const fixed = toBusinessSystemFixedReply({ status, sourceName: 'PLM 知识源' });
    assert.equal(fixed.kind, 'fixed_reply');
    assert.equal(fixed.status, status);
    assert.match(fixed.answer, answerPattern);
    assert.equal(businessSystemDegradedReasonForStatus(status), reason);
  }
});

test('returns fixed unavailable reply when MCP client throws before returning a status', async () => {
  const { BusinessSystemContextService } = await loadService();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source()]),
    mcpClient: {
      query: async () => {
        throw new Error('raw upstream secret failure body');
      },
    },
  });

  const result = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });

  assert.equal(result.kind, 'fixed_reply');
  assert.equal(result.status, 'unavailable');
  assert.match(result.answer, /当前不可用|无法确认/);
  assert.doesNotMatch(JSON.stringify(result), /raw upstream secret failure body/);
});
