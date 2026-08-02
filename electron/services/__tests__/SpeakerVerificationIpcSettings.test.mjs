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

test('speaker verification IPC handlers are exposed with safeHandle', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /safeHandle\('speaker-verification:get-status'/);
  assert.match(ipc, /safeHandle\('speaker-verification:get-health'/);
  assert.match(ipc, /safeHandle\('speaker-verification:get-quality-policy'/);
  assert.match(ipc, /safeHandle\('speaker-verification:enroll'/);
  assert.match(ipc, /safeHandle\('speaker-verification:delete-profile'/);
  assert.match(ipc, /getSpeakerVerificationMode/);
  assert.match(ipc, /setSpeakerVerificationMode/);
});

test('preload and renderer types expose speaker verification APIs', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');
  for (const api of [
    'speakerVerificationGetStatus',
    'speakerVerificationGetHealth',
    'speakerVerificationGetQualityPolicy',
    'speakerVerificationEnroll',
    'speakerVerificationDeleteProfile',
    'getSpeakerVerificationMode',
    'setSpeakerVerificationMode',
  ]) {
    assert.match(preload, new RegExp(api));
    assert.match(types, new RegExp(`${api}:`));
  }
});

test('runtime status composes model health and verification statistics', () => {
  const store = read('electron/services/speaker/SpeakerProfileStore.ts');
  const service = read('electron/services/speaker/SpeakerVerificationService.ts');
  const extractor = read('electron/services/speaker/SpeakerEmbeddingExtractor.ts');
  assert.match(store, /getStatus\(mode: SpeakerVerificationMode = 'off', health\?: SpeakerVerificationHealth\)/);
  assert.match(store, /getVerificationStats/);
  assert.match(service, /recordVerification/);
  assert.match(extractor, /getSpeakerEmbeddingModelHealth/);
});

test('delete profile API calls hard delete rather than disabling a row', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /deleteMeProfile\(\)/);
  assert.doesNotMatch(ipc, /is_active\s*=\s*0/);
});
