import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('QCLOUD settings page does not show legacy commercial content', () => {
  const source = read('src/components/settings/NativelyApiSettings.tsx');
  const forbidden = [
    ['Choose', 'a Plan'].join(' '),
    ['Refund', 'Policy'].join(' '),
    'refund' + 'policy',
    ['Dodo', 'Payments'].join(' '),
    ['Subscribe', 'to get one'].join(' '),
    ['Watch', 'Demo'].join(' '),
    'get' + 'NativelyUsage',
  ];

  assert.match(source, /QCLOUD API/);
  assert.match(source, /QCLOUD key/);
  assert.doesNotMatch(source, /setDefaultModel\?\.\('natively'\)/);
  forbidden.forEach(text => assert.equal(source.includes(text), false, `unexpected legacy text: ${text}`));
  assert.doesNotMatch(source, /setSttProvider\?\.\('natively'\)/);
});

test('saving QCLOUD key can atomically select the LLM provider in the main process', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('    public setNativelyApiKey(key: string');
  const end = source.indexOf('    public getPreferredModel', start);
  const method = source.slice(start, end);

  assert.ok(start >= 0, 'setNativelyApiKey should exist');
  assert.match(source, /selectAsDefault/);
  assert.match(method, /shouldPromoteQCloudDefault/);
  assert.match(method, /this\.credentials\.defaultModel = 'natively'/);
  assert.doesNotMatch(method, /this\.credentials\.sttProvider = 'natively'/);
  assert.equal(method.includes(['Auto-set STT provider', 'to natively'].join(' ')), false);
});

test('saving QCLOUD key protects manually selected models unless selection is explicit', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('    public setNativelyApiKey(key: string');
  const end = source.indexOf('    public getPreferredModel', start);
  const method = source.slice(start, end);

  assert.ok(start >= 0, 'setNativelyApiKey should exist');
  assert.match(method, /shouldPromoteQCloudDefault/);
  assert.match(source, /options\?\.selectAsDefault === true/);
  assert.doesNotMatch(method, /if \(trimmed\) \{\s*this\.credentials\.defaultModel = 'natively'/);
});

