import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runPerformanceBaseline } from '../run-performance-baseline.mjs';
import { renderPerformanceBaselineMarkdown } from './performanceBaselineReport.mjs';

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
  const sampleReportDir = quick ? path.join(reportDir, 'quick') : reportDir;
  const resolve = (relativePath) => path.join(rootDir, relativePath);
  const sampleTarget = quick ? 1 : 30;

  return [
    scenario({
      id: 'cold-start',
      runner: resolve('scripts/benchmark-cold-start.mjs'),
      reportPaths: [path.join(sampleReportDir, quick ? 'cold-start.json' : 'cold-start-30.json')],
      aggregateFlags: ['--cold-start'],
      target: sampleTarget,
      countEnv: 'COLD_START_BENCHMARK_RUNS',
      requiresBuild: true,
    }),
    scenario({
      id: 'stt',
      runner: resolve('scripts/benchmark-stt-samples.mjs'),
      reportPaths: [path.join(sampleReportDir, quick ? 'stt.json' : 'stt-30.json')],
      aggregateFlags: ['--stt'],
      target: sampleTarget,
      countEnv: 'STT_BENCHMARK_RUNS',
      requiredEnv: ['STT_BENCHMARK_ENTRY'],
    }),
    scenario({
      id: 'dynamic-action',
      runner: resolve('scripts/benchmark-qcloud-dynamic-action.mjs'),
      reportPaths: [path.join(sampleReportDir, quick ? 'dynamic-action.json' : 'dynamic-action-30.json')],
      aggregateFlags: ['--dynamic-action'],
      target: sampleTarget,
      countEnv: 'QCLOUD_DYNAMIC_ACTION_BENCHMARK_RUNS',
      requiredAnyEnv: [['QCLOUD_LIVE_API_KEY', 'NATIVELY_API_KEY']],
      requiresBuild: true,
    }),
    scenario({
      id: 'llm',
      runner: resolve('scripts/benchmark-qcloud-realtime.mjs'),
      reportPaths: [path.join(sampleReportDir, quick ? 'qcloud-realtime.json' : 'qcloud-realtime-30.json')],
      aggregateFlags: ['--qcloud-realtime'],
      target: sampleTarget,
      countEnv: 'QCLOUD_BENCHMARK_RUNS',
      requiredEnv: ['QCLOUD_LIVE_API_KEY'],
    }),
    scenario({
      id: 'rag',
      runner: resolve('scripts/benchmark-rag-query.mjs'),
      reportPaths: [path.join(sampleReportDir, quick ? 'rag.jsonl' : 'rag-30.jsonl')],
      aggregateFlags: ['--telemetry'],
      target: sampleTarget,
      countEnv: 'RAG_BENCHMARK_RUNS',
      requiresBuild: true,
    }),
    scenario({
      id: 'summary',
      runner: resolve('scripts/benchmark-qcloud-summary-quality.mjs'),
      reportPaths: [path.join(sampleReportDir, quick ? 'qcloud-summary.json' : 'qcloud-summary-30.json')],
      aggregateFlags: ['--qcloud-summary'],
      target: sampleTarget,
      countEnv: 'QCLOUD_SUMMARY_BENCHMARK_RUNS',
      requiredEnv: ['QCLOUD_LIVE_API_KEY'],
    }),
    scenario({
      id: 'qcloud-stt',
      runner: resolve('scripts/benchmark-qcloud-stt-renderer.mjs'),
      reportPaths: [path.join(sampleReportDir, quick ? 'qcloud-stt-renderer.json' : 'qcloud-stt-renderer-final.json')],
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
      requiredEnv: ['LONG_MEETING_AUDIO', 'SENSEVOICE_MODEL_PATH', 'SENSEVOICE_TOKENS_PATH'],
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

export function inspectBaselineMachine(system = os) {
  const cpuModel = system.cpus()[0]?.model ?? 'unknown';
  const memoryBytes = system.totalmem();
  const gib = 1024 ** 3;
  const valid = /Apple M4\b/i.test(cpuModel) && memoryBytes >= 15 * gib && memoryBytes <= 17 * gib;
  return {
    valid,
    cpuModel,
    memoryBytes,
    stageCode: valid ? null : 'preflight_machine_mismatch',
  };
}

export function inspectScenarioCredentials(manifest, environment) {
  const missing = [];
  for (const definition of manifest.filter(({ excluded }) => !excluded)) {
    const variables = definition.requiredEnv.filter((name) => !environment[name]?.trim());
    for (const group of definition.requiredAnyEnv) {
      if (!group.some((name) => environment[name]?.trim())) variables.push(...group);
    }
    if (variables.length > 0) missing.push({ scenarioId: definition.id, variables });
  }
  return {
    valid: missing.length === 0,
    stageCode: missing.length === 0 ? null : 'preflight_credentials_missing',
    missing,
  };
}

export function buildCollectionPlan(manifest, validations, options) {
  const selected = new Set(options.only ?? manifest.map(({ id }) => id));
  const definitions = manifest.filter(({ id, excluded }) => selected.has(id) && !excluded);
  const collectors = [];
  for (const definition of definitions) {
    const validation = validations[definition.id] ?? { valid: false, validSamples: 0 };
    if (validation.valid) continue;
    const missing = Array.isArray(definition.target)
      ? definition.target.length
      : Math.max(1, definition.target - (options.resume ? validation.validSamples : 0));
    if (definition.id === 'long-meeting') {
      for (let index = 0; index < definition.target.length; index += 1) {
        collectors.push(longMeetingCollectionStep(definition, index, options));
      }
      continue;
    }
    collectors.push(sampleCollectionStep(definition, missing, options));
  }

  if (collectors.length === 0) return [];
  const plan = [];
  if (collectors.some(({ definition }) => definition.requiresBuild)) {
    plan.push({
      type: 'build',
      command: 'npm',
      args: ['run', 'build:electron'],
      stageCode: 'build_failed',
    });
    plan.push({
      type: 'vite',
      command: 'npm',
      args: ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5180', '--strictPort'],
      stageCode: 'vite_start_failed',
    });
  }
  return [...plan, ...collectors.map(({ definition: _definition, ...step }) => step)];
}

export async function executeCollectionPlan(plan, dependencies = {}) {
  const runProcess = dependencies.runProcess ?? defaultRunProcess;
  const startVite = dependencies.startVite ?? defaultStartVite;
  const stopVite = dependencies.stopVite ?? defaultStopVite;
  const signal = dependencies.signal;
  const executions = [];
  let viteService = null;
  try {
    for (const step of plan) {
      if (signal?.aborted) return { ok: false, stageCode: 'collection_interrupted', executions };
      if (step.type === 'vite') {
        try {
          viteService = await startVite(step.command, step.args, { cwd: step.cwd, env: step.env, signal });
        } catch {
          return { ok: false, stageCode: step.stageCode, executions };
        }
        continue;
      }
      let result;
      try {
        result = await runProcess(step.command, step.args, {
          cwd: step.cwd,
          env: { ...process.env, ...step.env },
          signal,
        });
      } catch {
        result = { code: 1 };
      }
      if (signal?.aborted) return { ok: false, stageCode: 'collection_interrupted', executions };
      if (result.code !== 0) return { ok: false, stageCode: step.stageCode, executions };
      if (step.type === 'collector') {
        executions.push({
          scenarioId: step.scenarioId,
          outputPath: step.outputPath,
          ...(step.markdownPath ? { markdownPath: step.markdownPath } : {}),
          ...(step.durationMinutes ? { durationMinutes: step.durationMinutes } : {}),
        });
      }
    }
    return { ok: true, stageCode: null, executions };
  } finally {
    if (viteService?.owned) await stopVite(viteService).catch(() => {});
  }
}

const METRIC_IDS_BY_SCENARIO = Object.freeze({
  'cold-start': ['app.cold-start'],
  stt: ['stt.audio-to-final'],
  'dynamic-action': ['dynamic-action.final-transcript-to-card'],
  llm: ['llm.first-token', 'llm.completed'],
  rag: ['rag.query'],
  summary: ['meeting.summary'],
  'qcloud-stt': [
    'qcloud-stt.segment-submit-to-final',
    'qcloud-stt.final-to-renderer',
    'qcloud-stt.segment-submit-to-renderer',
  ],
});

export function resolveUnifiedOutputPaths(rootDir, options) {
  const basename = options.mode === 'quick'
    ? 'unified-quick'
    : (options.only ? 'unified-selected' : 'unified-final');
  const directory = path.join(rootDir, 'reports/performance/m4-16gb');
  return {
    json: path.join(directory, `${basename}.json`),
    markdown: path.join(directory, `${basename}.md`),
  };
}

export function buildAggregatorOptions(manifest, { mode, only, environment, outputs }) {
  const selected = new Set(only ?? manifest.map(({ id }) => id));
  const definitions = manifest.filter(({ id, excluded }) => selected.has(id) && !excluded);
  const options = {
    telemetry: [],
    longMeeting: [],
    coldStart: [],
    stt: [],
    dynamicAction: [],
    qcloudRealtime: [],
    qcloudSummary: [],
    qcloudSttRenderer: [],
    metricIds: [],
    output: outputs.json,
    markdown: outputs.markdown,
    environment,
    configuration: { mode },
  };
  const optionKeys = {
    'cold-start': 'coldStart',
    stt: 'stt',
    'dynamic-action': 'dynamicAction',
    llm: 'qcloudRealtime',
    rag: 'telemetry',
    summary: 'qcloudSummary',
    'qcloud-stt': 'qcloudSttRenderer',
    'long-meeting': 'longMeeting',
  };
  for (const definition of definitions) {
    options[optionKeys[definition.id]].push(...definition.reportPaths);
    options.metricIds.push(...metricIdsForDefinition(definition));
  }
  return options;
}

export function verifyUnifiedReport(report, definitions, sourceReports) {
  if (!['completed', 'quick-completed', 'selected-completed'].includes(report?.status)) {
    return verificationFailure('verification_report_incomplete');
  }
  const expected = new Map();
  for (const definition of definitions.filter(({ excluded }) => !excluded)) {
    const source = sourceReports.get(definition.id);
    if (!source) return verificationFailure('verification_source_missing');
    for (const [metricId, values] of metricValuesForScenario(definition, source)) expected.set(metricId, values);
  }
  for (const [metricId, values] of expected) {
    const scenario = report.scenarios?.[metricId];
    if (!scenario) return verificationFailure('verification_metric_missing');
    if (scenario.status !== 'passed') return verificationFailure('verification_report_incomplete');
    if (scenario.sampleCount !== values.length) return verificationFailure('verification_sample_count_mismatch');
    const sorted = values.slice().sort((left, right) => left - right);
    const p50 = nearestRank(sorted, 0.5);
    const p95 = nearestRank(sorted, 0.95);
    if (!Number.isFinite(scenario.p50Ms)
      || !Number.isFinite(scenario.p95Ms)
      || scenario.p50Ms > scenario.p95Ms
      || scenario.p50Ms !== p50
      || scenario.p95Ms !== p95) {
      return verificationFailure('verification_percentile_mismatch');
    }
  }
  const unexpected = Object.keys(report.scenarios ?? {}).filter((metricId) => !expected.has(metricId));
  if (unexpected.length > 0) return verificationFailure('verification_metric_unexpected');
  return { valid: true, stageCode: null };
}

export function scanReportPrivacy(value, configuredSecrets = []) {
  const secrets = configuredSecrets.filter((secret) => typeof secret === 'string' && secret.length >= 6);
  return scanPrivacyValue(value, secrets, null);
}

export async function runAllPerformanceBaselines(options, dependencies = {}) {
  const rootDir = dependencies.rootDir ?? process.cwd();
  const environment = dependencies.env ?? process.env;
  const machine = inspectBaselineMachine(dependencies.system ?? os);
  if (!machine.valid) return failedResult(machine.stageCode);

  const manifest = createScenarioManifest({ rootDir, mode: options.mode });
  const selectedIds = new Set(options.only ?? manifest.map(({ id }) => id));
  const selectedDefinitions = manifest.filter(({ id }) => selectedIds.has(id));
  const activeDefinitions = selectedDefinitions.filter(({ excluded }) => !excluded);
  const statePath = path.join(rootDir, 'reports/performance/m4-16gb/.baseline-state.json');
  let state;
  try {
    state = loadBaselineState(statePath);
  } catch (error) {
    return failedResult(error instanceof OrchestratorError ? error.code : 'state_parse_failed');
  }

  const sources = new Map();
  const validations = {};
  const decisions = {};
  for (const definition of activeDefinitions) {
    let source = null;
    let validation;
    try {
      source = readScenarioReport(definition);
      validation = validateScenarioReport(definition, source);
      if (validation.valid) {
        const currentHashes = scenarioHashes(definition);
        const stateEntry = state.scenarios[stateKey(options.mode, definition.id)] ?? state.scenarios[definition.id];
        const stateValidation = validateStateEntry(stateEntry, currentHashes);
        if (!stateValidation.valid) validation = { ...validation, valid: false, stageCode: stateValidation.stageCode };
      }
    } catch (error) {
      validation = invalidValidation(definition, error instanceof OrchestratorError ? error.code : 'report_parse_failed');
    }
    if (source) sources.set(definition.id, source);
    validations[definition.id] = validation;
    decisions[definition.id] = decideScenarioAction(definition, validation, options);
  }
  for (const definition of selectedDefinitions.filter(({ excluded }) => excluded)) {
    decisions[definition.id] = 'excluded';
  }

  const plan = buildCollectionPlan(manifest, validations, { ...options, env: environment });
  const collectionIds = new Set(plan.filter(({ type }) => type === 'collector').map(({ scenarioId }) => scenarioId));
  const credentialCheck = inspectScenarioCredentials(
    activeDefinitions.filter(({ id }) => collectionIds.has(id)),
    environment,
  );
  if (!credentialCheck.valid) return failedResult(credentialCheck.stageCode);

  const execution = await executeCollectionPlan(plan, {
    runProcess: dependencies.runProcess,
    startVite: dependencies.startVite,
    stopVite: dependencies.stopVite,
    signal: dependencies.signal,
  });
  if (!execution.ok) return failedResult(execution.stageCode);

  const configuredSecrets = configuredSecretValues(environment);
  try {
    await publishCollectedReports({
      activeDefinitions,
      executions: execution.executions,
      sources,
      validations,
      decisions,
      options,
      configuredSecrets,
    });
  } catch (error) {
    return failedResult(error instanceof OrchestratorError ? error.code : 'report_publish_failed');
  }

  for (const definition of activeDefinitions) {
    try {
      const source = readScenarioReport(definition);
      const validation = validateScenarioReport(definition, source);
      if (!validation.valid) return failedResult(validation.stageCode);
      const privacy = scanReportPrivacy(source, configuredSecrets);
      if (!privacy.valid) return failedResult(privacy.stageCode);
      sources.set(definition.id, source);
      validations[definition.id] = validation;
    } catch (error) {
      return failedResult(error instanceof OrchestratorError ? error.code : 'report_parse_failed');
    }
  }

  const outputs = resolveUnifiedOutputPaths(rootDir, options);
  const candidateOutputs = {
    json: temporaryReportPath(outputs.json, () => 'candidate'),
    markdown: temporaryReportPath(outputs.markdown, () => 'candidate'),
  };
  const aggregate = dependencies.runPerformanceBaseline ?? runPerformanceBaseline;
  let report;
  try {
    report = aggregate(buildAggregatorOptions(manifest, {
      mode: options.mode,
      only: options.only,
      environment: {
        platform: process.platform,
        arch: process.arch,
        cpuModel: machine.cpuModel,
        memoryBytes: machine.memoryBytes,
        nodeVersion: process.version,
      },
      outputs: candidateOutputs,
    }));
  } catch {
    cleanupFiles(Object.values(candidateOutputs));
    return failedResult('aggregation_failed');
  }

  const verification = verifyUnifiedReport(report, activeDefinitions, sources);
  if (!verification.valid) {
    cleanupFiles(Object.values(candidateOutputs));
    return failedResult(verification.stageCode);
  }
  report.status = options.mode === 'quick'
    ? 'quick-completed'
    : (options.only ? 'selected-completed' : 'completed');
  report.orchestration = {
    mode: options.mode,
    resume: options.resume,
    scenarios: Object.fromEntries(selectedDefinitions.map((definition) => [definition.id, {
      decision: decisions[definition.id],
      status: definition.excluded ? 'excluded-by-quick-mode' : 'completed',
      target: definition.target,
      validSamples: validations[definition.id]?.validSamples ?? 0,
      reportPaths: definition.reportPaths.map((reportPath) => path.relative(rootDir, reportPath)),
      stageCode: null,
    }])),
  };
  const reportPrivacy = scanReportPrivacy(report, configuredSecrets);
  if (!reportPrivacy.valid) {
    cleanupFiles(Object.values(candidateOutputs));
    return failedResult(reportPrivacy.stageCode);
  }

  const markdown = renderPerformanceBaselineMarkdown(report);
  const markdownPrivacy = scanReportPrivacy(markdown, configuredSecrets);
  if (!markdownPrivacy.valid) {
    cleanupFiles(Object.values(candidateOutputs));
    return failedResult(markdownPrivacy.stageCode);
  }

  try {
    await atomicWriteReport(outputs.json, `${JSON.stringify(report, null, 2)}\n`);
    await atomicWriteReport(outputs.markdown, markdown);
    const nextState = buildNextState(state, activeDefinitions, decisions, options.mode);
    const statePrivacy = scanReportPrivacy(nextState, configuredSecrets);
    if (!statePrivacy.valid) throw new OrchestratorError(statePrivacy.stageCode);
    await writeBaselineState(statePath, nextState);
  } catch (error) {
    cleanupFiles(Object.values(candidateOutputs));
    return failedResult(error instanceof OrchestratorError ? error.code : 'final_report_publish_failed');
  }
  cleanupFiles(Object.values(candidateOutputs));
  return {
    ok: true,
    summary: {
      status: report.status,
      scenarios: Object.keys(report.scenarios).length,
      output: path.relative(rootDir, outputs.json),
    },
  };
}

async function publishCollectedReports({
  activeDefinitions,
  executions,
  sources,
  validations,
  decisions,
  options,
  configuredSecrets,
}) {
  const byScenario = Map.groupBy(executions, ({ scenarioId }) => scenarioId);
  for (const definition of activeDefinitions) {
    const scenarioExecutions = byScenario.get(definition.id);
    if (!scenarioExecutions) continue;
    if (definition.id === 'long-meeting') {
      const reports = scenarioExecutions
        .sort((left, right) => left.durationMinutes - right.durationMinutes)
        .map(({ outputPath }) => JSON.parse(fs.readFileSync(outputPath, 'utf8')));
      const validation = validateScenarioReport(definition, reports);
      if (!validation.valid) throw new OrchestratorError(validation.stageCode);
      const privacy = scanReportPrivacy(reports, configuredSecrets);
      if (!privacy.valid) throw new OrchestratorError(privacy.stageCode);
      for (let index = 0; index < reports.length; index += 1) {
        await atomicWriteReport(definition.reportPaths[index], `${JSON.stringify(reports[index], null, 2)}\n`);
        const markdownPath = scenarioExecutions[index].markdownPath;
        if (markdownPath && fs.existsSync(markdownPath)) {
          const markdown = fs.readFileSync(markdownPath, 'utf8');
          const markdownPrivacy = scanReportPrivacy(markdown, configuredSecrets);
          if (!markdownPrivacy.valid) throw new OrchestratorError(markdownPrivacy.stageCode);
          await atomicWriteReport(definition.reportPaths[index].replace(/\.json$/, '.md'), markdown);
        }
      }
      sources.set(definition.id, reports);
      validations[definition.id] = validation;
      continue;
    }

    const temporaryDefinition = { ...definition, reportPaths: [scenarioExecutions[0].outputPath] };
    const additional = readScenarioReport(temporaryDefinition);
    const candidate = decisions[definition.id] === 'resumed'
      ? mergeScenarioReports(definition, sources.get(definition.id), additional)
      : additional;
    const validation = validateScenarioReport(definition, candidate);
    if (!validation.valid) throw new OrchestratorError(validation.stageCode);
    const privacy = scanReportPrivacy(candidate, configuredSecrets);
    if (!privacy.valid) throw new OrchestratorError(privacy.stageCode);
    const content = definition.format === 'jsonl'
      ? `${candidate.map((record) => JSON.stringify(record)).join('\n')}\n`
      : `${JSON.stringify(candidate, null, 2)}\n`;
    await atomicWriteReport(definition.reportPaths[0], content);
    sources.set(definition.id, candidate);
    validations[definition.id] = validation;
  }
  cleanupFiles(executions.flatMap(({ outputPath, markdownPath }) => [outputPath, markdownPath].filter(Boolean)));
}

function scenarioHashes(definition) {
  const runnerHash = fs.existsSync(definition.runner)
    ? hashReportContent(fs.readFileSync(definition.runner))
    : null;
  const reportHash = definition.reportPaths.every((reportPath) => fs.existsSync(reportPath))
    ? hashReportContent(definition.reportPaths.map((reportPath) => fs.readFileSync(reportPath)).join('\n'))
    : null;
  return { runnerHash, reportHash };
}

function buildNextState(state, definitions, decisions, mode) {
  const nextState = structuredClone(state);
  nextState.schemaVersion = 1;
  nextState.scenarios ??= {};
  for (const definition of definitions) {
    const hashes = scenarioHashes(definition);
    nextState.scenarios[stateKey(mode, definition.id)] = {
      schemaVersion: 1,
      scenarioId: definition.id,
      runnerHash: hashes.runnerHash,
      reportHash: hashes.reportHash,
      target: definition.target,
      mode,
      decision: decisions[definition.id],
      updatedAt: new Date().toISOString(),
    };
  }
  return nextState;
}

function stateKey(mode, scenarioId) {
  return mode === 'full' ? scenarioId : `${mode}:${scenarioId}`;
}

function configuredSecretValues(environment) {
  return Object.entries(environment)
    .filter(([key, value]) => /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) && typeof value === 'string')
    .map(([, value]) => value)
    .filter(Boolean);
}

function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    if (filePath) fs.rmSync(filePath, { force: true });
  }
}

