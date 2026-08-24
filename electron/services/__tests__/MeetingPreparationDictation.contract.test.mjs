import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const main = fs.readFileSync('electron/main.ts', 'utf8');
const ipc = fs.readFileSync('electron/ipcHandlers.ts', 'utf8');
const preload = fs.readFileSync('electron/preload.ts', 'utf8');

test('preparation dictation is mic-only and meeting-exclusive', () => {
  const start = main.indexOf('public async startPreparationDictation');
  const stop = main.indexOf('public async stopPreparationDictation', start);
  assert.ok(start > 0 && stop > start);

  const block = main.slice(start, stop);
  assert.match(block, /this\.isMeetingActive/);
  assert.match(block, /this\.microphoneCapture\.start\(\)/);
  assert.match(block, /this\.googleSTT_User\.start\(\)/);
  assert.doesNotMatch(block, /systemAudioCapture\.start/);
  assert.match(main, /meeting-preparation-dictation-transcript/);
});

test('dictation IPC exposes start, stop, cancel and unsubscribe-safe transcript events', () => {
  for (const channel of [
    'meeting-preparation-dictation-start',
    'meeting-preparation-dictation-stop',
    'meeting-preparation-dictation-cancel',
  ]) {
    assert.match(ipc, new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\s*['"]${channel}['"]`));
  }
  assert.match(preload, /removeListener\(['"]meeting-preparation-dictation-transcript['"]/);
});
