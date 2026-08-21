import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  atomicWriteReport,
  buildAggregatorOptions,
  buildCollectionPlan,
  decideScenarioAction,
  executeCollectionPlan,
  inspectBaselineMachine,
  inspectScenarioCredentials,
  resolveUnifiedOutputPaths,
  mergeScenarioReports,
  readScenarioReport,
  runAllPerformanceBaselines,
  createScenarioManifest,
  parseOrchestratorArgs,
  SCENARIO_IDS,
  validateScenarioReport,
  validateStateEntry,
  verifyUnifiedReport,
  scanReportPrivacy,
} from '../lib/performanceBaselineOrchestrator.mjs';

const rootDir = '/workspace/natively';

test('parses full, quick, resume, selected, and quick-selected modes', () => {
  assert.deepEqual(parseOrchestratorArgs([]), {
    mode: 'full',
    resume: false,
    only: null,
  });
  assert.deepEqual(parseOrchestratorArgs(['--quick']), {
    mode: 'quick',
    resume: false,
    only: null,
  });
  assert.deepEqual(parseOrchestratorArgs(['--resume', '--only', 'qcloud-stt,rag']), {
    mode: 'selected',
    resume: true,
    only: ['qcloud-stt', 'rag'],
  });
  assert.deepEqual(parseOrchestratorArgs(['--quick', '--only', 'rag']), {
    mode: 'quick',
    resume: false,
    only: ['rag'],
  });
});

test('rejects incomplete, duplicate, unknown, and repeated options with stage codes', () => {
  assert.throws(() => parseOrchestratorArgs(['--only']), { code: 'only_value_missing' });
  assert.throws(() => parseOrchestratorArgs(['--only', 'rag,']), { code: 'only_value_invalid' });
  assert.throws(() => parseOrchestratorArgs(['--only', 'rag,rag']), { code: 'duplicate_scenario_id' });
  assert.throws(() => parseOrchestratorArgs(['--only', 'unknown']), { code: 'invalid_scenario_id' });
  assert.throws(() => parseOrchestratorArgs(['--only', 'rag', '--only', 'stt']), { code: 'only_repeated' });
  assert.throws(() => parseOrchestratorArgs(['--quick', '--quick']), { code: 'quick_repeated' });
  assert.throws(() => parseOrchestratorArgs(['--resume', '--resume']), { code: 'resume_repeated' });
  assert.throws(() => parseOrchestratorArgs(['--wat']), { code: 'unknown_option' });
});