function failedResult(stageCode) {
  return {
    ok: false,
    summary: { status: 'failed', stageCode },
  };
}

function metricIdsForDefinition(definition) {
  if (definition.id !== 'long-meeting') return [...METRIC_IDS_BY_SCENARIO[definition.id]];
  return definition.target.flatMap((duration) => [
    `meeting.${duration}m.cpu`,
    `meeting.${duration}m.memory`,
    `meeting.${duration}m.database-size`,
    `meeting.${duration}m.renderer-long-frames`,
    `meeting.${duration}m.renderer-render-commits`,
  ]);
}

function metricValuesForScenario(definition, source) {
  const extracted = extractScenarioSamples(definition, source);
  if (extracted.schemaInvalid) return [];
  if (definition.id === 'long-meeting') {
    return extracted.samples.flatMap(({ durationMinutes, values }) => {
      const columns = [0, 1, 2, 3, 4].map((column) => values.map((row) => row[column]));
      return [
        [`meeting.${durationMinutes}m.cpu`, columns[0]],
        [`meeting.${durationMinutes}m.memory`, columns[1]],
        [`meeting.${durationMinutes}m.database-size`, columns[2]],
        [`meeting.${durationMinutes}m.renderer-long-frames`, columns[3]],
        [`meeting.${durationMinutes}m.renderer-render-commits`, columns[4]],
      ];
    });
  }
  const metricIds = METRIC_IDS_BY_SCENARIO[definition.id];
  return metricIds.map((metricId, column) => [
    metricId,
    extracted.samples.map(({ values }) => values[column]),
  ]);
}

