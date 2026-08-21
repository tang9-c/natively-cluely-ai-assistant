import path from 'node:path';

export const SCENARIO_IDS = Object.freeze([
  'cold-start',
  'stt',
  'dynamic-action',
  'llm',
  'rag',
  'summary',
  'qcloud-stt',
  'long-meeting',
]);

const SCENARIO_ID_SET = new Set(SCENARIO_IDS);

export class OrchestratorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OrchestratorError';
    this.code = code;
  }
}

export function parseOrchestratorArgs(argv) {
  let quick = false;
  let resume = false;
  let only = null;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--quick') {
      if (quick) throw new OrchestratorError('quick_repeated');
      quick = true;
      continue;
    }
    if (option === '--resume') {
      if (resume) throw new OrchestratorError('resume_repeated');
      resume = true;
      continue;
    }
    if (option === '--only') {
      if (only !== null) throw new OrchestratorError('only_repeated');
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new OrchestratorError('only_value_missing');
      index += 1;
      const ids = value.split(',');
      if (ids.some((id) => !id)) throw new OrchestratorError('only_value_invalid');
      if (new Set(ids).size !== ids.length) throw new OrchestratorError('duplicate_scenario_id');
      if (ids.some((id) => !SCENARIO_ID_SET.has(id))) throw new OrchestratorError('invalid_scenario_id');
      only = ids;
      continue;
    }
    throw new OrchestratorError('unknown_option');
  }

  return {
    mode: quick ? 'quick' : (only ? 'selected' : 'full'),
    resume,
    only,
  };
}

export function createScenarioManifest({ rootDir, mode }) {
  const quick = mode === 'quick';
  const reportDir = path.join(rootDir, 'reports/performance/m4-16gb');
  const resolve = (relativePath) => path.join(rootDir, relativePath);
  const sampleTarget = quick ? 1 : 30;

  return [
    scenario({
      id: 'cold-start',
      runner: resolve('scripts/benchmark-cold-start.mjs'),
      reportPaths: [path.join(reportDir, 'cold-start-30.json')],
      aggregateFlags: ['--cold-start'],
      target: sampleTarget,
      countEnv: 'COLD_START_BENCHMARK_RUNS',
      requiresBuild: true,
    }),
    scenario({
      id: 'stt',
      runner: resolve('scripts/benchmark-stt-samples.mjs'),
      reportPaths: [path.join(reportDir, 'stt-30.json')],
      aggregateFlags: ['--stt'],
      target: sampleTarget,
      countEnv: 'STT_BENCHMARK_RUNS',
      requiredEnv: ['STT_BENCHMARK_ENTRY'],
    }),
    scenario({
      id: 'dynamic-action',
      runner: resolve('scripts/benchmark-qcloud-dynamic-action.mjs'),
      reportPaths: [path.join(reportDir, 'dynamic-action-30.json')],
      aggregateFlags: ['--dynamic-action'],
      target: sampleTarget,
      countEnv: 'QCLOUD_DYNAMIC_ACTION_BENCHMARK_RUNS',
      requiredAnyEnv: [['QCLOUD_LIVE_API_KEY', 'NATIVELY_API_KEY']],
      requiresBuild: true,
    }),
    scenario({
      id: 'llm',
      runner: resolve('scripts/benchmark-qcloud-realtime.mjs'),
      reportPaths: [path.join(reportDir, 'qcloud-realtime-30.json')],
      aggregateFlags: ['--qcloud-realtime'],
      target: sampleTarget,
      countEnv: 'QCLOUD_BENCHMARK_RUNS',
      requiredEnv: ['QCLOUD_LIVE_API_KEY'],
    }),
    scenario({
      id: 'rag',
      runner: resolve('scripts/benchmark-rag-query.mjs'),
      reportPaths: [path.join(reportDir, 'rag-30.jsonl')],
      aggregateFlags: ['--telemetry'],
      target: sampleTarget,
      countEnv: 'RAG_BENCHMARK_RUNS',
    }),
    scenario({
      id: 'summary',
      runner: resolve('scripts/benchmark-qcloud-summary-quality.mjs'),
      reportPaths: [path.join(reportDir, 'qcloud-summary-30.json')],
      aggregateFlags: ['--qcloud-summary'],
      target: sampleTarget,
      countEnv: 'QCLOUD_SUMMARY_BENCHMARK_RUNS',
      requiredEnv: ['QCLOUD_LIVE_API_KEY'],
    }),
    scenario({
      id: 'qcloud-stt',
      runner: resolve('scripts/benchmark-qcloud-stt-renderer.mjs'),
      reportPaths: [path.join(reportDir, 'qcloud-stt-renderer-final.json')],
      aggregateFlags: ['--qcloud-stt-renderer'],
      target: sampleTarget,
      countEnv: 'QCLOUD_STT_RENDERER_BENCHMARK_RUNS',
      requiredAnyEnv: [['QCLOUD_LIVE_API_KEY', 'NATIVELY_API_KEY']],
      outputStyle: 'flag',
      requiresBuild: true,
    }),
    scenario({
      id: 'long-meeting',
      runner: resolve('scripts/benchmark-long-meeting-memory.mjs'),
      reportPaths: [
        resolve('release/long-meeting-memory-sensevoice-30m.json'),
        resolve('release/long-meeting-memory-sensevoice-60m.json'),
      ],
      aggregateFlags: ['--long-meeting', '--long-meeting'],
      target: [30, 60],
      countEnv: null,
      excluded: quick,
      outputStyle: 'long-meeting',
      requiresBuild: true,
    }),
  ];
}

function scenario({
  format = 'json',
  requiresBuild = false,
  requiredEnv = [],
  requiredAnyEnv = [],
  excluded = false,
  outputStyle = 'positional',
  ...definition
}) {
  return {
    ...definition,
    format: definition.id === 'rag' ? 'jsonl' : format,
    requiresBuild,
    requiresCredentials: requiredEnv.length > 0 || requiredAnyEnv.length > 0,
    requiredEnv: [...requiredEnv],
    requiredAnyEnv: requiredAnyEnv.map((group) => [...group]),
    excluded,
    outputStyle,
    reportPaths: [...definition.reportPaths],
    aggregateFlags: [...definition.aggregateFlags],
  };
}
