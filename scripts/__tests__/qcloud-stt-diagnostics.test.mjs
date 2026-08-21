import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildExperimentMatrix,
  chooseWinner,
  percentile,
  sanitizeFailure,
  summarizeSamples,
} from '../lib/qcloudSttDiagnostics.mjs';

const thresholds = {
  characterErrorRate: 0.35,
  keywordRecall: 0.75,
  lengthRatio: 0.75,
};

function validSample(overrides = {}) {
  return {
    valid: true,
    pollRequests: 3,
    timingsMs: {
      submit: 100,
      poll: 50,
      providerProcessing: 7000,
      parse: 2,
      submitToFinal: 7152,
      finalToRenderer: 20,
      endToEnd: 7172,
    },
    quality: {
      characterErrorRate: 0.2,
      keywordRecall: 0.9,
      lengthRatio: 0.95,
    },
    ...overrides,
  };
}

test('percentile uses the existing nearest-rank definition and rejects invalid values', () => {
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2);
  assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
  assert.equal(percentile([7], 0.95), 7);
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([-1, Number.NaN], 0.5), null);
});

test('summarizes valid latency samples separately from failures and quality', () => {
  const summary = summarizeSamples([
    validSample(),
    validSample({
      pollRequests: 5,
      timingsMs: {
        submit: 200,
        poll: 80,
        providerProcessing: 8000,
        parse: 4,
        submitToFinal: 8284,
        finalToRenderer: 40,
        endToEnd: 8324,
      },
    }),
    { valid: false, failureStage: 'poll_failed' },
  ], thresholds);

  assert.equal(summary.totalCount, 3);
  assert.equal(summary.validCount, 2);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.failureRate, 1 / 3);
  assert.deepEqual(summary.failureStages, { poll_failed: 1 });
  assert.deepEqual(summary.timingsMs.submitToFinal, {
    sampleCount: 2,
    p50Ms: 7152,
    p95Ms: 8284,
    minMs: 7152,
    maxMs: 8284,
  });
  assert.equal(summary.pollRequests.p50, 3);
  assert.equal(summary.pollRequests.p95, 5);
  assert.equal(summary.quality.passed, true);
});

test('quality is not verifiable when metrics are absent and fails on any threshold breach', () => {
  const missing = summarizeSamples([validSample({ quality: undefined })], thresholds);
  assert.equal(missing.quality.passed, false);
  assert.equal(missing.quality.status, 'missing');

  const failed = summarizeSamples([
    validSample(),
    validSample({ quality: { characterErrorRate: 0.36, keywordRecall: 0.9, lengthRatio: 0.95 } }),
  ], thresholds);
  assert.equal(failed.quality.passed, false);
  assert.equal(failed.quality.status, 'failed');
});

test('empty and all-failed inputs never manufacture latency or quality evidence', () => {
  const empty = summarizeSamples([], thresholds);
  assert.equal(empty.failureRate, null);
  assert.equal(empty.timingsMs.submitToFinal, null);
  assert.equal(empty.quality.status, 'missing');

  const failed = summarizeSamples([
    { valid: false, failureStage: 'submit_failed' },
    { valid: false, failureStage: 'unexpected-stage' },
  ], thresholds);
  assert.equal(failed.validCount, 0);
  assert.equal(failed.failedCount, 2);
  assert.equal(failed.failureRate, 1);
  assert.deepEqual(failed.failureStages, { submit_failed: 1, unknown_failed: 1 });
  assert.equal(failed.timingsMs.submitToFinal, null);
});

test('failure sanitization never includes the original error text', () => {
  const secret = new Error('Authorization Bearer secret and transcript text');
  assert.equal(sanitizeFailure(secret, 'submit'), 'submit_failed');
  assert.equal(sanitizeFailure(secret, 'poll_started'), 'poll_failed');
  assert.equal(sanitizeFailure(secret, 'result_parsed'), 'parse_failed');
  assert.equal(sanitizeFailure(secret, 'overlay_dom_visible'), 'renderer_timeout');
  assert.equal(sanitizeFailure(secret, 'unexpected-stage'), 'unknown_failed');
});

function cell(id, { failureRate = 0, p95 = 1000, requests = 4, qualityPassed = true } = {}) {
  return {
    id,
    summary: {
      failureRate,
      quality: { passed: qualityPassed },
      timingsMs: { submitToFinal: { p95Ms: p95 } },
      pollRequests: { p50: requests },
    },
  };
}

test('winner selection rejects failed quality before comparing latency', () => {
  const winner = chooseWinner([
    cell('fast-bad-quality', { p95: 500, qualityPassed: false }),
    cell('slower-valid', { p95: 1000 }),
  ], 'slower-valid');
  assert.equal(winner.id, 'slower-valid');
});

test('winner selection prioritizes failure rate then p95 latency', () => {
  assert.equal(chooseWinner([
    cell('unreliable-fast', { failureRate: 0.1, p95: 500 }),
    cell('reliable-slow', { failureRate: 0, p95: 1000 }),
  ], 'reliable-slow').id, 'reliable-slow');

  assert.equal(chooseWinner([
    cell('slow', { p95: 1200 }),
    cell('fast', { p95: 900 }),
  ], 'slow').id, 'fast');
});

test('within five percent chooses fewer requests and exact ties keep current default', () => {
  assert.equal(chooseWinner([
    cell('fast-chatty', { p95: 1000, requests: 6 }),
    cell('close-efficient', { p95: 1049, requests: 3 }),
  ], 'fast-chatty').id, 'close-efficient');

  assert.equal(chooseWinner([
    cell('candidate', { p95: 1000, requests: 3 }),
    cell('current', { p95: 1000, requests: 3 }),
  ], 'current').id, 'current');
  assert.equal(chooseWinner([cell('missing', { qualityPassed: false })], 'missing'), null);
});

test('exactly five percent is not a latency tie', () => {
  assert.equal(chooseWinner([
    cell('fast-chatty', { p95: 1000, requests: 6 }),
    cell('exactly-five-percent', { p95: 1050, requests: 1 }),
  ], 'exactly-five-percent').id, 'fast-chatty');
});

test('builds the fixed poll, segment, and VAD experiment stages', () => {
  const matrix = buildExperimentMatrix({
    pollIntervalsMs: [500, 1000, 2000],
    segmentSeconds: [5, 10, 15],
    parameterGroups: ['qcloud-current', 'qcloud-current-plus-vad'],
    screeningSamples: 10,
    finalistSamples: 30,
  });

  assert.deepEqual(matrix.map(stage => stage.id), ['poll', 'segment', 'vad']);
  assert.equal(matrix[0].cells.length, 3);
  assert.equal(matrix[1].cells.length, 3);
  assert.equal(matrix[2].cells.length, 2);
  assert.ok(matrix.every(stage => stage.screeningSamples === 10 && stage.finalistSamples === 30));
});