function nearestRank(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function verificationFailure(stageCode) {
  return { valid: false, stageCode };
}

function scanPrivacyValue(value, secrets, key) {
  if (typeof value === 'string') {
    if (/^data:audio\//i.test(value)) return verificationFailure('privacy_audio_detected');
    if (secrets.some((secret) => value.includes(secret))) return verificationFailure('privacy_secret_detected');
    if (/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)
      || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(value)) {
      return verificationFailure('privacy_token_pattern_detected');
    }
    if (key && sensitiveReportKey(key) && !['[REMOVED]', '[REDACTED]'].includes(value)) {
      return verificationFailure('privacy_sensitive_field_detected');
    }
    return { valid: true, stageCode: null };
  }
  if (key && sensitiveReportKey(key) && value != null) return verificationFailure('privacy_sensitive_field_detected');
  if (Array.isArray(value)) {
    for (const child of value) {
      const result = scanPrivacyValue(child, secrets, null);
      if (!result.valid) return result;
    }
    return { valid: true, stageCode: null };
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      const result = scanPrivacyValue(child, secrets, childKey);
      if (!result.valid) return result;
    }
  }
  return { valid: true, stageCode: null };
}

function sensitiveReportKey(key) {
  return /^(transcript(?:Text)?|prompt|referenceContent|evidence(?:Text)?|screenshot|responseBody|requestBody|body|queryText|userInput|chunkText|snippetText|apiKey|authorization|bearer|token|secret|password|credential|audio|audioBase64|stack|error|message)$/i.test(key);
}

