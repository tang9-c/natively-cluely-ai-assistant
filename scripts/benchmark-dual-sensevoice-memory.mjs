#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function calculateMemoryReduction(baseline, current) {
  const baselineDelta = baseline.baselineLoaded - baseline.baselineStart;
  const currentDelta = current.currentLoaded - current.currentStart;
  if (baselineDelta <= 0) throw new Error('Baseline loaded-runtime delta must be positive');
  return {
    baselineDelta,
    currentDelta,
    reductionRatio: (baselineDelta - currentDelta) / baselineDelta,
  };
}

export async function benchmarkDualSenseVoiceMemory(options) {
  const moduleRoot = path.resolve(options.moduleRoot);
  const modulePath = path.join(moduleRoot, 'electron/audio/sensevoice/LocalSenseVoiceSTT.js');
  for (const requiredPath of [modulePath, options.model, options.tokens]) {
    if (!fs.existsSync(requiredPath)) throw new Error(`Missing benchmark input: ${requiredPath}`);
  }

  global.gc?.();
  const startRssBytes = process.memoryUsage().rss;
  const { LocalSenseVoiceSTT } = require(modulePath);
  const modelFiles = {
    modelDir: path.dirname(options.model),
    modelFile: path.resolve(options.model),
    tokensFile: path.resolve(options.tokens),
  };
  const instances = ['mic', 'system'].map(channel => {
    const stt = new LocalSenseVoiceSTT({ modelFiles, numThreads: 4 });
    stt.setSampleRate(16000);
    stt.setAudioChannelCount(1);
    stt.setRecognitionLanguage('chinese');
    stt.setChannel(channel);
    stt.on('error', error => {
      console.error(`[dual-sensevoice-memory] ${channel} error: ${error.message}`);
    });
    return stt;
  });

  const samples = [];
  const sampler = setInterval(() => samples.push(process.memoryUsage().rss), 25);
  try {
    instances.forEach(instance => instance.start());
    await new Promise(resolve => setTimeout(resolve, options.warmupMs));
    global.gc?.();
    samples.push(process.memoryUsage().rss);
  } finally {
    clearInterval(sampler);
    instances.forEach(instance => instance.stop());
    await new Promise(resolve => setTimeout(resolve, 750));
  }

  if (samples.length === 0) throw new Error('No RSS samples collected');
  const steadySamples = samples.slice(Math.max(0, samples.length - 40));
  return {
    moduleRoot,
    warmupMs: options.warmupMs,
    startRssBytes,
    loadedRssBytes: median(steadySamples),
    peakRssBytes: Math.max(...samples),
    sampleCount: samples.length,
  };
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) {
  const moduleRoot = readOption('module-root');
  const model = readOption('model');
  const tokens = readOption('tokens');
  const warmupMs = Number(readOption('warmup-ms') ?? 8_000);
  if (!moduleRoot || !model || !tokens || !Number.isFinite(warmupMs) || warmupMs < 1_000) {
    console.error('Usage: node --expose-gc scripts/benchmark-dual-sensevoice-memory.mjs --module-root <dist-electron> --model <onnx> --tokens <txt> [--warmup-ms 8000]');
    process.exit(2);
  }
  benchmarkDualSenseVoiceMemory({ moduleRoot, model, tokens, warmupMs })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
