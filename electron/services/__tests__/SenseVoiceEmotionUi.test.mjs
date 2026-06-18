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
  assert.match(overlay, /displayedEmotion/);
  assert.match(overlay, /情绪/);
});

test('suggestion overlay clears SenseVoice emotion badge independently of transcript bubble', () => {
  const overlay = read('src/components/SuggestionOverlay.tsx');

  assert.match(overlay, /displayedEmotion/);
  assert.match(overlay, /emotionClearTimerRef/);
  assert.match(overlay, /window\.setTimeout\(\(\) => setDisplayedEmotion\(null\), 4000\)/);
  assert.match(overlay, /window\.clearTimeout\(emotionClearTimerRef\.current\)/);
});

test('SenseVoice emotion types and labels come from one shared dictionary', () => {
  const shared = read('shared/senseVoiceEmotion.ts');
  const baseStt = read('electron/audio/BaseSTT.ts');
  const cleaner = read('electron/audio/sensevoice/textCleaner.ts');
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');
  const launcher = read('src/components/NativelyInterface.tsx');
  const overlay = read('src/components/SuggestionOverlay.tsx');

  assert.match(shared, /export const SENSEVOICE_EMOTIONS/);
  assert.match(shared, /export type TranscriptEmotion/);
  assert.match(shared, /export const SENSEVOICE_EMOTION_LABELS/);
  assert.match(shared, /export const SENSEVOICE_EMOTION_TAGS/);

  assert.doesNotMatch(baseStt, /export type TranscriptEmotion = 'happy'/);
  assert.doesNotMatch(cleaner, /export type SenseVoiceEmotion =\s*\n\s*\| 'happy'/);
  assert.doesNotMatch(preload, /type TranscriptEmotion = 'happy'/);
  assert.doesNotMatch(rendererTypes, /export type TranscriptEmotion = 'happy'/);

  assert.doesNotMatch(launcher, /const SENSEVOICE_EMOTION_LABELS: Record/);
  assert.doesNotMatch(overlay, /const SENSEVOICE_EMOTION_LABELS: Record/);
});
