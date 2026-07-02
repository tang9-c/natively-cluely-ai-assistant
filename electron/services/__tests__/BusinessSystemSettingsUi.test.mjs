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
  assert.match(source, /PLM 知识源/);
  assert.match(source, /QMS 知识源/);
  assert.match(source, /账号密码/);
  assert.match(source, /API Key/);
  assert.doesNotMatch(source, /MCP/i);
  assert.doesNotMatch(source, /tool picker/i);
  assert.doesNotMatch(source, /tool/i);
  assert.doesNotMatch(source, /stdio/i);
});

test('AI provider settings mounts business system settings', () => {
  const source = read('src/components/settings/AIProvidersSettings.tsx');

  assert.match(source, /BusinessSystemKnowledgeSourcesSettings/);
});
