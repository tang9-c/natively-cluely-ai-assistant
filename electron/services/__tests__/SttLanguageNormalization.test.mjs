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
  assert.match(src, /if \(languageKey !== 'auto'\) return languageKey;/);
  assert.match(src, /return provider !== 'natively' \? 'english-us' : languageKey;/);
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

test('explicit Chinese selections are not normalized away from Chinese in main.ts', () => {
  const src = read('electron/main.ts');

  assert.doesNotMatch(src, /languageKey === ['"]chinese['"][\s\S]{0,120}english-us/);
  assert.doesNotMatch(src, /key === ['"]chinese['"][\s\S]{0,120}english-us/);
});

test('settings overlay wires a dedicated STT language compatibility warning', () => {
  const ui = read('src/components/SettingsOverlay.tsx');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ui, /getSttLanguageCompatibility/);
  assert.match(ui, /willHonorSelection/);
  assert.match(ui, /这次中文识别不会按所选语言执行|当前语音提供商不会按中文执行/);
  assert.match(preload, /getSttLanguageCompatibility:/);
  assert.match(types, /getSttLanguageCompatibility: \(\) => Promise<\{/);
  assert.match(types, /reasonCode: 'AUTO_NORMALIZED_TO_ENGLISH' \| 'MODEL_ENGLISH_ONLY' \| 'PROVIDER_LANGUAGE_UNSUPPORTED' \| 'SUPPORTED'/);
});
