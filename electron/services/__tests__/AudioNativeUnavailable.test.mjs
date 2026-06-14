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

test('SystemAudioCapture emits coded error when native class is unavailable', () => {
  const src = read('electron/audio/SystemAudioCapture.ts');
  assert.match(src, /NATIVE_AUDIO_MODULE_UNAVAILABLE/);
  assert.match(src, /this\.emit\('error', err\)/);
  assert.doesNotMatch(src, /Cannot start: Rust module missing'\);\s*return;/);
});

test('MicrophoneCapture fails construction and start with coded native-unavailable error', () => {
  const src = read('electron/audio/MicrophoneCapture.ts');
  assert.match(src, /NATIVE_AUDIO_MODULE_UNAVAILABLE/);
  assert.match(src, /throw err/);
  assert.match(src, /this\.emit\('error', err\)/);
});

test('main treats native module unavailable as terminal UI-visible capture failure', () => {
  const src = read('electron/main.ts');
  assert.match(src, /isNativeAudioModuleUnavailable/);
  assert.match(src, /code: 'NATIVE_AUDIO_MODULE_UNAVAILABLE'/);
  assert.match(src, /terminal: true/);
  assert.match(src, /Native audio module is unavailable/);
});
