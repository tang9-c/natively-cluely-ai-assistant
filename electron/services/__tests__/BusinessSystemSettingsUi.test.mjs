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

test('business system settings component uses product language and not MCP management language', () => {
  const source = read('src/components/settings/BusinessSystemKnowledgeSourcesSettings.tsx');

  assert.match(source, /业务系统知识源/);
  assert.match(source, /Windchill 知识源/);
  assert.doesNotMatch(source, /PLM 知识源/);
  assert.match(source, /QMS 知识源/);
  assert.match(source, /账号密码/);
  assert.match(source, /API Key/);
  assert.doesNotMatch(source, /MCP/i);
  assert.doesNotMatch(source, /tool picker/i);
  assert.doesNotMatch(source, /tool/i);
  assert.doesNotMatch(source, /stdio/i);
});

test('research settings mounts business system settings', () => {
  const source = read('src/components/settings/ResearchTabBody.tsx');

  assert.match(source, /BusinessSystemKnowledgeSourcesSettings/);
});

test('knowledge source settings also mounts material library settings', () => {
  const source = read('src/components/settings/ResearchTabBody.tsx');

  assert.match(source, /KnowledgeMaterialsSettings/);
});

test('settings sidebar exposes one knowledge source entry instead of separate research and material library entries', () => {
  const source = read('src/components/SettingsOverlay.tsx');
  const sidebarStart = source.indexOf('<nav className="space-y-1">');
  const sidebarEnd = source.indexOf('</nav>', sidebarStart);
  const sidebar = source.slice(sidebarStart, sidebarEnd);

  assert.match(sidebar, /> 知识源/);
  assert.doesNotMatch(sidebar, /> 资料库/);
  assert.doesNotMatch(sidebar, /> 调研/);
});

test('knowledge source sidebar and tab header use the same dedicated icon', () => {
  const settingsSource = read('src/components/SettingsOverlay.tsx');
  const tabSource = read('src/components/settings/ResearchTabBody.tsx');
  const sidebarStart = settingsSource.indexOf('<nav className="space-y-1">');
  const sidebarEnd = settingsSource.indexOf('</nav>', sidebarStart);
  const sidebar = settingsSource.slice(sidebarStart, sidebarEnd);
  const headerStart = tabSource.indexOf('<h3 className="text-lg font-bold text-text-primary mb-1 flex items-center gap-2">');
  const headerEnd = tabSource.indexOf('</h3>', headerStart);
  const header = tabSource.slice(headerStart, headerEnd);

  assert.match(sidebar, /<LibraryBig size=\{16\} \/> 知识源/);
  assert.match(header, /<LibraryBig size=\{18\} className="text-accent-primary" \/>/);
  assert.doesNotMatch(sidebar, /<Search size=\{16\} \/> 知识源/);
  assert.doesNotMatch(header, /<FlaskConical size=\{18\}/);
});

test('research settings keeps Tavily cache controls together before business system settings', () => {
  const source = read('src/components/settings/ResearchTabBody.tsx');

  const networkCardIndex = source.indexOf('data-testid="network-research-card"');
  const tavilyIndex = source.indexOf('Tavily API Key');
  const cacheIndex = source.indexOf('清除所有缓存');
  const materialsIndex = source.indexOf('<KnowledgeMaterialsSettings />');
  const businessSystemIndex = source.indexOf('<BusinessSystemKnowledgeSourcesSettings />');

  assert.ok(networkCardIndex >= 0, 'network research card should exist');
  assert.ok(tavilyIndex >= 0, 'Tavily API Key card should exist');
  assert.ok(cacheIndex >= 0, 'Tavily cache card should exist');
  assert.ok(materialsIndex >= 0, 'material library settings should exist');
  assert.ok(businessSystemIndex >= 0, 'business system settings should exist');
  assert.ok(networkCardIndex < tavilyIndex, 'network research card should contain Tavily settings');
  assert.ok(tavilyIndex < cacheIndex, 'Tavily key settings should appear before cache controls');
  assert.ok(cacheIndex < materialsIndex, 'material library settings should appear after Tavily cache controls');
  assert.ok(materialsIndex < businessSystemIndex, 'business system settings should appear after material library settings');
});

test('network research card avoids duplicate Tavily API key labels', () => {
  const source = read('src/components/settings/ResearchTabBody.tsx');
  const networkCardStart = source.indexOf('data-testid="network-research-card"');
  const networkCardEnd = source.indexOf('<KnowledgeMaterialsSettings />', networkCardStart);
  const networkCard = source.slice(networkCardStart, networkCardEnd);

  assert.match(networkCard, /Tavily API Key/);
  assert.doesNotMatch(networkCard, />\s*API 密钥\s*</);
});

test('business system settings uses the same top-level card shell as research settings', () => {
  const source = read('src/components/settings/BusinessSystemKnowledgeSourcesSettings.tsx');

  assert.match(source, /data-testid="business-system-knowledge-source-card"/);
  assert.match(source, /bg-bg-card rounded-xl border border-border-subtle p-4/);
  assert.doesNotMatch(source, /<div className="space-y-5">\s*<div>\s*<h3/);
});

test('business system settings mirrors Tavily-style save and test feedback', () => {
  const source = read('src/components/settings/BusinessSystemKnowledgeSourcesSettings.tsx');

  assert.match(source, /isSaving/);
  assert.match(source, /isTesting/);
  assert.match(source, /testResult/);
  assert.match(source, /saveStatus/);
  assert.match(source, /保存中…/);
  assert.match(source, /测试中…/);
  assert.match(source, /已保存，建议测试连接/);
  assert.match(source, /连接成功：/);
  assert.match(source, /认证失败，请检查 API Key 或账号密码。/);
  assert.match(source, /连接超时，请检查服务地址和网络。/);
  assert.match(source, /服务可达，但没有返回可用查询能力。/);
  assert.match(source, /尚未添加业务系统知识源。添加 Windchill 知识源后，可在会议中按需查询只读业务信息。/);
});

test('business system settings exposes supported PLM QMS ERP MES CRM source kinds', () => {
  const source = read('src/components/settings/BusinessSystemKnowledgeSourcesSettings.tsx');

  for (const kind of ['plm', 'qms', 'erp', 'mes', 'crm', 'business_system']) {
    assert.match(source, new RegExp(`<option value="${kind}">`), kind);
  }
  assert.match(source, /连接 PLM、QMS、ERP、MES、CRM 或其它受控业务系统。/);
});

test('business system settings disables save and test until required fields are present', () => {
  const source = read('src/components/settings/BusinessSystemKnowledgeSourcesSettings.tsx');

  assert.match(source, /const canSubmit = Boolean/);
  assert.match(source, /credentialIsPresent/);
  assert.match(source, /disabled=\{isSaving \|\| !canSubmit\}/);
  assert.match(source, /disabled=\{isTesting \|\| !canSubmit\}/);
});

test('AI provider settings does not mount business system settings', () => {
  const source = read('src/components/settings/AIProvidersSettings.tsx');

  assert.doesNotMatch(source, /BusinessSystemKnowledgeSourcesSettings/);
});