test('defines all full baseline scenarios with exact runner and report mappings', () => {
  assert.deepEqual(SCENARIO_IDS, [
    'cold-start',
    'stt',
    'dynamic-action',
    'llm',
    'rag',
    'summary',
    'qcloud-stt',
    'long-meeting',
  ]);

  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  assert.equal(manifest.length, 8);
  assert.deepEqual(manifest.map(({ id }) => id), SCENARIO_IDS);

  const expected = {
    'cold-start': ['scripts/benchmark-cold-start.mjs', 'reports/performance/m4-16gb/cold-start-30.json', 'COLD_START_BENCHMARK_RUNS', '--cold-start'],
    stt: ['scripts/benchmark-stt-samples.mjs', 'reports/performance/m4-16gb/stt-30.json', 'STT_BENCHMARK_RUNS', '--stt'],
    'dynamic-action': ['scripts/benchmark-qcloud-dynamic-action.mjs', 'reports/performance/m4-16gb/dynamic-action-30.json', 'QCLOUD_DYNAMIC_ACTION_BENCHMARK_RUNS', '--dynamic-action'],
    llm: ['scripts/benchmark-qcloud-realtime.mjs', 'reports/performance/m4-16gb/qcloud-realtime-30.json', 'QCLOUD_BENCHMARK_RUNS', '--qcloud-realtime'],
    rag: ['scripts/benchmark-rag-query.mjs', 'reports/performance/m4-16gb/rag-30.jsonl', 'RAG_BENCHMARK_RUNS', '--telemetry'],
    summary: ['scripts/benchmark-qcloud-summary-quality.mjs', 'reports/performance/m4-16gb/qcloud-summary-30.json', 'QCLOUD_SUMMARY_BENCHMARK_RUNS', '--qcloud-summary'],
    'qcloud-stt': ['scripts/benchmark-qcloud-stt-renderer.mjs', 'reports/performance/m4-16gb/qcloud-stt-renderer-final.json', 'QCLOUD_STT_RENDERER_BENCHMARK_RUNS', '--qcloud-stt-renderer'],
  };

  for (const [id, [runner, report, countEnv, aggregateFlag]] of Object.entries(expected)) {
    const scenario = manifest.find((item) => item.id === id);
    assert.equal(scenario.runner, path.join(rootDir, runner));
    assert.deepEqual(scenario.reportPaths, [path.join(rootDir, report)]);
    assert.equal(scenario.countEnv, countEnv);
    assert.deepEqual(scenario.aggregateFlags, [aggregateFlag]);
    assert.equal(scenario.target, 30);
    assert.equal(scenario.excluded, false);
  }

  const longMeeting = manifest.find(({ id }) => id === 'long-meeting');
  assert.equal(longMeeting.runner, path.join(rootDir, 'scripts/benchmark-long-meeting-memory.mjs'));
  assert.deepEqual(longMeeting.reportPaths, [
    path.join(rootDir, 'release/long-meeting-memory-sensevoice-30m.json'),
    path.join(rootDir, 'release/long-meeting-memory-sensevoice-60m.json'),
  ]);
  assert.deepEqual(longMeeting.aggregateFlags, ['--long-meeting', '--long-meeting']);
  assert.deepEqual(longMeeting.target, [30, 60]);
});

test('quick manifest targets one sample and excludes long meetings', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'quick' });
  for (const scenario of manifest.filter(({ id }) => id !== 'long-meeting')) {
    assert.equal(scenario.target, 1);
  }
  assert.equal(manifest.find(({ id }) => id === 'long-meeting').excluded, true);
  assert.equal(manifest.find(({ id }) => id === 'rag').reportPaths[0], path.join(rootDir, 'reports/performance/m4-16gb/quick/rag.jsonl'));
});

test('returns fresh manifest objects', () => {
  const first = createScenarioManifest({ rootDir, mode: 'full' });
  first[0].reportPaths.push('mutated');
  const second = createScenarioManifest({ rootDir, mode: 'full' });
  assert.equal(second[0].reportPaths.includes('mutated'), false);
});

test('validates every supported report shape by successful metric samples', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'quick' });
  const reports = {
    'cold-start': { configuration: { baselineMachine: 'apple-m4-16gb' }, runs: [{ readyMs: 900, errorCode: null }] },
    stt: { configuration: { baselineMachine: 'apple-m4-16gb' }, runs: [{ audioToFinalMs: 1200, errorCode: null }] },
    'dynamic-action': { configuration: { baselineMachine: 'apple-m4-16gb' }, runs: [{ finalTranscriptToCardShownMs: 80, errorCode: null }] },
    llm: { runs: [{ variant: 'after', firstTokenMs: 300, completedMs: 700, errorCode: null }] },
    rag: [{ name: 'rag_query', durationMs: 12, properties: { benchmarkRunId: 'rag-1' } }],
    summary: { runs: [
      { variant: 'before', index: 1, completedMs: 900, generationStatus: 'success', errorCode: null },
      { variant: 'after', index: 1, completedMs: 700, generationStatus: 'success', errorCode: null },
    ] },
    'qcloud-stt': { configuration: { baselineMachine: 'apple-m4-16gb' }, runs: [{
      segmentSubmitToFinalMs: 8000,
      finalToRendererMs: 50,
      segmentSubmitToRendererMs: 8050,
      errorCode: null,
    }] },
  };

  for (const [id, report] of Object.entries(reports)) {
    const definition = manifest.find((item) => item.id === id);
    const validation = validateScenarioReport(definition, report);
    assert.equal(validation.valid, true, id);
    assert.equal(validation.validSamples, 1, id);
    assert.equal(validation.stageCode, null, id);
    assert.equal(validation.samples.length, 1, id);
  }

  const longMeeting = manifest.find(({ id }) => id === 'long-meeting');
  const validation = validateScenarioReport(longMeeting, [longMeetingReport(30), longMeetingReport(60)]);
  assert.equal(validation.valid, true);
  assert.equal(validation.validSamples, 2);
  assert.deepEqual(validation.samples.map((sample) => sample.durationMinutes), [30, 60]);
});

