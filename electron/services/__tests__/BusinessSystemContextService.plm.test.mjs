import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
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

// RED: 当 source.kind === 'plm' 时,service 应该通过 plmAdapter 派发请求,
// 而不是直接调 mcpClient.query()。这保证 Windchill 之类的领域型 MCP 走专用通路。
test('BusinessSystemContextService: source.kind === "plm" routes to plmAdapter, not mcpClient', async () => {
  const { BusinessSystemContextService } = await loadService();

  const plmCalls = [];
  const mcpCalls = [];

  const plmAdapter = {
    async query(input, _creds, _timeoutMs) {
      plmCalls.push(input);
      return {
        status: 'ok',
        sourceName: 'Windchill PLM',
        summary: '物料 PRT-001 当前 Released。',
      };
    },
  };
  const mcpClient = {
    async query(source, _creds, input) {
      mcpCalls.push({ source, input });
      return { status: 'unavailable', sourceName: source.name };
    },
  };
  const credentialsManager = {
    getBusinessSystemKnowledgeSources: () => [
      {
        id: 'plm-1',
        name: 'Windchill PLM',
        kind: 'plm',
        url: 'https://example.invalid/mcp',
        authType: 'api_key',
        enabled: true,
        isDefault: true,
      },
    ],
    getBusinessSystemCredentials: () => ({ apiKey: 'k' }),
  };

  const service = new BusinessSystemContextService({
    credentialsManager,
    mcpClient,
    plmAdapter,
  });

  const result = await service.resolve({
    question: '根据PLM查一下物料 PRT-001 的状态',
    recentContext: '',
  });

  assert.equal(plmCalls.length, 1, 'plmAdapter should have been called exactly once');
  assert.match(plmCalls[0].query, /PRT-001/);
  assert.equal(plmCalls[0].sourceHint, 'plm');
  assert.equal(mcpCalls.length, 0, 'mcpClient should NOT have been called for a plm source');

  assert.equal(result.kind, 'context');
  assert.match(result.candidate.text, /PRT-001/);
  assert.equal(result.candidate.metadata.sourceName, 'Windchill PLM');
});

// RED (回归):当 source.kind !== 'plm' 时,service 仍然走原有 mcpClient 路径,
// 不被新增的 plmAdapter 旁路。这保证这次改动不破坏既有 QMS/business_system 行为。
test('BusinessSystemContextService: source.kind !== "plm" still routes through mcpClient', async () => {
  const { BusinessSystemContextService } = await loadService();

  let mcpCalled = 0;
  let plmCalled = 0;

  const service = new BusinessSystemContextService({
    credentialsManager: {
      getBusinessSystemKnowledgeSources: () => [
        {
          id: 'qms-1',
          name: 'QMS',
          kind: 'qms',
          url: 'https://example.invalid/mcp',
          authType: 'api_key',
          enabled: true,
          isDefault: true,
        },
      ],
      getBusinessSystemCredentials: () => ({ apiKey: 'k' }),
    },
    mcpClient: {
      async query(_source, _creds, _input) {
        mcpCalled++;
        return { status: 'ok', sourceName: 'QMS', summary: '记录到 NCR-2024-001。' };
      },
    },
    plmAdapter: {
      async query() {
        plmCalled++;
        return { status: 'no_result', sourceName: 'Windchill PLM' };
      },
    },
  });

  const result = await service.resolve({
    question: '根据QMS里查一下 NCR-2024-001',
    recentContext: '',
  });

  assert.equal(mcpCalled, 1);
  assert.equal(plmCalled, 0);
  assert.equal(result.kind, 'context');
  assert.match(result.candidate.text, /NCR-2024-001/);
});
