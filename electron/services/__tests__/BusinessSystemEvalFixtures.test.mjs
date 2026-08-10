import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadModules() {
  const servicePath = path.resolve(root, 'dist-electron/electron/services/business-system/BusinessSystemContextService.js');
  const orchestratorPath = path.resolve(root, 'dist-electron/electron/services/context/RealtimeContextOrchestrator.js');
  return {
    ...(await import(`${pathToFileURL(servicePath).href}?t=${Date.now()}`)),
    ...(await import(`${pathToFileURL(orchestratorPath).href}?t=${Date.now()}`)),
  };
}

const plmSource = {
  id: 'plm-default',
  name: 'PLM 知识源',
  kind: 'plm',
  url: 'https://plm.example.test/mcp',
  authType: 'api_key',
  enabled: true,
  isDefault: true,
};

function credentialsManagerStub() {
  return {
    getBusinessSystemKnowledgeSources: () => [plmSource],
    getBusinessSystemCredentials: () => ({ apiKey: 'secret-key' }),
    getBusinessSystemCredentialRevision: () => 3,
  };
}

test('fixture: meeting PLM request calls the configured PLM source and injects its context', async () => {
  const { BusinessSystemContextService, buildRealtimeContextPlan, formatInjectedContext } = await loadModules();
  const mcpCalls = [];
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub(),
    agentLoop: {
      run: async (input) => {
        mcpCalls.push(input);
        return { status: 'ok', answer: '物料 a12345 当前可用。', traceId: 'trace-fixture', toolCalls: 1 };
      },
    },
  });

  const resolved = await service.resolve({ question: '根据 PLM 查一下物料 a12345 是什么状态' });

  assert.equal(mcpCalls.length, 1);
  assert.equal(mcpCalls[0].source.id, 'plm-default');
  assert.equal(mcpCalls[0].source.kind, 'plm');
  assert.deepEqual(mcpCalls[0].credentials, { apiKey: 'secret-key' });
  assert.equal(mcpCalls[0].credentialRevision, 3);
  assert.equal(mcpCalls[0].question, '根据 PLM 查一下物料 a12345 是什么状态');
  assert.equal(resolved.kind, 'context');
  assert.equal(resolved.candidate.source, 'business_system');
  assert.equal(resolved.candidate.sourceId, 'plm-default');

  const plan = buildRealtimeContextPlan({
    candidates: [resolved.candidate],
    tokenBudget: 500,
    ragReady: true,
    embeddingReady: true,
    screenContextStatus: 'not_available',
  });

  const injectedContext = formatInjectedContext(plan);
  assert.match(injectedContext, /PLM 知识源/);
  assert.match(injectedContext, /物料 a12345 当前可用/);
});

test('fixture: project owner question without PLM wording becomes business system context', async () => {
  const { BusinessSystemContextService } = await loadModules();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub(),
    agentLoop: {
      run: async () => ({ status: 'ok', answer: 'B55 项目当前进度为设计验证，负责人是李四。', traceId: 'trace-owner', toolCalls: 1 }),
    },
  });

  const resolved = await service.resolve({ question: '查一下 B55 项目进度怎么样，是谁负责' });

  assert.equal(resolved.kind, 'context');
  assert.match(resolved.candidate.text, /负责人是李四/);
});

test('fixture: vague explicit request asks for more business anchor', async () => {
  const { BusinessSystemContextService } = await loadModules();
  let called = false;
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub(),
    agentLoop: {
      run: async () => { called = true; return { status: 'ok', answer: 'bad', traceId: 'trace-bad', toolCalls: 0 }; },
    },
  });

  const resolved = await service.resolve({ question: '根据 PLM 回答一下这个怎么样' });

  assert.equal(resolved.kind, 'fixed_reply');
  assert.equal(resolved.status, 'missing_query_anchor');
  assert.equal(called, false);
});

test('fixture: auth failure uses fixed reply', async () => {
  const { BusinessSystemContextService } = await loadModules();
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub(),
    agentLoop: {
      run: async () => ({ status: 'error', errorCode: 'mcp_auth_failed', traceId: 'trace-auth', toolCalls: 0 }),
    },
  });

  const auth = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(auth.kind, 'fixed_reply');
  assert.match(auth.answer, /认证失败或不可用/);
});

test('fixture: fixed business system statuses never become context candidates', async () => {
  const { BusinessSystemContextService } = await loadModules();
  const cases = [
    ['mcp_auth_failed', 'auth_failed', /认证失败/],
    ['mcp_timeout', 'timeout', /查询超时/],
    ['mcp_unavailable', 'unavailable', /当前不可用/],
    ['mcp_tool_calling_unsupported', 'unavailable', /当前不可用/],
    ['mcp_protocol_error', 'error', /查询PLM 知识源时失败/],
    ['mcp_tool_catalog_unsupported', 'error', /查询PLM 知识源时失败/],
  ];

  for (const [errorCode, status, answerPattern] of cases) {
    const service = new BusinessSystemContextService({
      credentialsManager: credentialsManagerStub(),
      agentLoop: {
        run: async () => ({ status: 'error', errorCode, traceId: 'trace-error', toolCalls: 0 }),
      },
    });

    const resolved = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
    assert.equal(resolved.kind, 'fixed_reply');
    assert.equal(resolved.status, status);
    assert.match(resolved.answer, answerPattern);
    assert.equal('candidate' in resolved, false);
  }
});

test('fixture: no configured business system source returns fixed reply without context candidate', async () => {
  const { BusinessSystemContextService } = await loadModules();
  const service = new BusinessSystemContextService({
    credentialsManager: {
      getBusinessSystemKnowledgeSources: () => [],
      getBusinessSystemCredentials: () => undefined,
      getBusinessSystemCredentialRevision: () => 0,
    },
    agentLoop: {
      run: async () => {
        throw new Error('should not call MCP without a source');
      },
    },
  });

  const resolved = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(resolved.kind, 'fixed_reply');
  assert.equal(resolved.status, 'not_configured');
  assert.match(resolved.answer, /没有配置可用的业务系统知识源/);
  assert.equal('candidate' in resolved, false);
});
