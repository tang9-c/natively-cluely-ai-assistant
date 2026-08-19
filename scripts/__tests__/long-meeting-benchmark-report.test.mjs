import assert from 'node:assert/strict';
import test from 'node:test';

import {
  linearSlope,
  renderLongMeetingMarkdown,
  summarizeLongMeetingRun,
} from '../lib/longMeetingBenchmarkReport.mjs';

function sample(elapsedMs, checkpoint, rssBytes, overrides = {}) {
  return {
    elapsedMs,
    phase: checkpoint === 'T2' ? 'post_stop' : 'meeting',
    checkpoint,
    main: { rssBytes, heapUsedBytes: rssBytes / 2 },
    session: { fullSegments: elapsedMs / 1_000, effectiveSegments: elapsedMs / 1_000 },
    stt: { queuedTasks: 0, pendingAudio: 0, vadBacklog: null },
    rag: { pending: 0, processing: 0 },
    ipc: { pending: 0, maxPending: 4 },
    renderer: { transcriptTotalRows: 100, transcriptRenderedRows: 20 },
    ...overrides,
  };
}

function fixture(overrides = {}) {
  const t0 = sample(0, 'T0', overrides.stableStartRssBytes ?? 500_000_000);
  const t1 = sample(5_000, 'T1', 620_000_000);
  const t2 = sample(30_000, 'T2', overrides.stop30sRssBytes ?? 650_000_000, overrides.t2);
  return {
    environment: { platform: 'darwin', arch: 'arm64', appVersion: 'test', electronVersion: 'test' },
    configuration: { source: 'synthetic', durationMinutes: 30, sampleIntervalMs: 5_000, meetingMode: 'sales' },
    availability: { vadBacklog: overrides.vadBacklog === null ? 'file_replay_bypasses_capture_vad' : null },
    samples: [t0, t1, t2],
  };
}

test('least-squares slope is returned in units per minute', () => {
  assert.equal(linearSlope([{ elapsedMs: 0, value: 0 }, { elapsedMs: 60_000, value: 120 }], item => item.value), 120);
});

test('post-stop RSS passes the wider relative-or-absolute allowance', () => {
  const report = summarizeLongMeetingRun(fixture());
  assert.equal(report.acceptance.rssRecovered.pass, true);
  assert.equal(report.acceptance.rssRecovered.limit, 500_000_000 + 200 * 1024 * 1024);
});

test('non-zero queues at T2 fail release acceptance', () => {
  const report = summarizeLongMeetingRun(fixture({ t2: { stt: { queuedTasks: 0, pendingAudio: 1, vadBacklog: null }, rag: { pending: 0, processing: 0 }, ipc: { pending: 0, maxPending: 4 } } }));
  assert.equal(report.acceptance.queuesReleased.pass, false);
});

test('post-stop session reset does not fail meeting transcript monotonicity', () => {
  const input = fixture();
  input.samples[2].session.fullSegments = 0;
  input.samples[2].session.effectiveSegments = 0;
  const report = summarizeLongMeetingRun(input);
  assert.equal(report.acceptance.transcriptMonotonic.pass, true);
});

test('missing values remain null and reports contain no content-bearing fields', () => {
  const report = summarizeLongMeetingRun(fixture({ vadBacklog: null }));
  assert.equal(report.samples[0].stt.vadBacklog, null);
  assert.equal(report.availability.vadBacklog, 'file_replay_bypasses_capture_vad');
  const serialized = `${JSON.stringify(report)}${renderLongMeetingMarkdown(report)}`;
  assert.doesNotMatch(serialized, /transcriptText|prompt|evidence|audioBase64|apiKey/);
});
