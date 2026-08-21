import crypto from 'node:crypto';
import fs from 'node:fs';
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

export function readScenarioReport(definition, fileSystem = fs) {
  try {
    const parsed = definition.reportPaths.map((reportPath) => {
      if (!fileSystem.existsSync(reportPath)) throw new OrchestratorError('report_missing');
      const content = fileSystem.readFileSync(reportPath, 'utf8');
      if (definition.format === 'jsonl') {
        return content.split(/\r?\n/).flatMap((line) => line.trim() ? [JSON.parse(line)] : []);
      }
      return JSON.parse(content);
    });
    return definition.reportPaths.length === 1 ? parsed[0] : parsed;
  } catch (error) {
    if (error instanceof OrchestratorError) throw error;
    throw new OrchestratorError('report_parse_failed');
  }
}

export function validateScenarioReport(definition, parsed) {
  if (!parsed || typeof parsed !== 'object') return invalidValidation(definition, 'report_parse_failed');
  const reports = Array.isArray(parsed) && definition.id === 'long-meeting' ? parsed : [parsed];
  if (reports.some((report) => report?.configuration?.baselineMachine
    && report.configuration.baselineMachine !== 'apple-m4-16gb')) {
    return invalidValidation(definition, 'report_machine_mismatch');
  }

  const extracted = extractScenarioSamples(definition, parsed);
  if (extracted.schemaInvalid) {
    return { ...invalidValidation(definition, 'report_schema_invalid'), validSamples: extracted.samples.length, samples: extracted.samples };
  }
  const target = Array.isArray(definition.target) ? definition.target.length : definition.target;
  const complete = definition.id === 'long-meeting'
    ? hasRequiredDurations(extracted.samples, definition.target)
    : extracted.samples.length >= target;
  return {
    valid: complete,
    validSamples: extracted.samples.length,
    target,
    stageCode: complete ? null : 'report_samples_missing',
    samples: extracted.samples,
  };
}

export function decideScenarioAction(_definition, validation, { resume }) {
  if (validation.valid) return 'reused';
  return resume && validation.validSamples > 0 ? 'resumed' : 'collected';
}

export function mergeScenarioReports(definition, existing, additional, { batchId = crypto.randomUUID() } = {}) {
  if (definition.id === 'long-meeting') throw new OrchestratorError('long_meeting_resume_unsupported');
  if (definition.id === 'rag') {
    const prior = addSampleIds(existing, 'legacy');
    const next = addSampleIds(additional, batchId);
    return [...prior, ...next].slice(0, definition.target).map((record, offset) => ({ ...record, index: offset + 1 }));
  }
  if (definition.id === 'summary') return mergeSummaryReports(definition, existing, additional, batchId);

  const priorRuns = addSampleIds(existing?.runs ?? [], 'legacy');
  const additionalRuns = addSampleIds(additional?.runs ?? [], batchId);
  const runs = deduplicateBySampleId([...priorRuns, ...additionalRuns])
    .slice(0, definition.target)
    .map((run, offset) => ({ ...run, index: offset + 1 }));
  return {
    ...structuredClone(existing),
    configuration: { ...(existing?.configuration ?? {}), runs: definition.target },
    runs,
  };
}

