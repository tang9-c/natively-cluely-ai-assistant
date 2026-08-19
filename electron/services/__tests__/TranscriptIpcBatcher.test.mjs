import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { TranscriptIpcBatcher } from '../../../dist-electron/electron/services/TranscriptIpcBatcher.js';

const root = path.resolve(import.meta.dirname, '../../..');

test('TranscriptIpcBatcher module exists at the UI delivery boundary', () => {
  assert.equal(
    fs.existsSync(path.join(root, 'electron/services/TranscriptIpcBatcher.ts')),
    true,
  );
});

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
    pendingTimerCount: () => timers.size,
  };
}

function segment(text, final, speaker = 'user') {
  return {
    speaker,
    speakerId: `${speaker}-1`,
    speakerLabel: speaker === 'user' ? 'Me' : 'Customer',
    providerSpeakerId: 'provider-1',
    diarizationProvider: 'doubao-auc',
    text,
    timestamp: 123,
    final,
    confidence: 0.92,
    startTimestampMs: 100,
    endTimestampMs: 200,
    emotion: 'neutral',
    emotionSource: 'sensevoice',
    emotionDegree: 'LOW',
    emotionScore: 0.4,
    emotionDegreeScore: 0.2,
    speakerVerification: {
      provider: 'local-speaker-verification',
      profileId: 'me',
      isMe: speaker === 'user',
      confidence: 0.88,
      threshold: 0.7,
    },
    coalescedFromCount: 2,
    coalescedProvider: 'post_stt',
    rawSegmentIds: ['raw-a', 'raw-b'],
  };
}

function createHarness() {
  const clock = createClock();
  const batches = [];
  const firstWindow = [];
  const secondWindow = [];
  const batcher = new TranscriptIpcBatcher({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    sendBatch: (batch, reason) => {
      batches.push({ ...batch, reason });
      firstWindow.push(batch);
      secondWindow.push(batch);
    },
  });
  return { batcher, batches, clock, firstWindow, secondWindow };
}

test('flushes in insertion order after 50 ms', () => {
  const harness = createHarness();
  harness.batcher.enqueue(segment('partial A', false));
  harness.batcher.enqueue(segment('partial B', false));
  harness.clock.advance(49);
  assert.equal(harness.batches.length, 0);
  harness.clock.advance(1);
  assert.deepEqual(harness.batches[0].items.map(item => item.text), ['partial A', 'partial B']);
  assert.equal(harness.batches[0].reason, 'timer');
});

test('flushes synchronously at 16 items and never exceeds the bound', () => {
  const harness = createHarness();
  for (let index = 0; index < 16; index += 1) {
    harness.batcher.enqueue(segment(String(index), index === 15, index % 2 ? 'user' : 'interviewer'));
  }
  assert.equal(harness.batches.length, 1);
  assert.equal(harness.batches[0].items.length, 16);
  assert.equal(harness.batches[0].reason, 'max_size');
  assert.equal(harness.batcher.getPendingCount(), 0);
  assert.equal(harness.clock.pendingTimerCount(), 0);
});

test('preserves partial/final, metadata, and cross-speaker order', () => {
  const harness = createHarness();
  const input = [
    segment('partial A', false, 'user'),
    segment('partial B', false, 'interviewer'),
    segment('final C', true, 'user'),
    segment('partial D', false, 'interviewer'),
    segment('final E', true, 'interviewer'),
  ];
  input.forEach(item => harness.batcher.enqueue(item));
  harness.batcher.flush('meeting_stop');
  assert.deepEqual(harness.batches[0].items, input);
  assert.deepEqual(harness.firstWindow, harness.secondWindow);
});

test('flushes trailing finals and dispose clears its timer', () => {
  const harness = createHarness();
  harness.batcher.enqueue(segment('last final', true));
  harness.batcher.dispose();
  assert.equal(harness.batches[0].items[0].text, 'last final');
  assert.equal(harness.batches[0].reason, 'dispose');
  assert.equal(harness.clock.pendingTimerCount(), 0);
});

test('reports content-free diagnostics and resets them explicitly', () => {
  const harness = createHarness();
  harness.batcher.enqueue(segment('private transcript text', false));
  harness.clock.advance(50);
  const snapshot = harness.batcher.getDiagnosticsSnapshot();
  assert.deepEqual(snapshot, {
    itemCount: 1,
    batchCount: 1,
    partialCount: 1,
    finalCount: 0,
    droppedCount: 0,
    sentBytes: snapshot.sentBytes,
    maxPendingCount: 1,
    averageBatchSize: 1,
    waitP50Ms: 50,
    waitP95Ms: 50,
  });
  assert.ok(snapshot.sentBytes > 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /private transcript text/);
  assert.deepEqual(harness.batcher.snapshotAndResetDiagnostics(), snapshot);
  assert.equal(harness.batcher.getDiagnosticsSnapshot().itemCount, 0);
});
