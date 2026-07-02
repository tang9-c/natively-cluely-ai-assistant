import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Local SenseVoice term settings are exposed through SettingsManager and types', () => {
  const settings = read('electron/services/SettingsManager.ts');
  const types = read('electron/audio/sensevoice/types.ts');

  assert.match(types, /export interface SenseVoiceTermEntry/);
  assert.match(settings, /localSenseVoiceTerms\?: SenseVoiceTermEntry\[\]/);
  assert.match(settings, /localSenseVoiceCorrectionEnabled\?: boolean/);
  assert.match(settings, /getLocalSenseVoiceTermCorrectionConfig/);
  assert.match(settings, /sanitizeSenseVoiceTerms/);
});

test('Local SenseVoice term APIs are registered and exposed to renderer', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  for (const channel of [
    'local-sensevoice-get-terms',
    'local-sensevoice-set-terms',
  ]) {
    assert.match(ipc, new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`), channel);
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\s*['"]${channel}['"]`), channel);
  }

  for (const api of [
    'localSenseVoiceGetTerms',
    'localSenseVoiceSetTerms',
  ]) {
    assert.match(preload, new RegExp(`${api}:`), api);
    assert.match(rendererTypes, new RegExp(`${api}:`), api);
  }

  assert.doesNotMatch(preload, /localSenseVoiceSuggestTerms/);
  assert.doesNotMatch(rendererTypes, /localSenseVoiceSuggestTerms/);
});

test('Local SenseVoice term settings do not expose VAD or homophone controls', () => {
  const settings = read('electron/services/SettingsManager.ts');
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  for (const source of [settings, preload, rendererTypes]) {
    assert.doesNotMatch(source, /localSenseVoiceVadProfile/);
    assert.doesNotMatch(source, /localSenseVoiceHomophone/);
    assert.doesNotMatch(source, /homophoneReplacerEnabled/);
  }
});