export async function atomicWriteReport(filePath, content, fileSystem = fs.promises, { randomId = () => crypto.randomUUID() } = {}) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomId()}.tmp`);
  await fileSystem.mkdir(directory, { recursive: true });
  let handle;
  try {
    handle = await fileSystem.open(temporaryPath, 'w', 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function validateStateEntry(entry, current) {
  if (!entry) return { valid: true, legacy: true, stageCode: null };
  if (entry.reportHash !== current.reportHash) return { valid: false, legacy: false, stageCode: 'state_report_hash_mismatch' };
  if (entry.runnerHash !== current.runnerHash) return { valid: false, legacy: false, stageCode: 'state_runner_hash_mismatch' };
  return { valid: true, legacy: false, stageCode: null };
}

export function hashReportContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function loadBaselineState(filePath, fileSystem = fs) {
  if (!fileSystem.existsSync(filePath)) return { schemaVersion: 1, scenarios: {} };
  try {
    const state = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    if (state?.schemaVersion !== 1 || !state.scenarios || typeof state.scenarios !== 'object') {
      throw new OrchestratorError('state_schema_invalid');
    }
    return state;
  } catch (error) {
    if (error instanceof OrchestratorError) throw error;
    throw new OrchestratorError('state_parse_failed');
  }
}

export async function writeBaselineState(filePath, state, fileSystem = fs.promises) {
  await atomicWriteReport(filePath, `${JSON.stringify(state, null, 2)}\n`, fileSystem);
}

function extractScenarioSamples(definition, parsed) {
  if (definition.id === 'long-meeting') return extractLongMeetingSamples(parsed);
  if (definition.id === 'rag') {
    if (!Array.isArray(parsed)) return { samples: [], schemaInvalid: true };
    return extractRecords(parsed, (record) => record?.name === 'rag_query', ['durationMs']);
  }
  if (!Array.isArray(parsed?.runs)) return { samples: [], schemaInvalid: true };
  const specifications = {
    'cold-start': [(run) => run?.errorCode == null, ['readyMs']],
    stt: [(run) => run?.errorCode == null, ['audioToFinalMs']],
    'dynamic-action': [(run) => run?.errorCode == null, ['finalTranscriptToCardShownMs']],
    llm: [(run) => run?.errorCode == null && (!run.variant || run.variant === 'after'), ['firstTokenMs', 'completedMs']],
    summary: [(run) => run?.variant === 'after' && run?.generationStatus === 'success' && run?.errorCode == null, ['completedMs']],
    'qcloud-stt': [(run) => run?.errorCode == null, ['segmentSubmitToFinalMs', 'finalToRendererMs', 'segmentSubmitToRendererMs']],
  };
  const specification = specifications[definition.id];
  if (!specification) return { samples: [], schemaInvalid: true };
  return extractRecords(parsed.runs, specification[0], specification[1]);
}

function extractRecords(records, predicate, metricKeys) {
  const samples = [];
  let schemaInvalid = false;
  for (const record of records) {
    if (!predicate(record)) continue;
    const values = metricKeys.map((key) => record?.[key]);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      schemaInvalid = true;
      continue;
    }
    samples.push({ record, values });
  }
  return { samples, schemaInvalid };
}

function extractLongMeetingSamples(parsed) {
  if (!Array.isArray(parsed)) return { samples: [], schemaInvalid: true };
  const samples = [];
  let schemaInvalid = false;
  for (const report of parsed) {
    const durationMinutes = report?.configuration?.durationMinutes;
    if (!Number.isFinite(durationMinutes) || !Array.isArray(report?.samples) || report.samples.length === 0) {
      schemaInvalid = true;
      continue;
    }
    const metrics = report.samples.map((sample) => [
      sample?.main?.cpuPercent,
      sample?.main?.rssBytes,
      sample?.files?.databaseBytes,
      sample?.renderer?.longTaskCount,
      sample?.renderer?.updateCount,
    ]);
    if (metrics.some((values) => values.some((value) => !Number.isFinite(value) || value < 0))) {
      schemaInvalid = true;
      continue;
    }
    samples.push({ durationMinutes, report, values: metrics });
  }
  return { samples, schemaInvalid };
}

function invalidValidation(definition, stageCode) {
  return {
    valid: false,
    validSamples: 0,
    target: Array.isArray(definition.target) ? definition.target.length : definition.target,
    stageCode,
    samples: [],
  };
}

function hasRequiredDurations(samples, durations) {
  const available = new Set(samples.map(({ durationMinutes }) => durationMinutes));
  return durations.every((duration) => available.has(duration));
}

function addSampleIds(records, batchId) {
  return records.map((record, offset) => ({
    ...structuredClone(record),
    sampleId: record.sampleId ?? (batchId === 'legacy'
      ? `legacy-${hashReportContent(canonicalJson(record))}`
      : `${batchId}-${offset + 1}`),
  }));
}

function deduplicateBySampleId(records) {
  const seen = new Set();
  return records.filter(({ sampleId }) => {
    if (seen.has(sampleId)) return false;
    seen.add(sampleId);
    return true;
  });
}

function mergeSummaryReports(definition, existing, additional, batchId) {
  const groups = [
    ...groupSummaryRuns(existing?.runs ?? [], 'legacy'),
    ...groupSummaryRuns(additional?.runs ?? [], batchId),
  ];
  const selected = groups.filter((group) => group.some((run) => (
    run.variant === 'after'
    && run.generationStatus === 'success'
    && run.errorCode == null
    && Number.isFinite(run.completedMs)
    && run.completedMs >= 0
  ))).slice(0, definition.target);
  return {
    ...structuredClone(existing),
    runs: selected.flatMap((group, offset) => group.map((run) => ({ ...run, index: offset + 1 }))),
  };
}

function groupSummaryRuns(runs, batchId) {
  const groups = new Map();
  for (const run of runs) {
    const key = `${batchId}:${run.index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      ...structuredClone(run),
      sampleId: run.sampleId ?? (batchId === 'legacy'
        ? `legacy-${hashReportContent(canonicalJson(run))}`
        : `${batchId}-${run.index}-${run.variant}`),
    });
  }
  return [...groups.values()];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