test('chat default model falls back to Doubao instead of Gemini', () => {
  const credentials = read('electron/services/CredentialsManager.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const aiSettings = read('src/components/settings/AIProvidersSettings.tsx');
  const modelUtils = read('src/utils/modelUtils.ts');
  const llmHelper = read('electron/LLMHelper.ts');

  assert.match(credentials, /const DEFAULT_CHAT_MODEL_ID = 'doubao-seed-2-0-lite-260215'/);
  assert.match(credentials, /return this\.credentials\.defaultModel \|\| DEFAULT_CHAT_MODEL_ID/);
  assert.match(credentials, /this\.credentials\.defaultModel = DEFAULT_CHAT_MODEL_ID/);
  assert.match(ipc, /return \{ model: 'doubao-seed-2-0-lite-260215' \}/);
  assert.match(modelUtils, /export const DEFAULT_CHAT_MODEL_ID = 'doubao-seed-2-0-lite-260215'/);
  assert.match(aiSettings, /useState<string>\(DEFAULT_CHAT_MODEL_ID\)/);
  assert.match(llmHelper, /private currentModelId: string = DOUBAO_MODEL/);
  assert.doesNotMatch(credentials, /return this\.credentials\.defaultModel \|\| 'gemini-3\.1-flash-lite-preview'/);
});

test('QCLOUD save prompt treats Doubao default as an automatic default model', () => {
  const source = read('src/components/settings/NativelyApiSettings.tsx');

  assert.match(source, /AUTO_DEFAULT_MODEL_PREFIXES = \[[^\]]*'doubao-'/);
});

test('QCLOUD settings asks before replacing an existing manual default model', () => {
  const source = read('src/components/settings/NativelyApiSettings.tsx');

  assert.match(source, /getDefaultModel/);
  assert.match(source, /confirm\(/);
  assert.match(source, /let selectAsDefault = true/);
  assert.match(source, /setNativelyApiKey\(apiKey\.trim\(\),\s*\{\s*selectAsDefault/);
});

test('QCLOUD settings validates key format before saving', () => {
  const source = read('src/components/settings/NativelyApiSettings.tsx');

  assert.match(source, /isValidQCloudKeyFormat/);
  assert.match(source, /QCLOUD_KEY_PATTERN/);
  assert.match(source, /QCLOUD key 格式不正确/);
  assert.ok(
    source.indexOf('isValidQCloudKeyFormat') < source.indexOf('setNativelyApiKey(apiKey.trim()'),
    'format validation should happen before the save IPC',
  );
});

test('set-natively-api-key validates format and tests connection before persisting', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("  safeHandle('set-natively-api-key'");
  const end = source.indexOf('  });', start);
  const handler = source.slice(start, end);

  assert.ok(start >= 0, 'set-natively-api-key handler should exist');
  assert.match(source, /validateQCloudApiKeyFormat/);
  assert.match(source, /testQCloudApiKeyConnection/);
  assert.match(handler, /validateQCloudApiKeyFormat\(apiKey\)/);
  assert.match(handler, /await testQCloudApiKeyConnection\(apiKey\)/);
  assert.ok(
    handler.indexOf('await testQCloudApiKeyConnection(apiKey)') < handler.indexOf('cm.setNativelyApiKey(apiKey, options)'),
    'connection test must run before persisting the key',
  );
});

test('QCLOUD key changes broadcast explicit key state without exposing the key', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("  safeHandle('set-natively-api-key'");
  const end = source.indexOf('  });', start);
  const handler = source.slice(start, end);

  assert.ok(start >= 0, 'set-natively-api-key handler should exist');
  assert.match(handler, /broadcast\('qcloud-key-changed',\s*\{\s*hasKey:/);
  assert.match(handler, /broadcast\('credentials-changed'\)/);
  assert.doesNotMatch(handler, /broadcast\('qcloud-key-changed',\s*apiKey/);
});

test('legacy natively STT migrates to QCLOUD API speech channel when key exists and local provider when missing', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('    public getSttProvider()');
  const end = source.indexOf('    public getDeepgramApiKey()', start);
  const method = source.slice(start, end);

  assert.ok(start >= 0, 'getSttProvider should exist');
  assert.match(method, /provider === 'natively'/);
  assert.match(method, /getNativelyApiKey\(\)/);
  assert.match(method, /sttProvider = 'qcloud-stt'/);
  assert.match(method, /this\.credentials\.sttProvider = 'local-sensevoice'/);
  assert.doesNotMatch(method, /QCLOUD does not provide default STT/);
});

test('clearing QCLOUD API key moves qcloud-stt away from remote STT', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('    public setNativelyApiKey(');
  const end = source.indexOf('    public getPreferredModel(', start);
  const method = source.slice(start, end);

  assert.ok(start >= 0, 'setNativelyApiKey should exist');
  assert.match(method, /this\.credentials\.sttProvider === 'qcloud-stt'/);
  assert.match(method, /this\.credentials\.sttProvider = 'local-sensevoice'/);
});

test('startup no longer mounts the Natively quota banner', () => {
  const source = read('src/App.tsx');

  assert.equal(source.includes('Natively' + 'QuotaBanner'), false);
});

test('meeting interface displays the internal QCLOUD provider id as QCLOUD API', () => {
  const utils = read('src/utils/modelUtils.ts');
  const interfaceSource = read('src/components/NativelyInterface.tsx');

  assert.match(utils, /natively['"]?\s*[:=]\s*['"]QCLOUD API['"]/);
  assert.match(interfaceSource, /getModelDisplayName/);
  assert.doesNotMatch(interfaceSource, /if \(m === 'natively'\)/);
});
