import axios from 'axios';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

export function usage(label, scriptName) {
  console.log(`${label} real STT replay

Usage:
  QCLOUD_LIVE_API_KEY=... npm run ${scriptName}
  NATIVELY_API_KEY=... npm run ${scriptName}

Options:
  --poll-interval-ms <n>   Poll interval, default 2000
  --max-attempts <n>       Max query attempts, default 60
  --help                   Show this help

Notes:
  - This makes real network requests and may incur STT usage cost.
  - API keys are read from environment variables and are never printed.`);
}

export function parseArgs(argv, label, scriptName) {
  const opts = {
    pollIntervalMs: 2000,
    maxAttempts: 60,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage(label, scriptName);
      process.exit(0);
    }
    if (arg === '--poll-interval-ms') {
      opts.pollIntervalMs = Number(argv[++i]);
      continue;
    }
    if (arg === '--max-attempts') {
      opts.maxAttempts = Number(argv[++i]);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(opts.pollIntervalMs) || opts.pollIntervalMs < 0) {
    throw new Error('--poll-interval-ms must be a non-negative number');
  }
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts <= 0) {
    throw new Error('--max-attempts must be a positive integer');
  }
  return opts;
}

export async function runRealSttReplay({ label, scriptName, modeTemplateType, outputDirName }) {
  const opts = parseArgs(process.argv.slice(2), label, scriptName);
  const apiKey = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.log(JSON.stringify({
      environmentStatus: 'blocked_missing_credentials',
      status: 'blocked',
      reason: `Missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY for ${label} real STT replay.`,
      modeTemplateTypes: [modeTemplateType],
    }, null, 2));
    process.exit(0);
  }

  const replayModuleUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/services/qa/DynamicActionReplayRunner.js'),
  ).href;
  const aucClientUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/audio/doubaoAucClient.js'),
  ).href;
  const constantsUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/llm/QCloudLlmConstants.js'),
  ).href;

  const { runDynamicActionReplay } = await import(replayModuleUrl);
  const {
    extractDoubaoAucTranscript,
    transcribeNewApiDoubaoAucMultipartFile,
  } = await import(aucClientUrl);
  const {
    QCLOUD_STT_QUERY_ENDPOINT,
    QCLOUD_STT_SUBMIT_ENDPOINT,
  } = await import(constantsUrl);

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

  async function transcribeAudio(audioPath) {
    const audioBuffer = fs.readFileSync(audioPath);
    return transcribeNewApiDoubaoAucMultipartFile({
      submitEndpoint: QCLOUD_STT_SUBMIT_ENDPOINT,
      queryEndpoint: QCLOUD_STT_QUERY_ENDPOINT,
      authHeader: { Authorization: `Bearer ${apiKey.trim()}` },
      audioBuffer,
      filename: path.basename(audioPath),
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
  }

  const report = await runDynamicActionReplay({
    manifestPath: path.join(root, 'tests/fixtures/dynamic-actions/replay/replay-manifest.json'),
    outputDir: path.join(root, 'reports', outputDirName),
    audioRoot: root,
    modeTemplateTypes: [modeTemplateType],
    environmentStatus: 'ok',
    transcribeAudio: async ({ audioPath }) => transcribeAudio(audioPath),
  });

  console.log(JSON.stringify(report, null, 2));
  if (report.assetCoverageFailures?.length > 0) {
    console.error(`[${label} real STT replay] Missing required real audio assets: ${report.assetCoverageFailures
      .map((failure) => `${failure.modeTemplateType} ${failure.availableReal}/${failure.requiredReal} real assets`)
      .join(', ')}`);
  }
  if (report.failedEntries > 0 || report.skippedEntries > 0 || report.assetCoverageFailures?.length > 0) process.exit(1);
}
