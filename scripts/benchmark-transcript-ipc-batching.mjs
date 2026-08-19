#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiledBatcherPath = path.join(
  repoRoot,
  'dist-electron/electron/services/TranscriptIpcBatcher.js',
);
const sourceBatcherPath = path.join(repoRoot, 'electron/services/TranscriptIpcBatcher.ts');
const batcherModulePath = fs.existsSync(compiledBatcherPath)
  ? compiledBatcherPath
  : sourceBatcherPath;
const { TranscriptIpcBatcher } = await import(pathToFileURL(batcherModulePath).href);

function createVirtualClock() {
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();

  return {
    now: () => now,
    setTimer(callback, delayMs) {
      const id = nextTimerId++;
      timers.set(id, { callback, dueAt: now + delayMs });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advanceTo(targetMs) {
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= targetMs)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.dueAt;
        timer.callback();
      }
      now = targetMs;
    },
  };
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createTranscript(id, random) {
  const final = id % 7 === 0;
  const speaker = id % 2 === 0 ? 'user' : 'interviewer';
  return {
    speaker,
    speakerId: `${speaker}-${id % 3}`,
    speakerLabel: speaker === 'user' ? 'Me' : 'Interviewer',
    text: `synthetic-${id}`,
    timestamp: id * 15,
    final,
    confidence: 0.8 + random() * 0.19,
    coalescedFromCount: id % 5 === 0 ? 2 : 1,
    coalescedProvider: id % 5 === 0 ? 'local_vad' : 'post_stt',
    rawSegmentIds: [`segment-${id}`],
  };
}

export async function runTranscriptIpcBenchmark({ durationMinutes = 30, seed = 42 } = {}) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('durationMinutes must be a positive number');
  }

  const clock = createVirtualClock();
  const random = createRandom(seed);
  const input = [];
  const batches = [];
  const batcher = new TranscriptIpcBatcher({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    sendBatch: batch => batches.push(batch),
  });

  const durationMs = durationMinutes * 60_000;
  let nextAt = 0;
  let id = 0;
  while (nextAt < durationMs) {
    clock.advanceTo(nextAt);
    const burstSize = id > 0 && id % 40 === 0 ? 8 : 1;
    for (let burstIndex = 0; burstIndex < burstSize; burstIndex += 1) {
      const transcript = createTranscript(id, random);
      input.push(transcript);
      batcher.enqueue(transcript);
      id += 1;
    }
    nextAt += 15;
  }
  clock.advanceTo(durationMs + 50);
  batcher.flush('meeting_stop');

  const output = batches.flatMap(batch => batch.items);
  const diagnostics = batcher.getDiagnosticsSnapshot();
  const inputFinalIds = new Set(input.filter(item => item.final).map(item => item.rawSegmentIds[0]));
  const outputFinalIds = new Set(output.filter(item => item.final).map(item => item.rawSegmentIds[0]));
  let orderMismatchCount = Math.abs(input.length - output.length);
  const comparableCount = Math.min(input.length, output.length);
  for (let index = 0; index < comparableCount; index += 1) {
    if (JSON.stringify(input[index]) !== JSON.stringify(output[index])) {
      orderMismatchCount += 1;
    }
  }

  let finalLossCount = 0;
  for (const finalId of inputFinalIds) {
    if (!outputFinalIds.has(finalId)) finalLossCount += 1;
  }

  return {
    itemCount: input.length,
    batchCount: batches.length,
    messageReductionRatio: input.length > 0 ? 1 - batches.length / input.length : 0,
    waitP95Ms: diagnostics.waitP95Ms,
    maxPendingCount: diagnostics.maxPendingCount,
    finalLossCount,
    orderMismatchCount,
  };
}

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const invokedAsScript = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) {
  const durationMinutes = Number(readOption('duration-minutes') ?? 30);
  const outputPath = readOption('json');
  runTranscriptIpcBenchmark({ durationMinutes, seed: 42 })
    .then(result => {
      const json = `${JSON.stringify(result, null, 2)}\n`;
      if (outputPath) {
        const resolvedPath = path.resolve(outputPath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, json);
      }
      process.stdout.write(json);
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
