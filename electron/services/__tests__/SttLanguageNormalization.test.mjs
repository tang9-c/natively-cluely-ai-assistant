import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('main normalizes persisted auto STT language before provider construction', () => {
  const src = read('electron/main.ts');

  assert.match(src, /function normalizeRecognitionLanguageForProvider\(provider: string, languageKey: string\)/);
  assert.match(src, /return languageKey === 'auto' && provider !== 'natively' \? 'english-us' : languageKey;/);
  assert.match(
    src,
    /const sttLanguage = normalizeRecognitionLanguageForProvider\(\s*sttProvider,\s*CredentialsManager\.getInstance\(\)\.getSttLanguage\(\),\s*\);/,
  );
});

test('live language changes reuse the same normalization helper', () => {
  const src = read('electron/main.ts');

  assert.match(src, /const effectiveKey = normalizeRecognitionLanguageForProvider\(sttProvider, key\);/);
  assert.doesNotMatch(
    src,
    /const effectiveKey = \(key === 'auto' && sttProvider !== 'natively'\) \? 'english-us' : key;/,
  );
});
