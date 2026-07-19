import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const senseVoiceSource = fs.readFileSync(
  path.resolve(__dirname, '../../audio/sensevoice/LocalSenseVoiceSTT.ts'),
  'utf8',
);
const whisperSource = fs.readFileSync(
  path.resolve(__dirname, '../../audio/LocalWhisperSTT.ts'),
  'utf8',
);

test('local SenseVoice uses less aggressive segmentation defaults', () => {
  assert.match(senseVoiceSource, /GAP_FLUSH_MS\s*=\s*1800/);
  assert.match(senseVoiceSource, /SPEECH_ENDED_FLUSH_DEBOUNCE_MS\s*=\s*800/);
  assert.match(senseVoiceSource, /hangoverFrames:\s*30/);
  assert.match(senseVoiceSource, /minSpeechFrames:\s*4/);
});

test('local Whisper uses less aggressive segmentation defaults', () => {
  assert.match(whisperSource, /GAP_FLUSH_MS\s*=\s*1000/);
  assert.match(whisperSource, /hangoverFrames:\s*30/);
  assert.match(whisperSource, /minSpeechFrames:\s*4/);
});