function sampleCollectionStep(definition, missing, options) {
  const outputPath = temporaryReportPath(definition.reportPaths[0], options.randomId);
  const args = definition.outputStyle === 'flag'
    ? [definition.runner, '--output', outputPath]
    : [definition.runner, outputPath];
  return {
    definition,
    type: 'collector',
    scenarioId: definition.id,
    command: process.execPath,
    args,
    env: { [definition.countEnv]: String(missing) },
    outputPath,
    reportPath: definition.reportPaths[0],
    stageCode: `collector_${definition.id.replaceAll('-', '_')}_failed`,
  };
}

function longMeetingCollectionStep(definition, index, options) {
  const durationMinutes = definition.target[index];
  const outputPath = temporaryReportPath(definition.reportPaths[index], options.randomId);
  const markdownPath = outputPath.replace(/\.json\.([^.]+)\.tmp$/, '.md.$1.tmp');
  const environment = options.env ?? process.env;
  return {
    definition,
    type: 'collector',
    scenarioId: definition.id,
    durationMinutes,
    command: process.execPath,
    args: [
      definition.runner,
      '--source', 'sensevoice-audio',
      '--audio', environment.LONG_MEETING_AUDIO ?? '',
      '--model', environment.SENSEVOICE_MODEL_PATH ?? '',
      '--tokens', environment.SENSEVOICE_TOKENS_PATH ?? '',
      '--duration-minutes', String(durationMinutes),
      '--json', outputPath,
      '--markdown', markdownPath,
    ],
    env: {},
    outputPath,
    markdownPath,
    reportPath: definition.reportPaths[index],
    stageCode: `collector_long_meeting_${durationMinutes}m_failed`,
  };
}

function temporaryReportPath(reportPath, randomId = () => `${process.pid}-${Date.now()}`) {
  return path.join(path.dirname(reportPath), `.${path.basename(reportPath)}.${randomId()}.tmp`);
}

function defaultRunProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'ignore',
    });
    const abort = () => child.kill('SIGTERM');
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => resolve({ code: 1 }));
    child.once('exit', (code) => {
      options.signal?.removeEventListener('abort', abort);
      resolve({ code: code ?? 1 });
    });
  });
}

async function defaultStartVite(command, args, options) {
  if (await isViteReady()) return { owned: false, process: null };
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: 'ignore',
  });
  const abort = () => child.kill('SIGTERM');
  options.signal?.addEventListener('abort', abort, { once: true });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (options.signal?.aborted || child.exitCode != null) break;
    if (await isViteReady()) return { owned: true, process: child };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill('SIGTERM');
  throw new OrchestratorError(options.signal?.aborted ? 'collection_interrupted' : 'vite_start_failed');
}

async function defaultStopVite(service) {
  service.process?.kill('SIGTERM');
}

async function isViteReady() {
  try {
    return (await fetch('http://127.0.0.1:5180')).ok;
  } catch {
    return false;
  }
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
