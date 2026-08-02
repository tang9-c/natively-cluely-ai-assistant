import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('business system settings IPC handlers are registered', () => {
  const source = read('electron/ipcHandlers.ts');

  for (const channel of [
    'business-system:list-sources',
    'business-system:save-source',
    'business-system:delete-source',
    'business-system:test-source',
  ]) {
    assert.match(source, new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`), channel);
  }
});

test('preload exposes business system settings APIs', () => {
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  for (const name of [
    'getBusinessSystemKnowledgeSources',
    'saveBusinessSystemKnowledgeSource',
    'deleteBusinessSystemKnowledgeSource',
    'testBusinessSystemKnowledgeSource',
  ]) {
    assert.match(preload, new RegExp(`${name}:`), name);
    assert.match(rendererTypes, new RegExp(`${name}:`), name);
  }
});

test('business system test-source contract keeps legacy fields and adds user-facing diagnostics', () => {
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  for (const source of [preload, rendererTypes]) {
    assert.match(source, /success:\s*boolean/);
    assert.match(source, /status\?:\s*string/);
    assert.match(source, /sourceName\?:\s*string/);
    assert.match(source, /error\?:\s*string/);
    assert.match(source, /message\?:\s*string/);
    assert.match(source, /detailCode\?:\s*string/);
    assert.match(source, /toolCount\?:\s*number/);
  }
});

test('settings IPC does not return plaintext credentials', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("safeHandle('business-system:list-sources'");
  const end = source.indexOf("safeHandle('business-system:save-source'", start);
  const handler = source.slice(start, end);

  assert.match(handler, /getBusinessSystemKnowledgeSourcesPublic/);
  assert.doesNotMatch(handler, /getBusinessSystemCredentials/);
});

test('settings IPC preserves all supported business system source kinds', () => {
  const source = read('electron/ipcHandlers.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  assert.match(source, /\['plm', 'qms', 'erp', 'mes', 'crm', 'business_system'\]/);
  assert.match(rendererTypes, /'plm' \| 'qms' \| 'erp' \| 'mes' \| 'crm' \| 'business_system'/);
});

test('settings test-source uses Windchill MCP handshake for PLM sources', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("safeHandle('business-system:test-source'");
  const end = source.indexOf("safeHandle('switch-to-custom-provider'", start);
  const handler = source.slice(start, end);
  const plmStart = handler.indexOf("if (source.kind === 'plm')");
  const genericStart = handler.indexOf('const result = await new BusinessMcpClient().query', plmStart);
  const plmBranch = handler.slice(plmStart, genericStart);

  assert.ok(start >= 0, 'business-system:test-source handler should exist');
  assert.match(handler, /source\.kind\s*===\s*['"]plm['"]/);
  assert.match(plmBranch, /McpRpcClient/);
  assert.match(plmBranch, /\.initialize\(/);
  assert.match(plmBranch, /\.listTools\(/);
  assert.doesNotMatch(plmBranch, /query:\s*['"]测试业务系统知识源连接['"]/);
});

test('settings test-source maps connection failures to stable diagnostics', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("safeHandle('business-system:test-source'");
  const end = source.indexOf("safeHandle('switch-to-custom-provider'", start);
  const handler = source.slice(start, end);

  assert.match(handler, /classifyBusinessSystemTestError/);
  assert.match(handler, /detailCode:\s*'invalid_source'/);
  assert.match(handler, /detailCode:\s*'timeout'/);
  assert.match(handler, /detailCode:\s*'auth_failed'/);
  assert.match(handler, /detailCode:\s*'unavailable'/);
  assert.match(handler, /detailCode:\s*toolCount > 0 \? undefined : 'no_tools'/);
  assert.match(handler, /toolCount/);
  assert.match(handler, /message:/);
});
