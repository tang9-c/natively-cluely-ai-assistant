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
  assert.match(source, /setDefaultModel\?\.\('natively'\)/);
  forbidden.forEach(text => assert.equal(source.includes(text), false, `unexpected legacy text: ${text}`));
  assert.doesNotMatch(source, /setSttProvider\?\.\('natively'\)/);
});

test('saving QCLOUD key only auto-selects the LLM provider', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('    public setNativelyApiKey(key: string): void');
  const end = source.indexOf('    public getPreferredModel', start);
  const method = source.slice(start, end);

  assert.ok(start >= 0, 'setNativelyApiKey should exist');
  assert.match(method, /this\.credentials\.defaultModel = 'natively'/);
  assert.doesNotMatch(method, /this\.credentials\.sttProvider = 'natively'/);
  assert.equal(method.includes(['Auto-set STT provider', 'to natively'].join(' ')), false);
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
