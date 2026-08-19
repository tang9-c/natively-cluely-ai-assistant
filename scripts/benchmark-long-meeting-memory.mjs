#!/usr/bin/env node

import { fork, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { _electron as electron } from '@playwright/test';

import {
  renderLongMeetingMarkdown,
  summarizeLongMeetingRun,
} from './lib/longMeetingBenchmarkReport.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SUPPORTED_DURATIONS = new Set([30, 60, 180]);
const SOURCE_IDS = new Set(['synthetic', 'sensevoice-audio']);
const RATE_INTERVALS_MS = { slow: 1_500, normal: 750, fast: 300 };

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function validateOptions(input) {
  const options = {
    source: 'synthetic',
    durationMinutes: 30,
    sampleIntervalMs: 5_000,
    meetingMode: 'sales',
    transcriptRate: 'normal',
    testMode: false,
    jsonPath: 'release/long-meeting-memory.json',
    markdownPath: 'release/long-meeting-memory.md',
    ...input,
  };
  if (!SOURCE_IDS.has(options.source)) throw new Error('--source must be synthetic or sensevoice-audio');
  if (!Number.isFinite(options.durationMinutes) || options.durationMinutes <= 0) {
    throw new Error('--duration-minutes must be positive');
  }
  if (!options.testMode && !SUPPORTED_DURATIONS.has(options.durationMinutes)) {
    throw new Error('--duration-minutes must be 30, 60, or 180 unless --test-mode is set');
  }
  if (!Number.isFinite(options.sampleIntervalMs) || options.sampleIntervalMs < 100) {
    throw new Error('--sample-interval-ms must be at least 100');
  }
  if (!Object.hasOwn(RATE_INTERVALS_MS, options.transcriptRate)) {
    throw new Error('--transcript-rate must be slow, normal, or fast');
  }
  if (options.source === 'sensevoice-audio') {
    if (!options.audioPath) throw new Error('--audio is required for sensevoice-audio');
    if (!options.modelPath) throw new Error('--model is required for sensevoice-audio');
    if (!options.tokensPath) throw new Error('--tokens is required for sensevoice-audio');
  }
  return options;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--test-mode') options.testMode = true;
    else if (arg === '--source') options.source = requireValue(argv, index++, arg);
    else if (arg === '--duration-minutes') options.durationMinutes = Number(requireValue(argv, index++, arg));
    else if (arg === '--sample-interval-ms') options.sampleIntervalMs = Number(requireValue(argv, index++, arg));
    else if (arg === '--meeting-mode') options.meetingMode = requireValue(argv, index++, arg);
    else if (arg === '--transcript-rate') options.transcriptRate = requireValue(argv, index++, arg);
    else if (arg === '--json') options.jsonPath = requireValue(argv, index++, arg);
    else if (arg === '--markdown') options.markdownPath = requireValue(argv, index++, arg);
    else if (arg === '--audio') options.audioPath = requireValue(argv, index++, arg);
    else if (arg === '--model') options.modelPath = requireValue(argv, index++, arg);
    else if (arg === '--tokens') options.tokensPath = requireValue(argv, index++, arg);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) return { ...validateOptions({}), help: true };
  return validateOptions(options);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function generateTranscriptSchedule({ seed = 42, minutes, transcriptRate = 'normal' }) {
  const random = seededRandom(seed);
  const intervalMs = RATE_INTERVALS_MS[transcriptRate];
  const durationMs = minutes * 60_000;
  const phrases = [
    '请说明当前方案的实施范围和验收标准。',
    '这个问题需要结合现有流程进一步确认。',
    '我们记录下一步负责人和计划完成时间。',
    '请补充接口约束以及可能影响交付的风险。',
  ];
  const schedule = [];
  for (let atMs = 0, index = 0; atMs < durationMs; atMs += intervalMs, index += 1) {
    const phrase = phrases[Math.floor(random() * phrases.length)];
    schedule.push({
      id: `synthetic-${seed}-${index}`,
      atMs,
      textLengthCategory: phrase.length < 20 ? 'short' : 'medium',
      payload: {
        speaker: index % 2 === 0 ? 'interviewer' : 'user',
        text: phrase,
        timestamp: atMs,
        final: true,
        confidence: Number((0.9 + random() * 0.09).toFixed(4)),
        rawSegmentIds: [`synthetic-${seed}-${index}`],
      },
    });
  }
  return schedule;
}

export function availabilityForSource(source) {
  return {
    vadBacklog: source === 'sensevoice-audio'
      ? 'file_replay_bypasses_capture_vad'
      : 'synthetic_source_bypasses_capture_vad',
    rendererTranscriptRows: 'meeting_detail_not_opened_during_live_benchmark',
  };
}

export function mergeSenseVoiceSample(sample, workerSample) {
  if (!workerSample) return sample;
  const pendingAudio = Number(workerSample.stt?.pendingAudio ?? 0)
    + Number(workerSample.stt?.inFlightAudio ?? 0);
  return {
    ...sample,
    session: sample.session ? {
      ...sample.session,
      fullSegments: workerSample.finalCount,
      effectiveSegments: workerSample.finalCount,
    } : sample.session,
    stt: {
      workerCount: workerSample.workerPool.workerCount,
      leaseCount: workerSample.workerPool.leaseCount,
      activeTasks: workerSample.workerPool.activeTasks,
      queuedTasks: workerSample.workerPool.queuedTasks,
      pendingAudio,
      vadBacklog: null,
    },
    processes: [
      ...sample.processes,
      {
        type: 'sensevoice-worker',
        pid: workerSample._pid ?? 0,
        cpuPercent: 0,
        workingSetBytes: workerSample.memory.rss,
      },
    ],
  };
}

function startSenseVoiceWorker(options) {
  const child = fork(path.join(ROOT, 'scripts/long-meeting-sensevoice-audio-worker.mjs'), [], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CUEUP_BENCHMARK_AUDIO: path.resolve(ROOT, options.audioPath),
      CUEUP_BENCHMARK_MODEL: path.resolve(ROOT, options.modelPath),
      CUEUP_BENCHMARK_TOKENS: path.resolve(ROOT, options.tokensPath),
      CUEUP_BENCHMARK_DURATION_MS: String(options.durationMinutes * 60_000),
      CUEUP_BENCHMARK_SAMPLE_INTERVAL_MS: String(options.sampleIntervalMs),
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let latestSample = null;
  let audioHashPrefix = null;
  let readyResolve;
  let readyReject;
  let doneResolve;
  let doneReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  child.on('message', (message) => {
    if (message?.type === 'ready') {
      audioHashPrefix = message.audioHashPrefix;
      readyResolve();
    } else if (message?.type === 'sample') {
      latestSample = { ...message, _pid: child.pid ?? 0 };
    } else if (message?.type === 'done') {
      doneResolve();
    } else if (message?.type === 'error') {
      const error = new Error(String(message.code || 'sensevoice_worker_failed'));
      readyReject(error);
      doneReject(error);
    }
  });
  child.once('exit', (code) => {
    if (code !== 0) {
      const error = new Error(`sensevoice_worker_exit_${code}`);
      readyReject(error);
      doneReject(error);
    }
  });
  return {
    child,
    ready,
    done,
    latest: () => latestSample,
    audioHashPrefix: () => audioHashPrefix,
  };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDevServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureDevServer() {
  try {
    const response = await fetch('http://localhost:5180');
    if (response.ok) return null;
  } catch {}
  const child = spawn('npm', ['run', 'dev', '--', '--port', '5180', '--strictPort'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2_000); });
  child.once('exit', (code) => {
    if (code && code !== 0) stderr = `${stderr}\nVite exited with ${code}`;
  });
  try {
    await waitForDevServer('http://localhost:5180');
    return child;
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`);
  }
}

async function findLauncherPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const url = candidate.url();
      if (url.includes('window=launcher') || !url.includes('window=')) return candidate;
    }
    await delay(100);
  }
  return app.firstWindow();
}

async function installRendererCounters(page) {
  await page.evaluate(() => {
    const metrics = { updateCount: 0, longTaskCount: 0 };
    Object.defineProperty(window, '__cueupBenchmarkMetrics', {
      configurable: true,
      value: metrics,
    });
    const mutationObserver = new MutationObserver((records) => {
      metrics.updateCount += records.length;
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver((list) => {
          metrics.longTaskCount += list.getEntries().length;
        });
        observer.observe({ type: 'longtask', buffered: true });
      } catch {}
    }
  });
}

async function rendererMetrics(page, snapshot) {
  const renderer = await page.evaluate(() => {
    const total = document.querySelector('[data-transcript-total-count]')?.getAttribute('data-transcript-total-count');
    const rendered = document.querySelector('[data-transcript-rendered-count]')?.getAttribute('data-transcript-rendered-count');
    return {
      domNodeCount: document.getElementsByTagName('*').length,
      transcriptTotalRows: total == null ? null : Number(total),
      transcriptRenderedRows: rendered == null ? null : Number(rendered),
      updateCount: window.__cueupBenchmarkMetrics?.updateCount ?? null,
      longTaskCount: window.__cueupBenchmarkMetrics?.longTaskCount ?? null,
    };
  });
  const rendererProcess = snapshot.processes.find((item) => item.type.toLowerCase().includes('renderer'));
  return { ...renderer, workingSetBytes: rendererProcess?.workingSetBytes ?? null };
}

async function takeSample(page, startedAt, phase, checkpoint) {
  const elapsedMs = Date.now() - startedAt;
  const snapshot = await page.evaluate(
    ({ elapsedMs: elapsed, phase: currentPhase, checkpoint: currentCheckpoint }) =>
      window.electronAPI.benchmarkGetRuntimeSnapshot({
        elapsedMs: elapsed,
        phase: currentPhase,
        ...(currentCheckpoint ? { checkpoint: currentCheckpoint } : {}),
      }),
    { elapsedMs, phase, checkpoint },
  );
  snapshot.renderer = await rendererMetrics(page, snapshot);
  return snapshot;
}

async function writeReport(options, report) {
  const jsonPath = path.resolve(ROOT, options.jsonPath);
  const markdownPath = path.resolve(ROOT, options.markdownPath);
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, renderLongMeetingMarkdown(report), 'utf8');
}

async function closeElectronApp(app) {
  await Promise.race([
    app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {}),
    delay(2_000),
  ]);
  await app.close().catch(() => {});
}

export async function runLongMeetingBenchmark(options) {
  const validated = validateOptions(options);
  const server = await ensureDevServer();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cueup-long-meeting-'));
  let app;
  let report;
  let senseVoiceWorker;
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
    const page = await findLauncherPage(app);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      localStorage.setItem('natively_seen_startup_v1', 'true');
      localStorage.setItem('natively_perms_shown_v1', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await installRendererCounters(page);
    const providerResult = await page.evaluate(() => window.electronAPI.setSttProvider('none'));
    if (!providerResult?.success) {
      throw new Error(`Synthetic STT isolation failed: ${providerResult?.error ?? 'unknown_error'}`);
    }
    const startResult = await page.evaluate((meetingMode) => window.electronAPI.startMeeting({
      title: 'Long meeting benchmark',
      modeId: meetingMode,
    }), validated.meetingMode);
    if (!startResult?.success) throw new Error(`Meeting start failed: ${startResult?.error ?? 'unknown_error'}`);

    if (validated.source === 'sensevoice-audio') {
      senseVoiceWorker = startSenseVoiceWorker(validated);
      await senseVoiceWorker.ready;
    }
    const startedAt = Date.now();
    const samples = [];
    if (validated.source === 'synthetic') {
      const schedule = generateTranscriptSchedule({
        seed: 42,
        minutes: validated.durationMinutes,
        transcriptRate: validated.transcriptRate,
      });
      let nextSampleAt = 0;
      for (const item of schedule) {
        const waitMs = startedAt + item.atMs - Date.now();
        if (waitMs > 0) await delay(waitMs);
        await page.evaluate((payload) => window.electronAPI.benchmarkInjectTranscript(payload), {
          ...item.payload,
          timestamp: startedAt + item.atMs,
        });
        if (item.atMs >= nextSampleAt) {
          samples.push(await takeSample(page, startedAt, 'meeting'));
          nextSampleAt += validated.sampleIntervalMs;
        }
      }
    } else {
      const meetingEndAt = startedAt + validated.durationMinutes * 60_000;
      while (Date.now() < meetingEndAt) {
        await delay(Math.min(validated.sampleIntervalMs, meetingEndAt - Date.now()));
        const sample = await takeSample(page, startedAt, 'meeting');
        samples.push(mergeSenseVoiceSample(sample, senseVoiceWorker.latest()));
      }
      await senseVoiceWorker.done;
    }
    const meetingEndAt = startedAt + validated.durationMinutes * 60_000;
    if (Date.now() < meetingEndAt) await delay(meetingEndAt - Date.now());
    samples.push(mergeSenseVoiceSample(
      await takeSample(page, startedAt, 'meeting', 'T0'),
      senseVoiceWorker?.latest(),
    ));
    const stopResult = await page.evaluate(() => window.electronAPI.benchmarkMarkStop());
    if (!stopResult?.success) throw new Error(`Meeting stop failed: ${stopResult?.error ?? 'unknown_error'}`);
    await delay(5_000);
    samples.push(mergeSenseVoiceSample(
      await takeSample(page, startedAt, 'stopping', 'T1'),
      senseVoiceWorker?.latest(),
    ));
    await delay(25_000);
    samples.push(mergeSenseVoiceSample(
      await takeSample(page, startedAt, 'post_stop', 'T2'),
      senseVoiceWorker?.latest(),
    ));

    const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    report = summarizeLongMeetingRun({
      environment: {
        platform: process.platform,
        arch: process.arch,
        appVersion: packageJson.version,
        electronVersion: process.versions.electron ?? 'playwright-electron',
      },
      configuration: {
        source: validated.source,
        durationMinutes: validated.durationMinutes,
        sampleIntervalMs: validated.sampleIntervalMs,
        meetingMode: validated.meetingMode,
      },
      availability: {
        ...availabilityForSource(validated.source),
        ...(senseVoiceWorker?.audioHashPrefix()
          ? { audioFixture: `sha256:${senseVoiceWorker.audioHashPrefix()}` }
          : {}),
      },
      samples,
    });
    await writeReport(validated, report);
  } finally {
    if (app) await closeElectronApp(app);
    if (senseVoiceWorker?.child.exitCode == null) senseVoiceWorker.child.kill('SIGTERM');
    if (server && server.exitCode == null) server.kill('SIGTERM');
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
  return report;
}

function printUsage() {
  process.stdout.write('Usage: node scripts/benchmark-long-meeting-memory.mjs --source synthetic --duration-minutes 30 --json <path> --markdown <path>\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  const report = await runLongMeetingBenchmark(options);
  const failed = Object.values(report.acceptance).filter((item) => !item.pass).length;
  process.stdout.write(`Long meeting benchmark complete: ${failed} acceptance failure(s).\n`);
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`Long meeting benchmark failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
