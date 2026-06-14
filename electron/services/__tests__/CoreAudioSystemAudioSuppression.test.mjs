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

test('coreaudio system audio uses a dedicated low-threshold suppression profile', () => {
  const suppressor = read('native-module/src/silence_suppression.rs');
  const nativeLib = read('native-module/src/lib.rs');

  assert.match(suppressor, /pub fn for_coreaudio_system_audio\(\) -> Self/);
  assert.match(suppressor, /speech_threshold_rms:\s*5\.0/);
  assert.match(suppressor, /adaptive_min_floor:\s*1\.0/);
  assert.match(suppressor, /adaptive_multiplier:\s*1\.5/);

  assert.match(nativeLib, /stream\.backend_name\(\)\s*==\s*"coreaudio"/);
  assert.match(nativeLib, /SilenceSuppressionConfig::for_coreaudio_system_audio\(\)/);
});

test('system audio diagnostics distinguish raw capture from emitted STT silence', () => {
  const nativeLib = read('native-module/src/lib.rs');

  assert.match(nativeLib, /struct SystemAudioDiagnostics/);
  assert.match(nativeLib, /rawPeak=/);
  assert.match(nativeLib, /pcmPeak=/);
  assert.match(nativeLib, /sentPeak=/);
  assert.match(nativeLib, /silenceFrames=/);
  assert.match(nativeLib, /suppressedFrames=/);
  assert.match(nativeLib, /diagnostics\.record_raw\(&raw_batch\)/);
  assert.match(nativeLib, /diagnostics\.record_silence\(\)/);
});

test('coreaudio zero-fill is classified as repairable AudioCapture TCC failure', () => {
  const main = read('electron/main.ts');
  const types = read('src/types/electron.d.ts');
  const ui = read('src/components/NativelyInterface.tsx');

  assert.match(main, /CORE_AUDIO_TCC_RESET_REQUIRED/);
  assert.match(main, /backend\s*===\s*['"]coreaudio['"]/);
  assert.match(main, /broadcastCoreAudioTccRepairRequired/);
  assert.match(types, /CORE_AUDIO_TCC_RESET_REQUIRED/);
  assert.match(ui, /repair-and-restart/);
});
