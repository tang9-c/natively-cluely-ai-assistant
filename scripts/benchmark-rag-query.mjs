#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { _electron as electron } from '@playwright/test';

import { validateBaselineMachine } from './lib/performanceBaselineCollection.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputPath = process.argv[2];
const runCount = Number.parseInt(process.env.RAG_BENCHMARK_RUNS || '30', 10);
const fixture = [
  '试点范围：第一阶段只覆盖采购审批与物料变更，期限四周。',
  '集成边界：Windchill 与 SAP 使用只读接口，异常由项目经理在两个工作日内跟进。',
  '验收标准：所有高优先级物料变更必须可追溯，且审批记录可导出。',
].join('\n');
const query = '第一阶段的 SAP 集成边界和异常处理责任是什么？';

if (!outputPath) throw new Error('Usage: node scripts/benchmark-rag-query.mjs <telemetry.jsonl>');
if (!Number.isInteger(runCount) || runCount <= 0) throw new Error('RAG_BENCHMARK_RUNS must be positive');
const machineError = validateBaselineMachine({ cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem() });
if (machineError) throw new Error(machineError);

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

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-rag-benchmark-'));
let app;
try {
  await waitForDevServer('http://localhost:5180');
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
  await page.waitForFunction(() => Boolean(window.electronAPI), undefined, { timeout: 15_000 });
  const prepared = await page.evaluate((input) => window.electronAPI.benchmarkPrepareRag(input), {
    fileName: 'rag-benchmark-fixture.md', content: fixture,
  });
  if (!prepared?.success) throw new Error('rag_fixture_preparation_failed');

  const execute = (runId) => page.evaluate((input) => window.electronAPI.benchmarkRunRagQuery(input), { query, runId });
  const warmup = await execute('rag-baseline-warmup');
  if (!warmup?.success || !warmup.hasContext) throw new Error('rag_warmup_returned_empty_context');
  for (let index = 0; index < runCount; index += 1) {
    const result = await execute(`rag-baseline-${index + 1}`);
    if (!result?.success || !result.hasContext) throw new Error(`rag_query_${index + 1}_returned_empty_context`);
    process.stderr.write(`rag ${index + 1}/${runCount}\n`);
  }
  const sourcePath = path.join(userDataDir, 'logs', 'telemetry.jsonl');
  const telemetry = await fs.readFile(sourcePath, 'utf8');
  const records = telemetry.split(/\r?\n/).flatMap((line) => {
    try { return line ? [JSON.parse(line)] : []; } catch { return []; }
  }).filter((record) => record.name === 'rag_query' && /^rag-baseline-\d+$/.test(record.properties?.benchmarkRunId));
  if (records.length !== runCount) throw new Error(`rag_telemetry_count_mismatch:${records.length}`);
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ sampleCount: runCount, fixtureHash: 'public-fixed-fixture-v1' })}\n`);
} finally {
  await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  await app?.close().catch(() => {});
  await fs.rm(userDataDir, { recursive: true, force: true });
}