test('rejects malformed, mismatched, failed, incomplete, and negative reports', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const coldStart = manifest.find(({ id }) => id === 'cold-start');
  assert.equal(validateScenarioReport(coldStart, null).stageCode, 'report_parse_failed');
  assert.equal(validateScenarioReport(coldStart, {
    configuration: { baselineMachine: 'intel-mac-16gb' },
    runs: validRuns(30, (index) => ({ index, readyMs: 10, errorCode: null })),
  }).stageCode, 'report_machine_mismatch');
  assert.equal(validateScenarioReport(coldStart, { runs: [{ readyMs: 10, errorCode: 'failed' }] }).stageCode, 'report_samples_missing');
  assert.equal(validateScenarioReport(coldStart, { runs: [{ readyMs: -1, errorCode: null }] }).stageCode, 'report_schema_invalid');
  const partial = validateScenarioReport(coldStart, { runs: validRuns(12, (index) => ({ index, readyMs: index, errorCode: null })) });
  assert.equal(partial.valid, false);
  assert.equal(partial.validSamples, 12);
  assert.equal(partial.stageCode, 'report_samples_missing');
  assert.equal(decideScenarioAction(coldStart, partial, { resume: false }), 'collected');
  assert.equal(decideScenarioAction(coldStart, partial, { resume: true }), 'resumed');

  const complete = validateScenarioReport(coldStart, {
    runs: validRuns(30, (index) => ({ index, readyMs: index, errorCode: null })),
  });
  assert.equal(decideScenarioAction(coldStart, complete, { resume: false }), 'reused');
});

test('reads JSON and JSONL reports and distinguishes missing from parse failure', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const coldStart = manifest.find(({ id }) => id === 'cold-start');
  const rag = manifest.find(({ id }) => id === 'rag');
  const files = new Map([
    [coldStart.reportPaths[0], JSON.stringify({ runs: [] })],
    [rag.reportPaths[0], '{"name":"rag_query","durationMs":1}\n{"name":"rag_query","durationMs":2}\n'],
  ]);
  const fileSystem = {
    existsSync: (filePath) => files.has(filePath),
    readFileSync: (filePath) => files.get(filePath),
  };

  assert.deepEqual(readScenarioReport(coldStart, fileSystem), { runs: [] });
  assert.equal(readScenarioReport(rag, fileSystem).length, 2);
  assert.throws(() => readScenarioReport({ ...coldStart, reportPaths: ['/missing'] }, fileSystem), { code: 'report_missing' });
  files.set(coldStart.reportPaths[0], '{bad');
  assert.throws(() => readScenarioReport(coldStart, fileSystem), { code: 'report_parse_failed' });
});

test('merges resume samples without mutation or duplicate sample IDs', () => {
  const coldStart = createScenarioManifest({ rootDir, mode: 'full' }).find(({ id }) => id === 'cold-start');
  const existing = { configuration: { runs: 12 }, runs: validRuns(12, (index) => ({ index, readyMs: index, errorCode: null })) };
  const additional = { configuration: { runs: 18 }, runs: validRuns(18, (index) => ({ index, readyMs: index + 100, errorCode: null })) };
  const snapshot = structuredClone(existing);
  const merged = mergeScenarioReports(coldStart, existing, additional, { batchId: 'batch-new' });

  assert.deepEqual(existing, snapshot);
  assert.equal(merged.runs.length, 30);
  assert.equal(new Set(merged.runs.map(({ sampleId }) => sampleId)).size, 30);
  assert.deepEqual(merged.runs.map(({ index }) => index), validRuns(30, (index) => index));
  assert.equal(merged.configuration.runs, 30);
});

