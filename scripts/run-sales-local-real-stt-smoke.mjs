#!/usr/bin/env node
/**
 * Local private sales real-audio smoke through real STT.
 *
 * DO NOT print API keys, transcripts, prompts, evidence, or private filenames.
 */

import axios from 'axios';
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const ENTRY_PATTERN = /^sales-real-\d{3}$/;

function usage() {
  console.log(`Sales local real STT smoke

Usage:
  npm run test:dynamic-actions:sales-replay:real-stt:local -- --entry sales-real-001

Options:
  --entry <sales-real-001>             Required private local entry id
  --expected-action <actionType>       Expected action type, default discovery_question
  --start-sec <n>                      Clip start offset, default 300
  --duration-sec <n>                   Clip duration, default 60, max 120
  --poll-interval-ms <n>               Poll interval, default 2000
  --max-attempts <n>                   Max query attempts, default 60
  --help                              Show this help

Notes:
  - This makes one real STT network request and may incur usage cost.
  - Private assets are read from ignored audio/real/sales and transcripts/real/sales directories.
  - API keys are read from environment variables and are never printed.`);
}

function parseArgs(argv) {
  const opts = {
    entry: '',
    expectedAction: 'discovery_question',
    startSec: 300,
    durationSec: 60,
    pollIntervalMs: 2000,
    maxAttempts: 60,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--entry') {
      opts.entry = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--expected-action') {
      opts.expectedAction = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--start-sec') {
      opts.startSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--duration-sec') {
      opts.durationSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--poll-interval-ms') {
      opts.pollIntervalMs = Number(argv[++index]);
      continue;
    }
    if (arg === '--max-attempts') {
      opts.maxAttempts = Number(argv[++index]);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!ENTRY_PATTERN.test(opts.entry)) {
    throw new Error('--entry must match sales-real-001 style ids');
  }
  if (!/^[a-z_]+$/.test(opts.expectedAction)) {
    throw new Error('--expected-action must be a simple action type');
  }
  if (!Number.isFinite(opts.startSec) || opts.startSec < 0) {
    throw new Error('--start-sec must be a non-negative number');
  }
  if (!Number.isFinite(opts.durationSec) || opts.durationSec <= 0 || opts.durationSec > 120) {
    throw new Error('--duration-sec must be a number between 1 and 120');
  }
  if (!Number.isFinite(opts.pollIntervalMs) || opts.pollIntervalMs < 0) {
    throw new Error('--poll-interval-ms must be a non-negative number');
  }
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts <= 0) {
    throw new Error('--max-attempts must be a positive integer');
  }
  return opts;
}

function buildClip(inputPath, opts) {
  const outputPath = path.join(os.tmpdir(), `${opts.entry}-${Date.now()}-${process.pid}.wav`);
  const result = spawnSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(opts.startSec),
    '-t',
    String(opts.durationSec),
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    outputPath,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg clip failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return outputPath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.log(JSON.stringify({
      environmentStatus: 'blocked_missing_credentials',
      status: 'blocked',
      reason: 'Missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY for sales local real STT smoke.',
      entry: opts.entry,
    }, null, 2));
    return;
  }

  const audioPath = path.join(root, 'tests/fixtures/dynamic-actions/replay/audio/real/sales', `${opts.entry}.wav`);
  const transcriptPath = path.join(root, 'tests/fixtures/dynamic-actions/replay/transcripts/real/sales', `${opts.entry}.docx`);
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Missing private audio asset for ${opts.entry}`);
  }

  const aucClientUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/audio/doubaoAucClient.js'),
  ).href;
  const constantsUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/llm/QCloudLlmConstants.js'),
  ).href;
  const engineUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js'),
  ).href;

  const {
    extractDoubaoAucTranscript,
    transcribeNewApiDoubaoAucMultipartFile,
  } = await import(aucClientUrl);
  const {
    QCLOUD_STT_QUERY_ENDPOINT,
    QCLOUD_STT_SUBMIT_ENDPOINT,
  } = await import(constantsUrl);
  const { DynamicActionEngine } = await import(engineUrl);

  async function post(url, body, options) {
    const response = await axios.post(url, body, {
      headers: options.headers,
      timeout: options.timeout,
      validateStatus: () => true,
    });
    if (response.status >= 400) {
      throw new Error(`QCLOUD API STT HTTP ${response.status}`);
    }
    return { data: response.data, headers: response.headers };
  }

  const clipPath = buildClip(audioPath, opts);
  let transcript = '';
  try {
    const audioBuffer = fs.readFileSync(clipPath);
    transcript = await transcribeNewApiDoubaoAucMultipartFile({
      submitEndpoint: QCLOUD_STT_SUBMIT_ENDPOINT,
      queryEndpoint: QCLOUD_STT_QUERY_ENDPOINT,
      authHeader: { Authorization: `Bearer ${apiKey.trim()}` },
      audioBuffer,
      filename: `${opts.entry}-clip.wav`,
      contentType: 'audio/wav',
      formFields: {
        model: 'bigmodel',
        enable_speaker_info: 'true',
        enable_emotion_detection: 'true',
        show_utterances: 'true',
        enable_itn: 'true',
      },
      extractTranscript: extractDoubaoAucTranscript,
      post,
      pollIntervalMs: opts.pollIntervalMs,
      maxAttempts: opts.maxAttempts,
    });
  } finally {
    fs.rmSync(clipPath, { force: true });
  }

  const engine = new DynamicActionEngine();
  const actions = await engine.assessSignals({
    transcript,
    speaker: 'customer',
    modeTemplateType: 'sales',
    modeId: 'sales',
    sessionId: `local-real-stt-${opts.entry}`,
    language: 'zh',
  });
  const matchedAction = actions.find((action) => action.type === opts.expectedAction);
  const report = {
    environmentStatus: 'ok',
    status: matchedAction ? 'passed' : 'failed',
    entry: opts.entry,
    modeTemplateType: 'sales',
    expectedActionType: opts.expectedAction,
    actionTypes: actions.map((action) => action.type),
    emitted: actions.length > 0,
    transcriptLength: transcript.trim().length,
    clipStartSec: opts.startSec,
    clipDurationSec: opts.durationSec,
    privateTranscriptPresent: fs.existsSync(transcriptPath),
  };

  const outputDir = path.join(root, 'reports/dynamic-actions-sales-local-real-stt');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${opts.entry}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!matchedAction) process.exit(1);
}

await main();
