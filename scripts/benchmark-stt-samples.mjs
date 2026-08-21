#!/usr/bin/env node

import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { validateBaselineMachine } from './lib/performanceBaselineCollection.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputPath = process.argv[2];
const entry = process.env.STT_BENCHMARK_ENTRY;
const runCount = Number.parseInt(process.env.STT_BENCHMARK_RUNS || '30', 10);
const provider = process.env.STT_BENCHMARK_PROVIDER || 'qcloud-auc';

if (!outputPath) throw new Error('Usage: STT_BENCHMARK_ENTRY=<sales-real-001> node scripts/benchmark-stt-samples.mjs <output.json>');
if (!entry) throw new Error('STT_BENCHMARK_ENTRY is required');
if (!Number.isInteger(runCount) || runCount <= 0) throw new Error('STT_BENCHMARK_RUNS must be positive');

const machineError = validateBaselineMachine({ cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem() });
if (machineError) throw new Error(machineError);

function runProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stderr }));
  });
}

const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'natively-stt-samples-'));
const runs = [];
try {
  for (let index = 0; index < runCount; index += 1) {
    const oneReport = path.join(reportDir, `run-${index + 1}.json`);
    const startedAt = performance.now();
    try {
      const outcome = await runProcess([
        'scripts/run-sales-local-stt-benchmark.mjs',
        '--entry', entry,
        '--provider', provider,
        '--report-output', oneReport,
      ]);
      const report = JSON.parse(await fs.readFile(oneReport, 'utf8'));
      const completed = Number.isFinite(report.transcribeLatencyMs)
        && ['passed', 'failed'].includes(report.status);
      runs.push({
        index: index + 1,
        audioToFinalMs: completed ? Math.round(report.transcribeLatencyMs) : null,
        errorCode: completed
          ? null
          : report.reason ?? report.providerErrorType ?? `stt_benchmark_exit_${outcome.code ?? 'null'}`,
      });
    } catch (error) {
      runs.push({ index: index + 1, audioToFinalMs: null, completedMs: Math.round(performance.now() - startedAt), errorCode: error instanceof Error ? error.name : 'UnknownError' });
    }
    process.stderr.write(`stt ${index + 1}/${runCount}\n`);
  }
} finally {
  await fs.rm(reportDir, { recursive: true, force: true });
}

const report = {
  generatedAt: new Date().toISOString(),
  configuration: { runs: runCount, entry, provider, baselineMachine: 'apple-m4-16gb', metric: 'audio_submission_to_final_transcript' },
  runs,
};
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ successCount: runs.filter((run) => run.errorCode == null && run.audioToFinalMs != null).length, failureCount: runs.filter((run) => run.errorCode != null).length })}\n`);