test('merges JSONL telemetry and preserves paired summary variants', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const rag = manifest.find(({ id }) => id === 'rag');
  const ragMerged = mergeScenarioReports(rag,
    validRuns(12, (index) => ({ name: 'rag_query', durationMs: index })),
    validRuns(18, (index) => ({ name: 'rag_query', durationMs: index + 100 })),
    { batchId: 'rag-new' });
  assert.equal(ragMerged.length, 30);
  assert.equal(new Set(ragMerged.map(({ sampleId }) => sampleId)).size, 30);

  const summary = manifest.find(({ id }) => id === 'summary');
  const existing = { runs: summaryRuns(12, 0) };
  const additional = { runs: summaryRuns(18, 100) };
  const summaryMerged = mergeScenarioReports(summary, existing, additional, { batchId: 'summary-new' });
  assert.equal(summaryMerged.runs.filter(({ variant }) => variant === 'after').length, 30);
  assert.equal(summaryMerged.runs.filter(({ variant }) => variant === 'before').length, 30);
});

test('does not merge long meeting reports', () => {
  const longMeeting = createScenarioManifest({ rootDir, mode: 'full' }).find(({ id }) => id === 'long-meeting');
  assert.throws(() => mergeScenarioReports(longMeeting, [], []), { code: 'long_meeting_resume_unsupported' });
});

test('atomically writes private report files', async () => {
  const calls = [];
  const fileSystem = {
    mkdir: async (...args) => calls.push(['mkdir', ...args]),
    open: async (filePath, flags, mode) => {
      calls.push(['open', filePath, flags, mode]);
      return {
        writeFile: async (content) => calls.push(['writeFile', content]),
        sync: async () => calls.push(['sync']),
        close: async () => calls.push(['close']),
      };
    },
    rename: async (...args) => calls.push(['rename', ...args]),
    rm: async (...args) => calls.push(['rm', ...args]),
  };

  await atomicWriteReport('/reports/final.json', '{"ok":true}\n', fileSystem, { randomId: () => 'fixed' });
  assert.deepEqual(calls.map(([name]) => name), ['mkdir', 'open', 'writeFile', 'sync', 'close', 'rename']);
  assert.deepEqual(calls.find(([name]) => name === 'open').slice(2), ['w', 0o600]);
  assert.deepEqual(calls.at(-1), ['rename', '/reports/.final.json.fixed.tmp', '/reports/final.json']);
});

test('validates sidecar report and runner hashes without requiring legacy state', () => {
  assert.equal(validateStateEntry(null, { reportHash: 'r1', runnerHash: 's1' }).valid, true);
  assert.equal(validateStateEntry({ reportHash: 'r1', runnerHash: 's1' }, { reportHash: 'r1', runnerHash: 's1' }).valid, true);
  assert.equal(validateStateEntry({ reportHash: 'old', runnerHash: 's1' }, { reportHash: 'r1', runnerHash: 's1' }).stageCode, 'state_report_hash_mismatch');
  assert.equal(validateStateEntry({ reportHash: 'r1', runnerHash: 'old' }, { reportHash: 'r1', runnerHash: 's1' }).stageCode, 'state_runner_hash_mismatch');
});

function validRuns(count, create) {
  return Array.from({ length: count }, (_, offset) => create(offset + 1));
}

function summaryRuns(count, offset) {
  return validRuns(count, (index) => [
    { variant: 'before', index, completedMs: offset + index + 10, generationStatus: 'success', errorCode: null },
    { variant: 'after', index, completedMs: offset + index, generationStatus: 'success', errorCode: null },
  ]).flat();
}

