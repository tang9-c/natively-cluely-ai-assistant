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

test('main logs runtime STT diagnostics with effective language and active local-whisper model', () => {
  const src = read('electron/main.ts');

  assert.match(src, /private getSttRuntimeDiagnostics\(/);
  assert.match(src, /resolveSttLanguageCompatibility/);
  assert.match(src, /requestedLanguageKey:/);
  assert.match(src, /effectiveLanguageKey:/);
  assert.match(src, /reasonCode:/);
  assert.match(src, /willHonorSelection:/);
  assert.match(src, /perChannelEnabled:/);
  assert.match(src, /activeModelId:/);
  assert.match(src, /globalModelId:/);
  assert.match(src, /micModelId:/);
  assert.match(src, /systemModelId:/);
});

test('createSTTProvider logs speaker-specific STT diagnostics before provider construction', () => {
  const src = read('electron/main.ts');

  assert.match(src, /this\.logSttRuntimeDiagnostics\('create-stt-provider', speaker\);/);
});

test('setRecognitionLanguage logs requested and effective language diagnostics', () => {
  const src = read('electron/main.ts');

  assert.match(src, /this\.logSttRuntimeDiagnostics\('set-recognition-language', 'user', key\);/);
  assert.match(src, /this\.logSttRuntimeDiagnostics\('set-recognition-language', 'interviewer', key\);/);
});

test('startMeeting logs an STT diagnostics snapshot for both channels', () => {
  const src = read('electron/main.ts');

  assert.match(src, /this\.logSttRuntimeDiagnostics\('meeting-start', 'user'\);/);
  assert.match(src, /this\.logSttRuntimeDiagnostics\('meeting-start', 'interviewer'\);/);
});
