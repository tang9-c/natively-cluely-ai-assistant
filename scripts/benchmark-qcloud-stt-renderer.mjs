#!/usr/bin/env node

import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from '@playwright/test';
import mammoth from 'mammoth';

import {
  buildClip,
  compareTranscripts,
  extractTimedTranscriptSegments,
  selectReferenceWindow,
  transcribeClipWithQcloud,
} from './run-sales-local-stt-benchmark.mjs';
import { sanitizeFailure, summarizeSamples } from './lib/qcloudSttDiagnostics.mjs';
import { validateBaselineMachine } from './lib/performanceBaselineCollection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEGMENT_SECONDS = new Set([5, 10, 15]);
const POLL_INTERVALS_MS = new Set([500, 1000, 2000]);
const PARAMETER_GROUPS = new Set(['qcloud-current', 'qcloud-current-plus-vad']);
const QUALITY_THRESHOLDS = { characterErrorRate: 0.35, keywordRecall: 0.75, lengthRatio: 0.75 };

function positiveInteger(value, code) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

export function parseBenchmarkArgs(argv, env = process.env) {
  const entry = 'sales-real-001';
  const options = {
    output: null,
    audio: path.join(ROOT, 'tests/fixtures/dynamic-actions/replay/audio/real/sales', `${entry}.wav`),
    reference: path.join(ROOT, 'tests/fixtures/dynamic-actions/replay/transcripts/real/sales', `${entry}.docx`),
    entry,
    startSeconds: 300,
    segmentSeconds: 10,
    pollIntervalMs: 2000,
    parameterGroup: 'qcloud-current',
    validSamples: positiveInteger(env.QCLOUD_STT_RENDERER_BENCHMARK_RUNS || '30', 'invalid_valid_samples'),
    maxSampleAttempts: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (index === 0 && !flag.startsWith('-')) {
      options.output = flag;
      continue;
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error('incomplete_option');
    if (flag === '--output') options.output = value;
    else if (flag === '--audio') options.audio = value;
    else if (flag === '--reference') options.reference = value;
    else if (flag === '--segment-seconds') options.segmentSeconds = Number(value);
    else if (flag === '--poll-interval-ms') options.pollIntervalMs = Number(value);
    else if (flag === '--parameter-group') options.parameterGroup = value;
    else if (flag === '--valid-samples') options.validSamples = positiveInteger(value, 'invalid_valid_samples');
    else if (flag === '--max-sample-attempts') options.maxSampleAttempts = positiveInteger(value, 'invalid_max_sample_attempts');
    else if (flag === '--start-seconds') options.startSeconds = Number(value);
    else throw new Error('unknown_option');
    index += 1;
  }

  if (!SEGMENT_SECONDS.has(options.segmentSeconds)) throw new Error('invalid_segment_seconds');
  if (!POLL_INTERVALS_MS.has(options.pollIntervalMs)) throw new Error('invalid_poll_interval_ms');
  if (!PARAMETER_GROUPS.has(options.parameterGroup)) throw new Error('invalid_parameter_group');
  if (!Number.isFinite(options.startSeconds) || options.startSeconds < 0) throw new Error('invalid_start_seconds');
  options.maxSampleAttempts ??= options.validSamples * 3;
  return options;
}

function firstPhase(events, phase) {
  return events.find(event => event.phase === phase);
}

export function buildTimingBreakdown({ submittedAt, finalAt, rendererAt, phaseEvents }) {
  const submitCompleted = firstPhase(phaseEvents, 'submit_completed');
  const pollCompleted = phaseEvents.filter(event => event.phase === 'poll_completed');
  const pollStarted = phaseEvents.filter(event => event.phase === 'poll_started');
  const taskCompleted = firstPhase(phaseEvents, 'task_completed');
  const parsed = firstPhase(phaseEvents, 'result_parsed');
  const pollWait = pollStarted.slice(1).reduce((sum, event, index) => {
    const previousCompleted = pollCompleted[index];
    return sum + Math.max(0, event.atMs - previousCompleted.atMs);
  }, 0);
  const lastProcessingObservation = pollCompleted.length > 1
    ? pollCompleted.at(-2).atMs
    : submitCompleted?.atMs;

  return {
    submit: Math.round(submitCompleted?.durationMs ?? 0),
    poll: Math.round(pollCompleted.reduce((sum, event) => sum + (event.durationMs ?? 0), 0)),
    pollWait: Math.round(pollWait),
    providerProcessingLowerBound: Math.round(Math.max(0, (lastProcessingObservation ?? submittedAt) - (submitCompleted?.atMs ?? submittedAt))),
    providerProcessingUpperBound: Math.round(Math.max(0, (taskCompleted?.atMs ?? finalAt) - (submitCompleted?.atMs ?? submittedAt))),
    parse: Math.round(parsed?.durationMs ?? 0),
    submitToFinal: Math.round(finalAt - submittedAt),
    finalToRenderer: Math.round(rendererAt - finalAt),
    endToEnd: Math.round(rendererAt - submittedAt),
  };
}

function sampleParameters(index, options) {
  return {
    index,
    segmentSeconds: options.segmentSeconds,
    pollIntervalMs: options.pollIntervalMs,
    parameterGroup: options.parameterGroup,
  };
}

export function buildSuccessfulSample({ index, options, timingsMs, pollRequests, comparison }) {
  const quality = {
    characterErrorRate: comparison.characterErrorRate,
    keywordRecall: comparison.keywordRecall,
    lengthRatio: comparison.lengthRatio,
  };
  const qualityPassed = quality.characterErrorRate <= QUALITY_THRESHOLDS.characterErrorRate
    && quality.keywordRecall >= QUALITY_THRESHOLDS.keywordRecall
    && quality.lengthRatio >= QUALITY_THRESHOLDS.lengthRatio;
  return {
    ...sampleParameters(index, options),
    valid: true,
    pollRequests,
    qualityPassed,
    quality,
    timingsMs,
  };
}

export function buildFailureSample({ index, options, stage, error }) {
  return {
    ...sampleParameters(index, options),
    valid: false,
    failureStage: sanitizeFailure(error, stage),
  };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDevServer() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      if ((await fetch('http://localhost:5180')).ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error('vite_not_ready');
}

async function pageFor(app, marker) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const page = app.windows().find(item => marker === 'launcher'
      ? item.url().includes('window=launcher') || !item.url().includes('window=')
      : item.url().includes(marker));
    if (page) return page;
    await delay(100);
  }
  throw new Error(`window_not_ready:${marker}`);
}