function longMeetingReport(durationMinutes) {
  return {
    configuration: { durationMinutes },
    samples: [{
      main: { cpuPercent: 10, rssBytes: 1000 },
      renderer: { longTaskCount: 1, updateCount: 2 },
      files: { databaseBytes: 50 },
    }],
  };
}

test('accepts only Apple M4 machines in the 15-17 GiB memory range', () => {
  const gib = 1024 ** 3;
  assert.deepEqual(inspectBaselineMachine({
    cpus: () => [{ model: 'Apple M4' }],
    totalmem: () => 16 * gib,
  }), { valid: true, cpuModel: 'Apple M4', memoryBytes: 16 * gib, stageCode: null });
  assert.equal(inspectBaselineMachine({ cpus: () => [{ model: 'Intel Core i9' }], totalmem: () => 16 * gib }).stageCode, 'preflight_machine_mismatch');
  assert.equal(inspectBaselineMachine({ cpus: () => [{ model: 'Apple M4' }], totalmem: () => 8 * gib }).stageCode, 'preflight_machine_mismatch');
  assert.equal(inspectBaselineMachine({ cpus: () => [{ model: 'Apple M4' }], totalmem: () => 18 * gib }).stageCode, 'preflight_machine_mismatch');
});

test('checks credential presence without returning secret values', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const result = inspectScenarioCredentials(manifest, {
    QCLOUD_LIVE_API_KEY: 'super-secret-value',
    STT_BENCHMARK_ENTRY: 'sales-real-001',
    LONG_MEETING_AUDIO: '/audio.wav',
    SENSEVOICE_MODEL_PATH: '/model.onnx',
  });
  assert.equal(result.valid, false);
  assert.equal(result.stageCode, 'preflight_credentials_missing');
  assert.deepEqual(result.missing, [{ scenarioId: 'long-meeting', variables: ['SENSEVOICE_TOKENS_PATH'] }]);
  assert.equal(JSON.stringify(result).includes('super-secret-value'), false);
});

test('builds a collection plan only for missing scenarios and tops up on resume', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const validations = Object.fromEntries(manifest.map((definition, index) => [definition.id, {
    valid: index < 2,
    validSamples: index < 2 ? (Array.isArray(definition.target) ? 2 : 30) : (definition.id === 'rag' ? 12 : 0),
  }]));
  const plan = buildCollectionPlan(manifest, validations, {
    mode: 'full', resume: true, only: null, randomId: () => 'fixed',
  });

  assert.equal(plan.filter(({ type }) => type === 'build').length, 1);
  assert.equal(plan.filter(({ type }) => type === 'vite').length, 1);
  assert.equal(plan.some(({ scenarioId }) => scenarioId === 'cold-start'), false);
  assert.equal(plan.some(({ scenarioId }) => scenarioId === 'stt'), false);
  const rag = plan.find(({ scenarioId }) => scenarioId === 'rag');
  assert.equal(rag.env.RAG_BENCHMARK_RUNS, '18');
  assert.match(rag.outputPath, /\.rag-30\.jsonl\.fixed\.tmp$/);
  const longSteps = plan.filter(({ scenarioId }) => scenarioId === 'long-meeting');
  assert.deepEqual(longSteps.map(({ durationMinutes }) => durationMinutes), [30, 60]);
  assert.equal(longSteps[0].args.includes('sensevoice-audio'), true);
  assert.equal(longSteps[0].args.includes('--audio'), true);
  assert.equal(longSteps[0].args.includes('--model'), true);
  assert.equal(longSteps[0].args.includes('--tokens'), true);
});

