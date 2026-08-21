import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  createScenarioManifest,
  parseOrchestratorArgs,
  SCENARIO_IDS,
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
