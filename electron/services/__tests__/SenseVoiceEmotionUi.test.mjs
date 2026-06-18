import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('native audio transcript IPC carries optional SenseVoice emotion metadata', () => {
  const main = read('electron/main.ts');
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  assert.match(main, /emotion:\s*segment\.emotion/);
  assert.match(main, /emotionSource:\s*segment\.emotionSource/);
  assert.match(preload, /emotion\?:\s*TranscriptEmotion/);
  assert.match(preload, /emotionSource\?:\s*'sensevoice'/);
  assert.match(rendererTypes, /emotion\?:\s*TranscriptEmotion/);
  assert.match(rendererTypes, /emotionSource\?:\s*'sensevoice'/);
});

test('launcher and suggestion overlay render transient non-neutral emotion badges', () => {
  const launcher = read('src/components/NativelyInterface.tsx');
  const overlay = read('src/components/SuggestionOverlay.tsx');

  assert.match(launcher, /SENSEVOICE_EMOTION_LABELS/);
  assert.match(launcher, /setDetectedEmotion/);
  assert.match(launcher, /情绪/);
  assert.match(overlay, /SENSEVOICE_EMOTION_LABELS/);
  assert.match(overlay, /currentTranscript\.emotion/);
  assert.match(overlay, /情绪/);
});