test('default collection reruns a full target while quick-only narrows the plan', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const validations = Object.fromEntries(manifest.map((definition) => [definition.id, { valid: false, validSamples: 12 }]));
  const fullPlan = buildCollectionPlan(manifest, validations, {
    mode: 'full', resume: false, only: ['rag'], randomId: () => 'fixed',
  });
  assert.deepEqual(fullPlan.filter(({ type }) => type === 'collector').map(({ scenarioId }) => scenarioId), ['rag']);
  assert.equal(fullPlan.find(({ scenarioId }) => scenarioId === 'rag').env.RAG_BENCHMARK_RUNS, '30');

  const quickManifest = createScenarioManifest({ rootDir, mode: 'quick' });
  const quickPlan = buildCollectionPlan(quickManifest, {}, {
    mode: 'quick', resume: false, only: ['rag', 'long-meeting'], randomId: () => 'fixed',
  });
  assert.deepEqual(quickPlan.filter(({ type }) => type === 'collector').map(({ scenarioId }) => scenarioId), ['rag']);
  assert.equal(quickPlan.find(({ scenarioId }) => scenarioId === 'rag').env.RAG_BENCHMARK_RUNS, '1');
});

test('executes build, Vite, and collectors serially and stops owned Vite', async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const plan = [
    { type: 'build', command: 'npm', args: ['run', 'build:electron'], stageCode: 'build_failed' },
    { type: 'vite', command: 'npm', args: ['run', 'dev'], stageCode: 'vite_start_failed' },
    { type: 'collector', scenarioId: 'rag', command: 'node', args: ['rag'], stageCode: 'collector_rag_failed' },
    { type: 'collector', scenarioId: 'llm', command: 'node', args: ['llm'], stageCode: 'collector_llm_failed' },
  ];
  const result = await executeCollectionPlan(plan, {
    runProcess: async (_command, args) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(args.at(-1));
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { code: 0 };
    },
    startVite: async () => ({ owned: true, process: { pid: 123 } }),
    stopVite: async (service) => calls.push(`stop-${service.process.pid}`),
  });
  assert.equal(result.ok, true);
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, ['build:electron', 'rag', 'llm', 'stop-123']);
});

test('returns stable stage codes for process failure and interruption', async () => {
  const failed = await executeCollectionPlan([
    { type: 'collector', scenarioId: 'rag', command: 'node', args: ['rag'], stageCode: 'collector_rag_failed' },
  ], { runProcess: async () => ({ code: 2 }) });
  assert.deepEqual(failed, { ok: false, stageCode: 'collector_rag_failed', executions: [] });

  const controller = new AbortController();
  controller.abort();
  const interrupted = await executeCollectionPlan([
    { type: 'collector', scenarioId: 'rag', command: 'node', args: ['rag'], stageCode: 'collector_rag_failed' },
  ], { signal: controller.signal, runProcess: async () => ({ code: 0 }) });
  assert.deepEqual(interrupted, { ok: false, stageCode: 'collection_interrupted', executions: [] });
});

test('isolates full, quick, and selected unified output paths', () => {
  assert.deepEqual(resolveUnifiedOutputPaths(rootDir, { mode: 'full', only: null }), {
    json: path.join(rootDir, 'reports/performance/m4-16gb/unified-final.json'),
    markdown: path.join(rootDir, 'reports/performance/m4-16gb/unified-final.md'),
  });
  assert.equal(resolveUnifiedOutputPaths(rootDir, { mode: 'quick', only: ['rag'] }).json.endsWith('unified-quick.json'), true);
  assert.equal(resolveUnifiedOutputPaths(rootDir, { mode: 'selected', only: ['rag'] }).json.endsWith('unified-selected.json'), true);
});

