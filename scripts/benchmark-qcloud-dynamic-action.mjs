#!/usr/bin/env node

import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { _electron as electron } from '@playwright/test';

import { validateBaselineMachine } from './lib/performanceBaselineCollection.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputPath = process.argv[2];
const runCount = Number.parseInt(process.env.QCLOUD_DYNAMIC_ACTION_BENCHMARK_RUNS || '30', 10);
const key = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;

if (!outputPath) throw new Error('Usage: node scripts/benchmark-qcloud-dynamic-action.mjs <output.json>');
if (!key) throw new Error('QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY is required');
if (!Number.isInteger(runCount) || runCount <= 0) throw new Error('QCLOUD_DYNAMIC_ACTION_BENCHMARK_RUNS must be positive');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForDevServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function findLauncherPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (page.url().includes('window=launcher') || !page.url().includes('window=')) return page;
    }
    await delay(100);
  }
  return app.firstWindow();
}

async function findOverlayPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => candidate.url().includes('window=overlay'));
    if (page) return page;
    await delay(100);
  }
  throw new Error('overlay_window_not_ready');
}

async function runOnce(index) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-dynamic-action-'));
  let app;
  let stage = 'launch';
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
    stage = 'renderer_ready';
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI), undefined, { timeout: 15_000 });
    await page.evaluate(() => {
      localStorage.setItem('natively_seen_startup_v1', 'true');
      localStorage.setItem('natively_perms_shown_v1', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    stage = 'qcloud_key_setup';
    const configured = await page.evaluate(async (apiKey) => window.electronAPI.setNativelyApiKey(apiKey, { selectAsDefault: true }), key);
    if (!configured?.success) throw new Error(`qcloud_key_setup_failed:${configured?.error ?? 'unknown'}`);
    stage = 'meeting_start';
    const meeting = await page.evaluate(() => window.electronAPI.startMeeting({ title: 'Dynamic action benchmark', modeId: 'sales' }));
    if (!meeting?.success) throw new Error(`meeting_start_failed:${meeting?.error ?? 'unknown'}`);
    stage = 'overlay_renderer_ready';
    const overlayPage = await findOverlayPage(app);
    await overlayPage.waitForLoadState('domcontentloaded');
    stage = 'transcript_injection';
    const dynamicActionReceived = page.evaluate(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        off?.();
        reject(new Error('dynamic_action_not_received'));
      }, 15_000);
      const off = window.electronAPI.onIntelligenceDynamicAction((data) => {
        clearTimeout(timeout);
        off?.();
        resolve(Boolean(data?.action));
      });
    }));
    const startedAt = performance.now();
    await page.evaluate(() => window.electronAPI.benchmarkInjectTranscript({
      speaker: 'interviewer',
      text: '这个价格太高了，我们的预算完全不够，必须降低报价才能继续推进。',
      timestamp: Date.now(),
      final: true,
    }));
    stage = 'dynamic_action_received';
    await dynamicActionReceived;
    stage = 'card_dom_attach';
    await overlayPage.waitForSelector('[data-dynamic-action-id]', { state: 'attached', timeout: 15_000 });
    return Math.round(performance.now() - startedAt);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('UnknownError');
    failure.benchmarkStage = stage;
    throw failure;
  } finally {
    await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await fs.rm(userDataDir, { recursive: true, force: true });
    process.stderr.write(`dynamic-action ${index + 1}/${runCount}\n`);
  }
}

const machineError = validateBaselineMachine({ cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem() });
if (machineError) throw new Error(machineError);
await waitForDevServer('http://localhost:5180');

const runs = [];
for (let index = 0; index < runCount; index += 1) {
  const startedAt = performance.now();
  try {
    runs.push({ index: index + 1, finalTranscriptToCardShownMs: await runOnce(index), errorCode: null });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'UnknownError';
    const stage = error instanceof Error && typeof error.benchmarkStage === 'string'
      ? error.benchmarkStage
      : 'unknown';
    runs.push({ index: index + 1, finalTranscriptToCardShownMs: null, completedMs: Math.round(performance.now() - startedAt), errorCode: `${stage}:${name}` });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  configuration: { runs: runCount, surface: 'launcher', readiness: 'renderer_card_dom_attached', baselineMachine: 'apple-m4-16gb', provider: 'natively-qcloud' },
  runs,
};
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ successCount: runs.filter((run) => run.errorCode == null).length, failureCount: runs.filter((run) => run.errorCode != null).length })}\n`);
