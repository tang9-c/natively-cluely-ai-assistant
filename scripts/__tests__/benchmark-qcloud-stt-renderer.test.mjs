import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFailureSample,
  buildSuccessfulSample,
  buildTimingBreakdown,
  parseBenchmarkArgs,
} from '../benchmark-qcloud-stt-renderer.mjs';
import { transcribeClipWithQcloud } from '../run-sales-local-stt-benchmark.mjs';

test('parses explicit diagnostic cell arguments', () => {
  const options = parseBenchmarkArgs([
    '--output', '/tmp/qcloud-cell.json',
    '--segment-seconds', '10',
    '--poll-interval-ms', '1000',
    '--parameter-group', 'qcloud-current-plus-vad',
    '--valid-samples', '10',
    '--audio', '/tmp/private.wav',
    '--reference', '/tmp/private.docx',
  ]);

  assert.equal(options.output, '/tmp/qcloud-cell.json');
  assert.equal(options.segmentSeconds, 10);
  assert.equal(options.pollIntervalMs, 1000);
  assert.equal(options.parameterGroup, 'qcloud-current-plus-vad');
  assert.equal(options.validSamples, 10);
  assert.equal(options.audio, '/tmp/private.wav');
  assert.equal(options.reference, '/tmp/private.docx');
});

test('keeps the legacy positional output and current defaults', () => {
  const options = parseBenchmarkArgs(['/tmp/report.json'], { QCLOUD_STT_RENDERER_BENCHMARK_RUNS: '30' });
  assert.equal(options.output, '/tmp/report.json');
  assert.equal(options.segmentSeconds, 10);
  assert.equal(options.pollIntervalMs, 2000);
  assert.equal(options.parameterGroup, 'qcloud-current');
  assert.equal(options.validSamples, 30);
});

test('rejects unsupported matrix parameters with stable error codes', () => {
  assert.throws(() => parseBenchmarkArgs(['--segment-seconds', '7']), /invalid_segment_seconds/);
  assert.throws(() => parseBenchmarkArgs(['--poll-interval-ms', '750']), /invalid_poll_interval_ms/);
  assert.throws(() => parseBenchmarkArgs(['--parameter-group', 'unknown']), /invalid_parameter_group/);
  assert.throws(() => parseBenchmarkArgs(['--valid-samples', '0']), /invalid_valid_samples/);
  assert.throws(() => parseBenchmarkArgs(['--unknown', 'x']), /unknown_option/);
});

test('derives measured timings and honest provider processing bounds from phases', () => {
  const timings = buildTimingBreakdown({
    submittedAt: 100,
    finalAt: 1300,
    rendererAt: 1320,
    phaseEvents: [
      { phase: 'submit_started', atMs: 100 },
      { phase: 'submit_completed', atMs: 200, durationMs: 100 },
      { phase: 'poll_started', atMs: 205, attempt: 1 },
      { phase: 'poll_completed', atMs: 225, attempt: 1, durationMs: 20, taskStatus: '20000001' },
      { phase: 'poll_started', atMs: 1225, attempt: 2 },
      { phase: 'poll_completed', atMs: 1250, attempt: 2, durationMs: 25, taskStatus: '20000000' },
      { phase: 'task_completed', atMs: 1250, attempt: 2, taskStatus: '20000000' },
      { phase: 'result_parsed', atMs: 1252, durationMs: 2 },
    ],
  });

  assert.deepEqual(timings, {
    submit: 100,
    poll: 45,
    pollWait: 1000,
    providerProcessingLowerBound: 25,
    providerProcessingUpperBound: 1050,
    parse: 2,
    submitToFinal: 1200,
    finalToRenderer: 20,
    endToEnd: 1220,
  });
});

test('successful and failed samples contain only sanitized evidence', () => {
  const success = buildSuccessfulSample({
    index: 1,
    options: { segmentSeconds: 10, pollIntervalMs: 1000, parameterGroup: 'qcloud-current' },
    timingsMs: { submitToFinal: 8000 },
    pollRequests: 4,
    comparison: { characterErrorRate: 0.2, keywordRecall: 0.8, lengthRatio: 0.9 },
  });
  assert.deepEqual(success.quality, {
    characterErrorRate: 0.2,
    keywordRecall: 0.8,
    lengthRatio: 0.9,
  });
  assert.equal(success.qualityPassed, true);

  const failure = buildFailureSample({
    index: 2,
    options: { segmentSeconds: 10, pollIntervalMs: 1000, parameterGroup: 'qcloud-current' },
    stage: 'poll_started',
    error: new Error('Bearer secret-key private transcript'),
  });
  assert.deepEqual(failure, {
    index: 2,
    valid: false,
    segmentSeconds: 10,
    pollIntervalMs: 1000,
    parameterGroup: 'qcloud-current',
    failureStage: 'poll_failed',
  });
  assert.doesNotMatch(JSON.stringify({ success, failure }), /secret-key|private transcript|errorCode|textHash/);
});

test('QCloud clip helper forwards the phase observer without network access', async () => {
  const events = [];
  let receivedOptions;
  const result = await transcribeClipWithQcloud({
    clipPath: '/not-read.wav',
    entry: 'sales-real-001',
    opts: { parameterGroup: 'qcloud-current', pollIntervalMs: 1000, maxAttempts: 60 },
    apiKey: 'private-key',
    onPhase: event => events.push(event),
    dependencies: {
      audioBuffer: Buffer.from('fake'),
      constants: { QCLOUD_STT_QUERY_ENDPOINT: 'query', QCLOUD_STT_SUBMIT_ENDPOINT: 'submit' },
      aucClient: {
        extractDoubaoAucTranscript: () => '',
        transcribeNewApiDoubaoAucMultipartFile: async options => {
          receivedOptions = options;
          options.onPhase({ phase: 'submit_started', atMs: 1 });
          return 'done';
        },
      },
    },
  });

  assert.equal(result.text, 'done');
  assert.equal(receivedOptions.pollIntervalMs, 1000);
  assert.deepEqual(events, [{ phase: 'submit_started', atMs: 1 }]);
});