test('maps selected scenarios to aggregator inputs and exact metric IDs', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const outputs = resolveUnifiedOutputPaths(rootDir, { mode: 'selected', only: ['qcloud-stt', 'rag'] });
  const options = buildAggregatorOptions(manifest, {
    mode: 'selected', only: ['qcloud-stt', 'rag'], environment: { cpuModel: 'Apple M4' }, outputs,
  });
  assert.deepEqual(options.telemetry, [path.join(rootDir, 'reports/performance/m4-16gb/rag-30.jsonl')]);
  assert.deepEqual(options.qcloudSttRenderer, [path.join(rootDir, 'reports/performance/m4-16gb/qcloud-stt-renderer-final.json')]);
  assert.deepEqual(options.metricIds, [
    'rag.query',
    'qcloud-stt.segment-submit-to-final',
    'qcloud-stt.final-to-renderer',
    'qcloud-stt.segment-submit-to-renderer',
  ]);
  assert.equal(options.output, outputs.json);
  assert.equal(options.configuration.mode, 'selected');
});

test('independently rejects sample-count, percentile, missing, and blocked mismatches', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'quick' });
  const rag = manifest.find(({ id }) => id === 'rag');
  const sources = new Map([['rag', [{ name: 'rag_query', durationMs: 10 }]]]);
  const passing = {
    status: 'completed',
    scenarios: { 'rag.query': { status: 'passed', sampleCount: 1, p50Ms: 10, p95Ms: 10 } },
  };
  assert.deepEqual(verifyUnifiedReport(passing, [rag], sources), { valid: true, stageCode: null });
  assert.equal(verifyUnifiedReport({ ...passing, scenarios: { 'rag.query': { ...passing.scenarios['rag.query'], sampleCount: 2 } } }, [rag], sources).stageCode, 'verification_sample_count_mismatch');
  assert.equal(verifyUnifiedReport({ ...passing, scenarios: { 'rag.query': { ...passing.scenarios['rag.query'], p95Ms: 9 } } }, [rag], sources).stageCode, 'verification_percentile_mismatch');
  assert.equal(verifyUnifiedReport({ ...passing, scenarios: {} }, [rag], sources).stageCode, 'verification_metric_missing');
  assert.equal(verifyUnifiedReport({ ...passing, status: 'blocked' }, [rag], sources).stageCode, 'verification_report_incomplete');
});

test('independently verifies dual and long-meeting metrics', () => {
  const manifest = createScenarioManifest({ rootDir, mode: 'full' });
  const llm = manifest.find(({ id }) => id === 'llm');
  const longMeeting = manifest.find(({ id }) => id === 'long-meeting');
  const sources = new Map([
    ['llm', { runs: [{ firstTokenMs: 20, completedMs: 40, errorCode: null }] }],
    ['long-meeting', [longMeetingReport(30), longMeetingReport(60)]],
  ]);
  const scenarios = {
    'llm.first-token': summary(20),
    'llm.completed': summary(40),
    'meeting.30m.cpu': summary(10),
    'meeting.30m.memory': summary(1000),
    'meeting.30m.database-size': summary(50),
    'meeting.30m.renderer-long-frames': summary(1),
    'meeting.30m.renderer-render-commits': summary(2),
    'meeting.60m.cpu': summary(10),
    'meeting.60m.memory': summary(1000),
    'meeting.60m.database-size': summary(50),
    'meeting.60m.renderer-long-frames': summary(1),
    'meeting.60m.renderer-render-commits': summary(2),
  };
  assert.equal(verifyUnifiedReport({ status: 'completed', scenarios }, [llm, longMeeting], sources).valid, true);
});

