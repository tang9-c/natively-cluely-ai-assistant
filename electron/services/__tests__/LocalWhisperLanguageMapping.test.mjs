import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../audio/LocalWhisperSTT.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

test('LocalWhisperSTT maps internal language keys to BCP-47 before sending to worker', () => {
  const setLangStart = source.indexOf('setRecognitionLanguage(key: string): void');
  assert.ok(setLangStart >= 0, 'setRecognitionLanguage should exist');

  // Capture the method body (stop at the next method declaration).
  const nextMethodStart = source.indexOf('    setCredentials', setLangStart);
  const setLangSource = source.slice(setLangStart, nextMethodStart);

  // It must consult the canonical RECOGNITION_LANGUAGES config to translate
  // internal keys like 'chinese' into BCP-47 codes like 'zh-CN'. Passing the
  // raw internal key to the worker causes whisperWorker.ts LANG_MAP to miss
  // (which is keyed by BCP-47), so Whisper falls back to auto-detect and
  // often outputs English for Chinese speech.
  assert.match(setLangSource, /RECOGNITION_LANGUAGES\[key\]/);
  assert.match(setLangSource, /\.bcp47/);
});

test('LocalWhisperSTT preserves auto language sentinel', () => {
  const setLangStart = source.indexOf('setRecognitionLanguage(key: string): void');
  const nextMethodStart = source.indexOf('    setCredentials', setLangStart);
  const setLangSource = source.slice(setLangStart, nextMethodStart);

  assert.match(setLangSource, /['"]auto['"]/);
});
