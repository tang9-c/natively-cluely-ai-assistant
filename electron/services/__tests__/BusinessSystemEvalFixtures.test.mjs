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
  };
}

test('fixture: meeting PLM request calls the configured PLM source and injects its context', async () => {
  const { BusinessSystemContextService, buildRealtimeContextPlan, formatInjectedContext } = await loadModules();
  const mcpCalls = [];
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub(),
    mcpClient: {
      query: async (source, credentials, input) => {
        mcpCalls.push({ source, credentials, input });
        return { status: 'ok', sourceName: 'PLM 知识源', summary: '物料 a12345 当前可用。' };
      },
    },
  });

  const resolved = await service.resolve({ question: '根据 PLM 查一下物料 a12345 是什么状态' });

  assert.equal(mcpCalls.length, 1);
  assert.equal(mcpCalls[0].source.id, 'plm-default');
  assert.equal(mcpCalls[0].source.kind, 'plm');
  assert.deepEqual(mcpCalls[0].credentials, { apiKey: 'secret-key' });
  assert.equal(mcpCalls[0].input.sourceHint, 'plm');
  assert.equal(mcpCalls[0].input.query, '根据 PLM 查一下物料 a12345 是什么状态');
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
    mcpClient: {
      query: async () => ({ status: 'ok', sourceName: 'PLM 知识源', summary: 'B55 项目当前进度为设计验证，负责人是李四。' }),
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
    mcpClient: {
      query: async () => { called = true; return { status: 'ok', sourceName: 'PLM 知识源', summary: 'bad' }; },
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
    mcpClient: {
      query: async () => ({ status: 'auth_failed', sourceName: 'PLM 知识源' }),
    },
  });

  const auth = await service.resolve({ question: '根据 PLM 查一下物料 a12345' });
  assert.equal(auth.kind, 'fixed_reply');
  assert.match(auth.answer, /认证失败或不可用/);
});
