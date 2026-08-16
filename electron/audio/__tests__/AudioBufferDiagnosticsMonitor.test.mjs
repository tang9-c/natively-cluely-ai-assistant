import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { AudioBufferDiagnosticsMonitor } = await import(
  '../../../dist-electron/electron/audio/AudioBufferDiagnosticsMonitor.js'
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function collectingLogger() {
  const logs = [];
  const warnings = [];
  return {
    logs,
    warnings,
    logger: {
      log: (...args) => logs.push(args),
      warn: (...args) => warnings.push(args),
    },
  };
}

test('warns once for a newly observed native overflow delta', () => {
  let snapshot = { droppedSamples: 0, dropEvents: 0 };
  const output = collectingLogger();
  const monitor = new AudioBufferDiagnosticsMonitor({
    channel: 'system',
    getNativeDiagnostics: () => snapshot,
    getContext: () => ({ backend: 'wasapi', nativeSampleRate: 48000, emittedSampleRate: 16000 }),
    isVerbose: () => false,
    logger: output.logger,
    intervalMs: 60_000,
  });

  monitor.start();
  snapshot = { droppedSamples: 240, dropEvents: 1 };
  monitor.poll();
  monitor.poll();
  monitor.stop();

  assert.equal(output.warnings.length, 1);
  assert.deepEqual(output.warnings[0][1], {
    channel: 'system',
    backend: 'wasapi',
    droppedSamplesDelta: 240,
    dropEventsDelta: 1,
    droppedSamplesTotal: 240,
  });
});

test('verbose summaries contain bounded counters and reset between sessions', () => {
  const output = collectingLogger();
  const monitor = new AudioBufferDiagnosticsMonitor({
    channel: 'mic',
    getNativeDiagnostics: () => ({ droppedSamples: 0, dropEvents: 0 }),
    getContext: () => ({ backend: 'cpal', nativeSampleRate: 48000, emittedSampleRate: 16000 }),
    isVerbose: () => true,
    logger: output.logger,
    intervalMs: 60_000,
  });

  monitor.start();
  monitor.recordChunk(1920, 1000);
  monitor.recordChunk(1920, 1060);
  monitor.recordChunk(1920, 1120);
  monitor.poll();
  assert.deepEqual(output.logs.at(-1)[1], {
    channel: 'mic',
    backend: 'cpal',
    nativeSampleRate: 48000,
    emittedSampleRate: 16000,
    chunkCount: 3,
    totalBytes: 5760,
    averageIntervalMs: 60,
    maxIntervalMs: 60,
    droppedSamplesTotal: 0,
    dropEventsTotal: 0,
  });

  monitor.stop();
  monitor.start();
  monitor.recordChunk(640, 2000);
  monitor.poll();
  assert.equal(output.logs.at(-1)[1].chunkCount, 1);
  assert.equal(output.logs.at(-1)[1].totalBytes, 640);
  monitor.stop();
});

test('missing or throwing native diagnostics are non-fatal', () => {
  for (const getNativeDiagnostics of [undefined, () => { throw new Error('native unavailable'); }]) {
    const output = collectingLogger();
    const monitor = new AudioBufferDiagnosticsMonitor({
      channel: 'system',
      getNativeDiagnostics,
      getContext: () => ({ backend: 'unknown', nativeSampleRate: 0, emittedSampleRate: 16000 }),
      isVerbose: () => false,
      logger: output.logger,
      intervalMs: 60_000,
    });
    monitor.start();
    assert.doesNotThrow(() => monitor.poll());
    monitor.stop();
    assert.equal(output.warnings.length, 0);
  }
});

test('capture wrappers wire diagnostics to start, data, error, stop, and destroy boundaries', () => {
  for (const relativePath of [
    'electron/audio/MicrophoneCapture.ts',
    'electron/audio/SystemAudioCapture.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /this\.audioDiagnostics\.start\(\)/, relativePath);
    assert.match(source, /this\.audioDiagnostics\.recordChunk\(chunk\.length\)/, relativePath);
    assert.ok(
      source.match(/this\.audioDiagnostics\.stop\(\)/g)?.length >= 3,
      `${relativePath} must stop diagnostics on every terminal path`,
    );
  }
});