async function readReferenceWindow(options) {
  const raw = options.reference.endsWith('.docx')
    ? (await mammoth.extractRawText({ path: options.reference })).value
    : await fsp.readFile(options.reference, 'utf8');
  return selectReferenceWindow(extractTimedTranscriptSegments(raw), {
    startSec: options.startSeconds,
    durationSec: options.segmentSeconds,
  });
}

function assertPrerequisites(options) {
  if (!options.output) throw new Error('missing_output');
  if (!fs.existsSync(options.audio)) throw new Error('missing_audio');
  if (!fs.existsSync(options.reference)) throw new Error('missing_reference');
  const key = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
  if (!key?.trim()) throw new Error('missing_qcloud_credentials');
  const machineError = validateBaselineMachine({ cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem() });
  if (machineError) throw new Error(machineError);
  return key;
}

export async function runBenchmark(options) {
  const key = assertPrerequisites(options);
  const referenceWindow = await readReferenceWindow(options);
  if (referenceWindow.status !== 'aligned') throw new Error('reference_alignment_failed');
  await waitForDevServer();

  const clipPath = buildClip(options.audio, {
    entry: options.entry,
    startSec: options.startSeconds,
    durationSec: options.segmentSeconds,
    preprocessingProfile: 'baseline',
  });
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'natively-qcloud-renderer-'));
  const samples = [];
  let app;
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        CUEUP_LONG_MEETING_BENCHMARK: '1',
        ELECTRON_E2E: '1',
        ELECTRON_E2E_SKIP_AUDIO_START: '1',
      },
    });
    const launcher = await pageFor(app, 'launcher');
    await launcher.waitForLoadState('domcontentloaded');
    await launcher.evaluate(() => {
      localStorage.setItem('natively_seen_startup_v1', 'true');
      localStorage.setItem('natively_perms_shown_v1', '1');
    });
    await launcher.reload({ waitUntil: 'domcontentloaded' });
    const meeting = await launcher.evaluate(() => window.electronAPI.startMeeting({
      title: 'QCloud STT renderer benchmark',
      modeId: 'sales',
    }));
    if (!meeting?.success) throw new Error('meeting_start_failed');
    const overlay = await pageFor(app, 'window=overlay');
    await overlay.waitForLoadState('domcontentloaded');

    while (samples.filter(sample => sample.valid).length < options.validSamples
      && samples.length < options.maxSampleAttempts) {
      const index = samples.length + 1;
      const phaseEvents = [];
      const submittedAt = performance.now();
      let stage = 'submit';
      try {
        const response = await transcribeClipWithQcloud({
          clipPath,
          entry: options.entry,
          apiKey: key,
          opts: {
            parameterGroup: options.parameterGroup,
            pollIntervalMs: options.pollIntervalMs,
            maxAttempts: 60,
          },
          onPhase: event => {
            stage = event.phase;
            phaseEvents.push(event);
          },
        });
        const finalAt = performance.now();
        const text = response.text?.trim();
        if (!text) throw new Error('qcloud_empty_final');
        stage = 'renderer';
        await launcher.evaluate(payload => window.electronAPI.benchmarkInjectTranscript(payload), {
          speaker: 'interviewer',
          text,
          timestamp: Date.now(),
          final: true,
        });
        await overlay.waitForFunction(value => document.body.innerText.includes(value), text, { timeout: 10_000 });
        const rendererAt = performance.now();
        const comparison = compareTranscripts({ referenceText: referenceWindow.text, hypothesisText: text });
        samples.push(buildSuccessfulSample({
          index,
          options,
          timingsMs: buildTimingBreakdown({ submittedAt, finalAt, rendererAt, phaseEvents }),
          pollRequests: phaseEvents.filter(event => event.phase === 'poll_started').length,
          comparison,
        }));
      } catch (error) {
        samples.push(buildFailureSample({ index, options, stage, error }));
      }
      const validCount = samples.filter(sample => sample.valid).length;
      process.stderr.write(`qcloud-stt-renderer valid=${validCount}/${options.validSamples} attempts=${samples.length}/${options.maxSampleAttempts}\n`);
    }
  } finally {
    await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await fsp.rm(userDataDir, { recursive: true, force: true });
    fs.rmSync(clipPath, { force: true });
  }

  const summary = summarizeSamples(samples, QUALITY_THRESHOLDS);
  const report = {
    schemaVersion: 2,
    status: summary.validCount >= options.validSamples ? 'completed' : 'blocked',
    generatedAt: new Date().toISOString(),
    configuration: {
      provider: 'qcloud-auc',
      surface: 'overlay',
      baselineMachine: 'apple-m4-16gb',
      startSeconds: options.startSeconds,
      segmentSeconds: options.segmentSeconds,
      pollIntervalMs: options.pollIntervalMs,
      parameterGroup: options.parameterGroup,
      targetValidSamples: options.validSamples,
      maxSampleAttempts: options.maxSampleAttempts,
      qualityThresholds: QUALITY_THRESHOLDS,
    },
    summary,
    samples,
  };
  await fsp.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fsp.writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

async function main() {
  const report = await runBenchmark(parseBenchmarkArgs(process.argv.slice(2)));
  if (report.status !== 'completed') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
