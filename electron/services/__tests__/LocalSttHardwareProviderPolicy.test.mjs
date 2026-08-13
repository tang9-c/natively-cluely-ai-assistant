import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const policyPath = path.join(root, 'dist-electron/electron/audio/hardwareProviderPolicy.js');

test('Apple Silicon Whisper keeps CoreML with one CPU fallback', () => {
  const { resolveLocalSttProvider } = require(policyPath);
  assert.deepEqual(resolveLocalSttProvider('darwin', 'arm64', 'whisper'), {
    requestedProviders: ['coreml'],
    fallbackProvider: 'cpu',
    cacheConfig: { enabled: false },
    diagnosticLabel: 'whisper-coreml',
    benchmarkRequired: false,
  });
});

test('Windows Whisper uses the Transformers.js DirectML provider id with CPU fallback', () => {
  const { resolveLocalSttProvider } = require(policyPath);
  assert.deepEqual(resolveLocalSttProvider('win32', 'x64', 'whisper'), {
    requestedProviders: ['dml'],
    fallbackProvider: 'cpu',
    cacheConfig: { enabled: false },
    diagnosticLabel: 'whisper-directml',
    benchmarkRequired: false,
  });
});

test('SenseVoice hardware candidates require an approved platform benchmark', () => {
  const { resolveLocalSttProvider } = require(policyPath);
  assert.deepEqual(resolveLocalSttProvider('darwin', 'arm64', 'sensevoice'), {
    requestedProviders: ['cpu'],
    fallbackProvider: null,
    cacheConfig: { enabled: false },
    diagnosticLabel: 'sensevoice-cpu-benchmark-required',
    benchmarkRequired: true,
  });
  assert.deepEqual(resolveLocalSttProvider('darwin', 'arm64', 'sensevoice', { benchmarkApproved: true }), {
    requestedProviders: ['coreml'],
    fallbackProvider: 'cpu',
    cacheConfig: { enabled: false },
    diagnosticLabel: 'sensevoice-coreml-benchmark-approved',
    benchmarkRequired: true,
  });
});

test('Intel Mac and unknown platforms stay on CPU', () => {
  const { resolveLocalSttProvider } = require(policyPath);
  for (const [platform, arch] of [['darwin', 'x64'], ['linux', 'x64'], ['freebsd', 'arm64']]) {
    const plan = resolveLocalSttProvider(platform, arch, 'sensevoice', { benchmarkApproved: true });
    assert.deepEqual(plan.requestedProviders, ['cpu']);
    assert.equal(plan.fallbackProvider, null);
  }
});

test('Windows DirectML is only requested when the packaged runtime and benchmark are approved', () => {
  const { resolveLocalSttProvider } = require(policyPath);
  assert.deepEqual(
    resolveLocalSttProvider('win32', 'x64', 'sensevoice', { benchmarkApproved: true }).requestedProviders,
    ['cpu'],
  );
  assert.deepEqual(
    resolveLocalSttProvider('win32', 'x64', 'sensevoice', {
      benchmarkApproved: true,
      runtimeSupportsCandidate: true,
    }).requestedProviders,
    ['directml'],
  );
});

test('benchmark approval requires >=20% median RTF gain, stable runs, and no quality loss', () => {
  const { evaluateLocalSttHardwareBenchmark } = require(policyPath);
  assert.equal(evaluateLocalSttHardwareBenchmark({
    cpuRuns: [{ rtf: 0.5 }, { rtf: 0.52 }, { rtf: 0.48 }],
    candidateRuns: [{ rtf: 0.35 }, { rtf: 0.39 }, { rtf: 0.38 }],
    cpuQuality: { characterErrorRate: 0.1, keywordRecall: 0.9 },
    candidateQuality: { characterErrorRate: 0.1, keywordRecall: 0.9 },
  }).approved, true);
  assert.equal(evaluateLocalSttHardwareBenchmark({
    cpuRuns: [{ rtf: 0.01 }, { rtf: 0.012 }, { rtf: 0.009 }],
    candidateRuns: [{ rtf: 0.016 }, { rtf: 0.0124 }, { rtf: 0.0168 }],
    cpuQuality: { characterErrorRate: 0.1, keywordRecall: 0.9 },
    candidateQuality: { characterErrorRate: 0.1, keywordRecall: 0.9 },
  }).approved, false);
});

test('SenseVoice worker uses the tested one-shot fallback helper and reports diagnostics', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(root, 'electron/audio/sensevoice/senseVoiceWorker.ts'), 'utf8');
  assert.match(source, /initializeLocalSttProvider/);
  assert.match(source, /fallbackProvider/);
  assert.match(source, /providerActual/);
  assert.match(source, /fallbackReason/);
});

test('provider initialization falls back once and never treats an unverified candidate as actual', () => {
  const { initializeLocalSttProvider } = require(policyPath);
  const successfulCalls = [];
  const unverified = initializeLocalSttProvider({
    requestedProviders: ['coreml'],
    fallbackProvider: 'cpu',
    create: provider => successfulCalls.push(provider) && { provider },
  });
  assert.deepEqual(successfulCalls, ['coreml']);
  assert.equal(unverified.providerActual, 'unknown');
  assert.equal(unverified.fallbackReason, 'actual_provider_unverified');

  const fallbackCalls = [];
  const fallback = initializeLocalSttProvider({
    requestedProviders: ['coreml'],
    fallbackProvider: 'cpu',
    create: provider => {
      fallbackCalls.push(provider);
      if (provider === 'coreml') throw new Error('candidate failed');
      return { provider };
    },
  });
  assert.deepEqual(fallbackCalls, ['coreml', 'cpu']);
  assert.equal(fallback.providerActual, 'cpu');
  assert.equal(fallback.fallbackReason, 'candidate_initialization_failed');
  assert.equal(fallback.value.provider, 'cpu');

  const failedCalls = [];
  assert.throws(() => initializeLocalSttProvider({
    requestedProviders: ['coreml'],
    fallbackProvider: 'cpu',
    create: provider => {
      failedCalls.push(provider);
      throw new Error('failed');
    },
  }), /Local STT provider unavailable|failed/);
  assert.deepEqual(failedCalls, ['coreml', 'cpu']);
});

test('Windows isolates SenseVoice from the Embedding ONNX Runtime process', () => {
  const fs = require('node:fs');
  const pool = fs.readFileSync(path.join(root, 'electron/audio/LocalSttWorkerPool.ts'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'electron/audio/sensevoice/senseVoiceWorker.ts'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(pool, /config\.provider === 'sensevoice'/);
  assert.match(pool, /process\.platform === 'win32'/);
  assert.match(pool, /fork\(config\.workerPath/);
  assert.match(pool, /ELECTRON_RUN_AS_NODE:\s*'1'/);
  assert.match(worker, /process\.on\('message'/);
  assert.match(worker, /process\.send/);
  assert.doesNotMatch(main, /preloadWindowsSenseVoiceRuntime/);
});
