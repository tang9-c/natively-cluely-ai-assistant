import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('TranscriptSegment and renderer payload carry speakerVerification metadata', () => {
  const base = read('electron/audio/BaseSTT.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  assert.match(base, /speakerVerification\?: SpeakerVerificationMetadata/);
  assert.match(base, /setSpeakerVerificationAnnotator/);
  assert.match(rendererTypes, /speakerVerification\?: SpeakerVerificationMetadata/);
});

test('main forwards speakerVerification without changing channel speaker semantics', () => {
  const main = read('electron/main.ts');
  assert.match(main, /speakerVerification: segment\.speakerVerification/);
  assert.match(main, /speaker: speaker/);
  assert.doesNotMatch(main, /speaker:\s*segment\.speakerVerification/);
});

test('RestSTT annotates final transcripts using the uploaded 16k PCM buffer', () => {
  const rest = read('electron/audio/RestSTT.ts');
  assert.match(rest, /emitUploadResult\(transcript, pcm16k\)/);
  assert.match(rest, /speakerVerificationAnnotator/);
  assert.match(rest, /slicePcm16kByTime/);
});

test('LocalSenseVoiceSTT annotates final VAD samples before emitting transcript', () => {
  const sense = read('electron/audio/sensevoice/LocalSenseVoiceSTT.ts');
  assert.match(sense, /pendingAudioByTaskId/);
  assert.match(sense, /speakerVerification: await this\.annotateSpeaker/);
});

test('DatabaseManager persists speaker verification json with transcripts', () => {
  const db = read('electron/db/DatabaseManager.ts');
  assert.match(db, /speaker_verification_json TEXT/);
  assert.match(db, /JSON\.stringify\(segment\.speakerVerification/);
  assert.match(db, /speakerVerification: row\.speaker_verification_json/);
});

test('speaker verification reliability integration coverage remains wired across core, context, and dynamic actions', () => {
  const core = read('electron/services/__tests__/SpeakerVerificationCore.test.mjs');
  const context = read('electron/services/__tests__/SpeakerContextPolicy.test.mjs');
  const dynamicActions = read('electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs');
  const settings = read('src/components/__tests__/SpeakerVerificationSettings.test.mjs');

  assert.match(context, /stable enrollment verifies ME and reaches transcript cleaner as \[ME\]/);
  assert.match(dynamicActions, /speaker verification marked as ME skips dynamic action assessment/);
  assert.match(dynamicActions, /low-confidence ME speaker verification continues dynamic action assessment/);
  assert.match(dynamicActions, /malformed or mismatched speaker verification continues dynamic action assessment/);
  assert.match(core, /mode off must not emit speakerVerification or invoke verification/);
  assert.match(core, /short audio must record one low-quality skip/);
  assert.match(core, /annotator times out hanging verification without blocking metadata fallback/);
  assert.match(core, /speaker_verification_failed/);
  assert.match(context, /force_not_me removes ME label/);
  assert.match(context, /action: 'force_me'/);
  assert.match(settings, /模型健康/);
});
