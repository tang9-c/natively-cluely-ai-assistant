import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  atomicWriteReport,
  decideScenarioAction,
  mergeScenarioReports,
  readScenarioReport,
  createScenarioManifest,
  parseOrchestratorArgs,
  SCENARIO_IDS,
  validateScenarioReport,
  validateStateEntry,
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