test('privacy scan rejects secrets, sensitive payloads, tokens, audio, and stacks', () => {
  assert.deepEqual(scanReportPrivacy({ stageCode: 'collector_rag_failed', durationMs: 12 }, ['secret-value']), { valid: true, stageCode: null });
  assert.equal(scanReportPrivacy({ value: 'secret-value' }, ['secret-value']).stageCode, 'privacy_secret_detected');
  assert.equal(scanReportPrivacy({ transcript: 'raw words' }, []).stageCode, 'privacy_sensitive_field_detected');
  assert.equal(scanReportPrivacy({ transcript: '[REMOVED]' }, []).valid, true);
  assert.equal(scanReportPrivacy({ token: 'abc' }, []).stageCode, 'privacy_sensitive_field_detected');
  assert.equal(scanReportPrivacy({ value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue' }, []).stageCode, 'privacy_token_pattern_detected');
  assert.equal(scanReportPrivacy({ audio: 'data:audio/wav;base64,AAAA' }, []).stageCode, 'privacy_audio_detected');
  assert.equal(scanReportPrivacy({ stack: 'Error: failed\n at file.mjs:1:1' }, []).stageCode, 'privacy_sensitive_field_detected');
});

function summary(value) {
  return { status: 'passed', sampleCount: 1, p50Ms: value, p95Ms: value };
}

test('runs a quick selected baseline end to end with atomic verified output', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-orchestrator-'));
  fs.mkdirSync(path.join(temporaryRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(temporaryRoot, 'scripts/benchmark-rag-query.mjs'), '// fixture runner\n');
  const gib = 1024 ** 3;
  const result = await runAllPerformanceBaselines({ mode: 'quick', resume: false, only: ['rag'] }, {
    rootDir: temporaryRoot,
    env: {},
    system: { cpus: () => [{ model: 'Apple M4' }], totalmem: () => 16 * gib },
    runProcess: async (_command, args) => {
      if (args[0]?.endsWith('benchmark-rag-query.mjs')) {
        fs.mkdirSync(path.dirname(args[1]), { recursive: true });
        fs.writeFileSync(args[1], '{"name":"rag_query","durationMs":12,"properties":{"benchmarkRunId":"quick-1"}}\n', { mode: 0o600 });
      }
      return { code: 0 };
    },
    startVite: async () => ({ owned: false, process: null }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.status, 'quick-completed');
  const output = JSON.parse(fs.readFileSync(path.join(temporaryRoot, 'reports/performance/m4-16gb/unified-quick.json'), 'utf8'));
  assert.equal(output.status, 'quick-completed');
  assert.equal(output.scenarios['rag.query'].sampleCount, 1);
  assert.equal(output.orchestration.scenarios.rag.decision, 'collected');
  assert.equal(fs.existsSync(path.join(temporaryRoot, 'reports/performance/m4-16gb/.baseline-state.json')), true);
});

test('reuses a valid selected report without invoking collectors', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-reuse-'));
  const reportPath = path.join(temporaryRoot, 'reports/performance/m4-16gb/rag-30.jsonl');
  const runnerPath = path.join(temporaryRoot, 'scripts/benchmark-rag-query.mjs');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
  fs.writeFileSync(runnerPath, '// fixture runner\n');
  fs.writeFileSync(reportPath, validRuns(30, (index) => JSON.stringify({ name: 'rag_query', durationMs: index, properties: { benchmarkRunId: `rag-${index}` } })).join('\n') + '\n');
  let processCalls = 0;
  const result = await runAllPerformanceBaselines({ mode: 'selected', resume: false, only: ['rag'] }, {
    rootDir: temporaryRoot,
    env: {},
    system: { cpus: () => [{ model: 'Apple M4' }], totalmem: () => 16 * 1024 ** 3 },
    runProcess: async () => { processCalls += 1; return { code: 0 }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.summary.status, 'selected-completed');
  assert.equal(processCalls, 0);
  const output = JSON.parse(fs.readFileSync(path.join(temporaryRoot, 'reports/performance/m4-16gb/unified-selected.json'), 'utf8'));
  assert.equal(output.orchestration.scenarios.rag.decision, 'reused');
});

test('fails before collection on a non-baseline machine', async () => {
  const result = await runAllPerformanceBaselines({ mode: 'quick', resume: false, only: ['rag'] }, {
    rootDir,
    env: {},
    system: { cpus: () => [{ model: 'Intel' }], totalmem: () => 8 * 1024 ** 3 },
  });
  assert.deepEqual(result, {
    ok: false,
    summary: { status: 'failed', stageCode: 'preflight_machine_mismatch' },
  });
});
