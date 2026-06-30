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

test('QCLOUD settings asks before replacing an existing manual default model', () => {
  const source = read('src/components/settings/NativelyApiSettings.tsx');

  assert.match(source, /getDefaultModel/);
  assert.match(source, /confirm\(/);
  assert.match(source, /let selectAsDefault = true/);
  assert.match(source, /setNativelyApiKey\(apiKey\.trim\(\),\s*\{\s*selectAsDefault/);
});

test('QCLOUD key changes broadcast explicit key state without exposing the key', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("  safeHandle('set-natively-api-key'");
  const end = source.indexOf('  });', start);
  const handler = source.slice(start, end);

  assert.ok(start >= 0, 'set-natively-api-key handler should exist');
  assert.match(handler, /broadcast\('qcloud-key-changed',\s*\{\s*hasKey:/);
  assert.doesNotMatch(handler, /broadcast\('qcloud-key-changed',\s*apiKey/);
});

test('legacy Natively STT is migrated to the local provider', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('    public getSttProvider()');
  const end = source.indexOf('    public getDeepgramApiKey()', start);
  const method = source.slice(start, end);

  assert.ok(start >= 0, 'getSttProvider should exist');
  assert.match(method, /provider === 'natively'/);
  assert.match(method, /this\.credentials\.sttProvider = 'local-sensevoice'/);
  assert.equal(method.includes('none' + '→' + 'natively'), false);
});

test('startup no longer mounts the Natively quota banner', () => {
  const source = read('src/App.tsx');

  assert.equal(source.includes('Natively' + 'QuotaBanner'), false);
});
