import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vadPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/whisper/vadProcessor.js');
const normalizerPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/audioLevelNormalizer.js');
const systemPreprocessingPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/SystemAudioPreprocessing.js');

async function loadVadProcessor() {
  return import(pathToFileURL(vadPath).href);
}

async function loadAudioLevelNormalizer() {
  return import(pathToFileURL(normalizerPath).href);
}

async function loadSystemAudioPreprocessing() {
  return import(pathToFileURL(systemPreprocessingPath).href);
}

function tone(rms, durationMs = 420, sampleRate = 16000) {
  const sampleCount = Math.floor(sampleRate * durationMs / 1000);
  const amplitude = rms * Math.SQRT2;
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * 440 * i / sampleRate);
  }
  return samples;
}

test('VadProcessor accepts a lower RMS threshold for quiet system audio speech', async () => {
  const { VadProcessor } = await loadVadProcessor();
  const quietRemoteSpeech = tone(0.005);
  const trailingSilence = new Float32Array(16000 * 0.8);

  const defaultVad = new VadProcessor();
  assert.equal(
    defaultVad.push(quietRemoteSpeech).concat(defaultVad.push(trailingSilence)).length,
    0,
    'default mic-oriented threshold should not treat this low-level signal as speech',
  );

  const systemVad = new VadProcessor({
    rmsThreshold: 0.004,
    hangoverFrames: 18,
    minSpeechFrames: 3,
  });
  const segments = systemVad.push(quietRemoteSpeech).concat(systemVad.push(trailingSilence));

  assert.equal(segments.length, 1, 'system VAD should retain quiet remote meeting speech');
  assert.ok(segments[0].durationMs >= 400, 'segment should preserve the spoken phrase');
});

test('normalizePcm16Chunk raises quiet system audio toward target RMS without clipping', async () => {
  const { normalizePcm16Chunk, measurePcm16Level } = await loadAudioLevelNormalizer();
  const input = Buffer.alloc(960 * 2);
  for (let i = 0; i < 960; i++) {
    const sample = Math.round(180 * Math.sin(2 * Math.PI * i / 48));
    input.writeInt16LE(sample, i * 2);
  }

  const before = measurePcm16Level(input);
  const output = normalizePcm16Chunk(input, { targetRms: 0.015, maxGain: 4, silenceRms: 0.0005 });
  const after = measurePcm16Level(output.chunk);

  assert.ok(before.rms > 0 && before.rms < 0.006, 'fixture should represent quiet non-silent audio');
  assert.ok(output.gain > 1, 'quiet audio should be amplified');
  assert.ok(output.gain <= 4, 'gain must respect maxGain');
  assert.ok(after.rms > before.rms, 'normalized audio should have higher RMS');
  assert.ok(after.peak <= 1, 'normalized audio must stay within int16 range');
});

test('current system-audio preprocessing preserves existing normalization parameters', async () => {
  const { normalizePcm16Chunk } = await loadAudioLevelNormalizer();
  const { preprocessCurrentChineseSystemAudio } = await loadSystemAudioPreprocessing();
  const input = Buffer.alloc(960 * 2);
  for (let i = 0; i < 960; i++) {
    const sample = Math.round(180 * Math.sin(2 * Math.PI * i / 48));
    input.writeInt16LE(sample, i * 2);
  }

  const direct = normalizePcm16Chunk(input, { targetRms: 0.015, maxGain: 4, silenceRms: 0.0005 });
  const helper = preprocessCurrentChineseSystemAudio(input);
  assert.deepEqual(helper.chunk, direct.chunk);
  assert.equal(helper.gain, direct.gain);
});
