#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { _electron as electron } from '@playwright/test';

import { validateBaselineMachine } from './lib/performanceBaselineCollection.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const runCount = Number.parseInt(process.env.COLD_START_BENCHMARK_RUNS || '30', 10);
const outputPath = process.argv[2];

if (!outputPath) throw new Error('Usage: node scripts/benchmark-cold-start.mjs <output.json>');
if (!Number.isInteger(runCount) || runCount <= 0) throw new Error('COLD_START_BENCHMARK_RUNS must be positive');

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

async function runOnce(index) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-cold-start-'));
  const startedAt = performance.now();
  let app;
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_E2E: '1',
        ELECTRON_E2E_SKIP_AUDIO_START: '1',
      },
    });
    const page = await findLauncherPage(app);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.electronAPI), undefined, { timeout: 15_000 });
    return Math.round(performance.now() - startedAt);
  } finally {
    await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
    await app?.close().catch(() => {});
    await fs.rm(userDataDir, { recursive: true, force: true });
    process.stderr.write(`cold-start ${index + 1}/${runCount}\n`);
  }
}

const machineError = validateBaselineMachine({
  cpuModel: os.cpus()[0]?.model,
  memoryBytes: os.totalmem(),
});
if (machineError) throw new Error(machineError);
await waitForDevServer('http://localhost:5180');

const runs = [];
let warmupError = null;
try {
  await runOnce(-1);
} catch (error) {
  warmupError = error instanceof Error ? error.name : 'UnknownError';
}
for (let index = 0; index < runCount; index += 1) {
  const startedAt = performance.now();
  try {
    const readyMs = await runOnce(index);
    runs.push({ index: index + 1, readyMs, errorCode: null });
  } catch (error) {
    runs.push({ index: index + 1, readyMs: null, completedMs: Math.round(performance.now() - startedAt), errorCode: error instanceof Error ? error.name : 'UnknownError' });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  configuration: { runs: runCount, warmupRuns: 1, readiness: 'renderer_domcontentloaded_and_electron_api', baselineMachine: 'apple-m4-16gb' },
  warmupError,
  runs,
};
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ successCount: runs.filter((run) => run.errorCode == null).length, failureCount: runs.filter((run) => run.errorCode != null).length })}\n`);
