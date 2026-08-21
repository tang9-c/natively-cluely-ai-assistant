#!/usr/bin/env node

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron } from '@playwright/test';

import { buildClip, transcribeClipWithQcloud } from './run-sales-local-stt-benchmark.mjs';
import { validateBaselineMachine } from './lib/performanceBaselineCollection.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputPath = process.argv[2];
const runs = Number.parseInt(process.env.QCLOUD_STT_RENDERER_BENCHMARK_RUNS || '30', 10);
const key = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
const entry = 'sales-real-001';
const audioPath = path.join(ROOT, 'tests/fixtures/dynamic-actions/replay/audio/real/sales', `${entry}.wav`);
if (!outputPath || !key || !fs.existsSync(audioPath)) throw new Error('QCloud STT renderer benchmark prerequisites are missing');
if (validateBaselineMachine({ cpuModel: os.cpus()[0]?.model, memoryBytes: os.totalmem() })) throw new Error('baseline_machine_mismatch');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForDevServer() { for (let i = 0; i < 150; i += 1) { try { if ((await fetch('http://localhost:5180')).ok) return; } catch {} await delay(200); } throw new Error('vite_not_ready'); }
async function pageFor(app, marker) { for (let i = 0; i < 150; i += 1) { const page = app.windows().find((item) => marker === 'launcher' ? (item.url().includes('window=launcher') || !item.url().includes('window=')) : item.url().includes(marker)); if (page) return page; await delay(100); } throw new Error(`window_not_ready:${marker}`); }

await waitForDevServer();
const clipPath = buildClip(audioPath, { entry, startSec: 300, durationSec: 10, preprocessingProfile: 'baseline' });
const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'natively-qcloud-renderer-'));
let app;
try {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: ROOT, env: { ...process.env, NODE_ENV: 'development', CUEUP_LONG_MEETING_BENCHMARK: '1', ELECTRON_E2E: '1', ELECTRON_E2E_SKIP_AUDIO_START: '1' } });
  const launcher = await pageFor(app, 'launcher');
  await launcher.waitForLoadState('domcontentloaded');
  await launcher.evaluate(() => { localStorage.setItem('natively_seen_startup_v1', 'true'); localStorage.setItem('natively_perms_shown_v1', '1'); });
  await launcher.reload({ waitUntil: 'domcontentloaded' });
  const meeting = await launcher.evaluate(() => window.electronAPI.startMeeting({ title: 'QCloud STT renderer benchmark', modeId: 'sales' }));
  if (!meeting?.success) throw new Error('meeting_start_failed');
  const overlay = await pageFor(app, 'window=overlay');
  await overlay.waitForLoadState('domcontentloaded');
  const result = [];
  for (let index = 0; index < runs; index += 1) {
    const submittedAt = performance.now();
    let stage = 'qcloud_submit_to_final';
    try {
      const response = await transcribeClipWithQcloud({ clipPath, entry, apiKey: key, opts: { parameterGroup: 'qcloud-current', pollIntervalMs: 2000, maxAttempts: 60 } });
      const finalAt = performance.now();
      const text = response.text?.trim();
      if (!text) throw new Error('qcloud_empty_final');
      stage = 'main_route_final';
      await launcher.evaluate((payload) => window.electronAPI.benchmarkInjectTranscript(payload), { speaker: 'interviewer', text, timestamp: Date.now(), final: true });
      stage = 'overlay_dom_visible';
      await overlay.waitForFunction((value) => document.body.innerText.includes(value), text, { timeout: 10_000 });
      const rendererAt = performance.now();
      result.push({ index: index + 1, segmentSubmitToFinalMs: Math.round(finalAt - submittedAt), finalToRendererMs: Math.round(rendererAt - finalAt), segmentSubmitToRendererMs: Math.round(rendererAt - submittedAt), textHash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16), errorCode: null });
    } catch (error) { result.push({ index: index + 1, errorCode: `${stage}:${error instanceof Error ? error.name : 'UnknownError'}` }); }
    process.stderr.write(`qcloud-stt-renderer ${index + 1}/${runs}\n`);
  }
  const report = { generatedAt: new Date().toISOString(), configuration: { provider: 'qcloud-auc', segmentDurationSec: 10, surface: 'overlay', baselineMachine: 'apple-m4-16gb' }, runs: result };
  await fsp.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
} finally { await app?.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {}); await app?.close().catch(() => {}); await fsp.rm(userDataDir, { recursive: true, force: true }); fs.rmSync(clipPath, { force: true }); }
