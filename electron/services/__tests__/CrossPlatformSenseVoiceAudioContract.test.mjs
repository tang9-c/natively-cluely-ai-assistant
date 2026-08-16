import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('native DSP emits the shared 16kHz mono framing contract', () => {
  const config = read('native-module/src/audio_config.rs');
  assert.match(config, /SAMPLE_RATE:\s*u32\s*=\s*16_000/);
  assert.match(config, /FRAME_MS:\s*u32\s*=\s*20/);
  assert.match(config, /FRAME_SAMPLES:\s*usize\s*=\s*320/);
  assert.match(config, /CHUNK_BATCH_COUNT:\s*usize\s*=\s*3/);
});

test('SenseVoice inference and VAD consume the same platform-independent 16kHz contract', () => {
  const worker = read('electron/audio/sensevoice/senseVoiceWorker.ts');
  const senseVoice = read('electron/audio/sensevoice/LocalSenseVoiceSTT.ts');
  const vad = read('electron/audio/whisper/vadProcessor.ts');
  const resolveVadOptions = senseVoice.match(
    /private resolveVadOptions\(\): VadProcessorOptions \{([\s\S]*?)\n  \}\n\n  private spawnWorker/,
  )?.[1] ?? '';

  assert.match(worker, /sampleRate:\s*16000/);
  assert.match(worker, /acceptWaveform\(\{ samples, sampleRate:\s*16000 \}\)/);
  assert.match(vad, /WINDOW_SIZE\s*=\s*480/);
  assert.match(vad, /DEFAULT_RMS_THRESHOLD\s*=\s*0\.008/);
  assert.match(resolveVadOptions, /rmsThreshold:\s*0\.004/);
  assert.match(resolveVadOptions, /hangoverFrames:\s*30/);
  assert.match(resolveVadOptions, /minSpeechFrames:\s*4/);
  assert.doesNotMatch(resolveVadOptions, /process\.platform/);
});

test('native system-audio gate keeps the established CoreAudio and generic profiles', () => {
  const suppression = read('native-module/src/silence_suppression.rs');
  const nativeLib = read('native-module/src/lib.rs');

  assert.match(suppression, /for_system_audio\(\)[\s\S]*?speech_threshold_rms:\s*30\.0[\s\S]*?speech_hangover:\s*Duration::from_millis\(600\)[\s\S]*?adaptive_multiplier:\s*3\.0[\s\S]*?adaptive_min_floor:\s*10\.0[\s\S]*?use_vad:\s*false/);
  assert.match(suppression, /for_coreaudio_system_audio\(\)[\s\S]*?speech_threshold_rms:\s*5\.0[\s\S]*?speech_hangover:\s*Duration::from_millis\(800\)[\s\S]*?adaptive_multiplier:\s*1\.5[\s\S]*?adaptive_min_floor:\s*1\.0[\s\S]*?use_vad:\s*false/);
  assert.match(nativeLib, /stream\.backend_name\(\)\s*==\s*"coreaudio"[\s\S]*?for_coreaudio_system_audio\(\)[\s\S]*?for_system_audio\(\)/);
});

test('resampler fallback declares the actual native rate instead of a false 16kHz rate', () => {
  const nativeLib = read('native-module/src/lib.rs');
  const fallbackContract = /let emitted_rate = if resampler\.is_some\(\) \{\s*CANONICAL_STT_RATE\s*\} else \{\s*native_rate\s*\}/g;

  assert.equal(nativeLib.match(fallbackContract)?.length, 2);
});
