import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availabilityForSource,
  generateTranscriptSchedule,
  mergeSenseVoiceSample,
  parseArgs,
  validateOptions,
} from '../benchmark-long-meeting-memory.mjs';

test('normal mode accepts only supported long-meeting durations', () => {
  for (const durationMinutes of [30, 60, 180]) {
    assert.equal(
      parseArgs(['--duration-minutes', String(durationMinutes)]).durationMinutes,
      durationMinutes,
    );
  }
  assert.throws(() => parseArgs(['--duration-minutes', '15']), /30, 60, or 180/);
});

test('short durations require test mode', () => {
  assert.throws(() => parseArgs(['--duration-minutes', '0.1']), /--test-mode/);
  assert.equal(
    parseArgs(['--duration-minutes', '0.1', '--test-mode']).durationMinutes,
    0.1,
  );
});

test('synthetic generator is deterministic and reports only payload metadata', () => {
  const first = generateTranscriptSchedule({ seed: 42, minutes: 1, transcriptRate: 'normal' });
  const second = generateTranscriptSchedule({ seed: 42, minutes: 1, transcriptRate: 'normal' });
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.ok(first.every((item) => typeof item.payload.text === 'string'));
  assert.ok(first.every((item) => !Object.hasOwn(item, 'text')));
});

test('SenseVoice audio source requires audio, model, and tokens paths', () => {
  assert.throws(
    () => validateOptions({ source: 'sensevoice-audio' }),
    /--audio/,
  );
});

test('file replay marks VAD backlog unavailable', () => {
  const availability = availabilityForSource('sensevoice-audio');
  assert.equal(availability.vadBacklog, 'file_replay_bypasses_capture_vad');
});

test('SenseVoice worker metrics replace app STT counters without exposing text', () => {
  const sample = {
    stt: { workerCount: 0, leaseCount: 0, activeTasks: 0, queuedTasks: 0, pendingAudio: 0, vadBacklog: null },
    processes: [],
  };
  const merged = mergeSenseVoiceSample(sample, {
    finalCount: 3,
    partialCount: 1,
    stt: { pendingAudio: 2, inFlightAudio: 1 },
    workerPool: { workerCount: 1, leaseCount: 1, activeTasks: 1, queuedTasks: 0 },
    memory: { rss: 1234 },
  });
  assert.equal(merged.stt.pendingAudio, 3);
  assert.equal(merged.processes.at(-1).type, 'sensevoice-worker');
  assert.doesNotMatch(JSON.stringify(merged), /transcript|recognizedText/);
});
