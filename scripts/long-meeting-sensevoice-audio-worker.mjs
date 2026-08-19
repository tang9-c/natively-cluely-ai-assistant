#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function optionsFromEnvironment() {
  return {
    audioPath: process.env.CUEUP_BENCHMARK_AUDIO,
    modelPath: process.env.CUEUP_BENCHMARK_MODEL,
    tokensPath: process.env.CUEUP_BENCHMARK_TOKENS,
    durationMs: Number(process.env.CUEUP_BENCHMARK_DURATION_MS),
    sampleIntervalMs: Number(process.env.CUEUP_BENCHMARK_SAMPLE_INTERVAL_MS),
  };
}

async function hashPrefix(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex').slice(0, 12);
}

function convertToPcm(inputPath, outputPath) {
  const result = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
    '-ar', '16000', '-ac', '1', '-f', 's16le', outputPath,
  ], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('audio_conversion_failed');
}

async function replayPcm(pcmPath, durationMs, onChunk) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    const stream = fs.createReadStream(pcmPath, { highWaterMark: 32_000 });
    for await (const chunk of stream) {
      if (Date.now() - startedAt >= durationMs) {
        stream.destroy();
        break;
      }
      onChunk(chunk);
      await delay(chunk.length / 32_000 * 1_000);
    }
  }
}

async function main() {
  const options = optionsFromEnvironment();
  if (!options.audioPath || !options.modelPath || !options.tokensPath) {
    throw new Error('missing_source_configuration');
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new Error('invalid_duration');
  }
  const pcmPath = path.join(os.tmpdir(), `cueup-sensevoice-${process.pid}-${Date.now()}.pcm`);
  let sampler;
  let stt;
  let finalCount = 0;
  let partialCount = 0;
  try {
    convertToPcm(options.audioPath, pcmPath);
    const sttModulePath = path.join(ROOT, 'dist-electron/electron/audio/sensevoice/LocalSenseVoiceSTT.js');
    const poolModulePath = path.join(ROOT, 'dist-electron/electron/audio/LocalSttWorkerPool.js');
    const [{ LocalSenseVoiceSTT }, { localSttWorkerPool }] = await Promise.all([
      import(pathToFileURL(sttModulePath).href),
      import(pathToFileURL(poolModulePath).href),
    ]);
    stt = new LocalSenseVoiceSTT({
      modelFiles: {
        modelDir: path.dirname(options.modelPath),
        modelFile: options.modelPath,
        tokensFile: options.tokensPath,
      },
    });
    stt.setSampleRate(16_000);
    stt.setAudioChannelCount(1);
    stt.setRecognitionLanguage('chinese');
    stt.setChannel('system');
    stt.on('transcript', (segment) => {
      if (segment?.final ?? segment?.isFinal) finalCount += 1;
      else partialCount += 1;
    });
    stt.on('error', () => process.send?.({ type: 'error', code: 'sensevoice_inference_failed' }));
    stt.start();

    const sendSample = () => process.send?.({
      type: 'sample',
      at: Date.now(),
      finalCount,
      partialCount,
      stt: stt.getRuntimeStats(),
      workerPool: localSttWorkerPool.getRuntimeStats(),
      memory: process.memoryUsage(),
    });
    sampler = setInterval(sendSample, Math.max(100, options.sampleIntervalMs || 5_000));
    process.send?.({ type: 'ready', audioHashPrefix: await hashPrefix(options.audioPath) });
    await replayPcm(pcmPath, options.durationMs, (chunk) => stt.write(chunk));
    stt.notifySpeechEnded();
    stt.finalize();
    await stt.drainFinals(60_000);
    clearInterval(sampler);
    sampler = undefined;
    stt.stop();
    await delay(100);
    sendSample();
    process.send?.({ type: 'done' });
  } finally {
    if (sampler) clearInterval(sampler);
    stt?.stop();
    await fsPromises.rm(pcmPath, { force: true });
  }
}

main().catch((error) => {
  process.send?.({ type: 'error', code: error?.message || 'sensevoice_worker_failed' });
  process.exitCode = 1;
});
