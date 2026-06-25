#!/usr/bin/env node
/**
 * Manual Doubao AUC real-request test.
 *
 * This script is intentionally NOT included in npm test. It calls the real
 * Volcengine Doubao AUC endpoint and requires an explicit API key + audio file.
 *
 * Usage:
 *   DOUBAO_API_KEY=your-auc-key npm run test:doubao-auc:real -- /path/to/audio.wav
 *   DOUBAO_API_KEY=your-auc-key npm run test:doubao-auc:real -- --language zh-CN
 *   # If no path is given, defaults to tests/fixtures/audio/real-conversation-2p-60s.wav
 *   # See tests/fixtures/audio/README.md to set up the default fixture.
 *
 * DO NOT print API keys. Keep this script opt-in only.
 */

import axios from 'axios';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUBMIT_ENDPOINT = 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit';
const QUERY_ENDPOINT = 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/query';
const RESOURCE_ID = 'volc.seedasr.auc';
const STATUS_OK = '20000000';
const STATUS_PROCESSING = new Set(['20000001', '20000002']);
const STATUS_SILENT = '20000003';

function usage() {
  console.log(`Manual Doubao AUC speaker separation test

Usage:
  DOUBAO_API_KEY=your-auc-key npm run test:doubao-auc:real -- /path/to/audio.wav
  DOUBAO_API_KEY=your-auc-key npm run test:doubao-auc:real -- --language zh-CN
  # If no path is given, defaults to tests/fixtures/audio/real-conversation-2p-60s.wav
  # (a 60s real Mandarin 2-person conversation; see tests/fixtures/audio/README.md)

Options:
  --language <bcp47>       Optional language hint, e.g. zh-CN
  --poll-interval-ms <n>   Poll interval, default 500
  --max-attempts <n>       Max query attempts, default 60
  --raw                    Print the final raw response JSON
  --help                   Show this help

Notes:
  - This makes a real network request and may incur Volcengine usage cost.
  - API key is read from DOUBAO_API_KEY only and is never printed.
  - The script is not included in npm test.`);
}

function parseArgs(argv) {
  const opts = {
    language: undefined,
    pollIntervalMs: 500,
    maxAttempts: 60,
    raw: false,
    audioPath: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--raw') {
      opts.raw = true;
      continue;
    }
    if (arg === '--language') {
      opts.language = argv[++i];
      continue;
    }
    if (arg === '--poll-interval-ms') {
      opts.pollIntervalMs = Number(argv[++i]);
      continue;
    }
    if (arg === '--max-attempts') {
      opts.maxAttempts = Number(argv[++i]);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    opts.audioPath = arg;
  }

  if (!Number.isFinite(opts.pollIntervalMs) || opts.pollIntervalMs < 0) {
    throw new Error('--poll-interval-ms must be a non-negative number');
  }
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts <= 0) {
    throw new Error('--max-attempts must be a positive integer');
  }
  return opts;
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function readHeader(headers, name) {
  const lower = name.toLowerCase();
  const value = headers[name] ?? headers[lower];
  if (Array.isArray(value)) return value[0] == null ? undefined : String(value[0]);
  return value == null ? undefined : String(value);
}

function wait(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function inferFormat(audioPath) {
  const ext = path.extname(audioPath).toLowerCase().replace('.', '');
  if (['wav', 'mp3', 'ogg', 'm4a', 'aac'].includes(ext)) return ext;
  return 'wav';
}

function readNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readSpeakerId(item) {
  const value = item?.speaker_id
    ?? item?.speakerId
    ?? item?.speaker
    ?? item?.additions?.speaker_id
    ?? item?.additions?.speakerId
    ?? item?.additions?.speaker;
  if (value == null || value === '') return undefined;
  return String(value);
}

function extractTranscription(data) {
  if (typeof data === 'string') {
    return { text: data, utterances: data.trim() ? [{ text: data }] : [] };
  }

  const result = data?.result || data?.resp_speech_info;
  const utteranceSource = Array.isArray(data?.result?.utterances)
    ? data.result.utterances
    : Array.isArray(result)
      ? result
      : [];

  const utterances = utteranceSource
    .map(item => {
      const text = item?.text || item?.transcription || '';
      if (!text) return null;
      return {
        text,
        startMs: readNumber(item?.start_time ?? item?.startMs),
        endMs: readNumber(item?.end_time ?? item?.endMs),
        speakerId: readSpeakerId(item),
      };
    })
    .filter(Boolean);

  const text = typeof data?.result?.text === 'string'
    ? data.result.text
    : typeof data?.text === 'string'
      ? data.text
      : utterances.map(item => item.text).join(' ');

  if (utterances.length === 0 && text.trim()) {
    return { text, utterances: [{ text }] };
  }
  return { text, utterances };
}

function buildRequestBody(audioPath, audioBase64, language) {
  const format = inferFormat(audioPath);
  return {
    user: { uid: 'natively-manual-test' },
    audio: {
      data: audioBase64,
      format,
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
      ...(language ? { language } : {}),
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
      enable_speaker_info: true,
      ssd_version: '200',
      enable_channel_split: false,
      show_utterances: true,
      vad_segment: true,
    },
  };
}

function summarizeHeaders(headers) {
  return {
    statusCode: readHeader(headers, 'x-api-status-code'),
    message: readHeader(headers, 'x-api-message'),
    requestId: readHeader(headers, 'x-api-request-id'),
    logId: readHeader(headers, 'x-tt-logid'),
  };
}

async function postJson(url, body, headers, timeout) {
  return axios.post(url, body, {
    headers,
    timeout,
    validateStatus: () => true,
  });
}

async function transcribeReal({ apiKey, audioPath, language, pollIntervalMs, maxAttempts }) {
  const audioBuffer = fs.readFileSync(audioPath);
  const requestId = createRequestId();
  const authHeader = {
    'X-Api-Key': apiKey.trim(),
    'X-Api-Resource-Id': RESOURCE_ID,
  };
  const requestBody = buildRequestBody(audioPath, audioBuffer.toString('base64'), language);

  console.log('[Doubao AUC] Submit', {
    endpoint: SUBMIT_ENDPOINT,
    requestId,
    resourceId: RESOURCE_ID,
    audioFile: path.resolve(audioPath),
    audioBytes: audioBuffer.length,
    format: requestBody.audio.format,
    language: language || '(auto)',
    speakerInfo: requestBody.request.enable_speaker_info,
  });

  const submitResponse = await postJson(
    SUBMIT_ENDPOINT,
    requestBody,
    {
      ...authHeader,
      'Content-Type': 'application/json',
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    30000,
  );

  const submitHeaders = summarizeHeaders(submitResponse.headers);
  console.log('[Doubao AUC] Submit result', {
    httpStatus: submitResponse.status,
    ...submitHeaders,
  });

  if (submitResponse.status >= 400) {
    throw new Error(`Submit HTTP ${submitResponse.status}: ${JSON.stringify(submitResponse.data)}`);
  }
  if (submitHeaders.statusCode && submitHeaders.statusCode !== STATUS_OK) {
    throw new Error(`Submit failed: status=${submitHeaders.statusCode}, message=${submitHeaders.message || 'Unknown'}`);
  }

  const immediate = extractTranscription(submitResponse.data);
  if (immediate.text.trim() || immediate.utterances.length > 0) {
    return { finalResponse: submitResponse.data, transcription: immediate, attempts: 0 };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await wait(pollIntervalMs);
    const queryHeaders = {
      ...authHeader,
      'Content-Type': 'application/json',
      'X-Api-Request-Id': requestId,
      ...(submitHeaders.logId ? { 'X-Tt-Logid': submitHeaders.logId } : {}),
    };

    const queryResponse = await postJson(QUERY_ENDPOINT, {}, queryHeaders, 15000);
    const queryHeadersSummary = summarizeHeaders(queryResponse.headers);
    console.log('[Doubao AUC] Query result', {
      attempt,
      httpStatus: queryResponse.status,
      statusCode: queryHeadersSummary.statusCode || '(ok/no-header)',
      message: queryHeadersSummary.message,
    });

    if (queryResponse.status >= 400) {
      throw new Error(`Query HTTP ${queryResponse.status}: ${JSON.stringify(queryResponse.data)}`);
    }

    const statusCode = queryHeadersSummary.statusCode;
    if (!statusCode || statusCode === STATUS_OK) {
      return {
        finalResponse: queryResponse.data,
        transcription: extractTranscription(queryResponse.data),
        attempts: attempt,
      };
    }
    if (statusCode === STATUS_SILENT) {
      return {
        finalResponse: queryResponse.data,
        transcription: { text: '', utterances: [] },
        attempts: attempt,
      };
    }
    if (!STATUS_PROCESSING.has(statusCode)) {
      throw new Error(`Query failed: status=${statusCode}, message=${queryHeadersSummary.message || 'Unknown'}`);
    }
  }

  throw new Error(`Timed out after ${maxAttempts} query attempts`);
}

function printSummary({ transcription, attempts, finalResponse, raw }) {
  const speakerCounts = new Map();
  for (const utterance of transcription.utterances) {
    const speakerId = utterance.speakerId || '(missing)';
    speakerCounts.set(speakerId, (speakerCounts.get(speakerId) || 0) + 1);
  }

  console.log('\n========== Doubao AUC Speaker Separation Result ==========');
  console.log(`Query attempts: ${attempts}`);
  console.log(`Transcript length: ${transcription.text.length}`);
  console.log(`Utterances: ${transcription.utterances.length}`);
  console.log('Speaker distribution:', Object.fromEntries(speakerCounts));
  console.log('\nTranscript:');
  console.log(transcription.text || '(empty)');

  console.log('\nUtterances:');
  for (const [index, utterance] of transcription.utterances.entries()) {
    const range = utterance.startMs != null || utterance.endMs != null
      ? `${utterance.startMs ?? '?'}-${utterance.endMs ?? '?'}ms`
      : 'time=?';
    console.log(`${index + 1}. [speaker=${utterance.speakerId || '?'} ${range}] ${utterance.text}`);
  }

  if (raw) {
    console.log('\nRaw final response:');
    console.log(JSON.stringify(finalResponse, null, 2));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.DOUBAO_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Missing DOUBAO_API_KEY. Example: DOUBAO_API_KEY=xxx npm run test:doubao-auc:real -- /path/to/audio.wav');
  }
  if (!opts.audioPath) {
    // Default to the standard fixture (60s real Mandarin 2-person conversation)
    // if it exists locally. Falls back to a friendly error otherwise so users
    // understand how to set it up.
    const defaultFixture = path.join(
      __dirname,
      '..',
      'tests',
      'fixtures',
      'audio',
      'real-conversation-2p-60s.wav',
    );
    if (fs.existsSync(defaultFixture)) {
      console.log(`[Doubao AUC] No audio path given. Using default fixture:\n  ${defaultFixture}\n`);
      opts.audioPath = defaultFixture;
    } else {
      throw new Error(
        'Missing audio file path. Either:\n'
          + '  1. Run with an explicit path: npm run test:doubao-auc:real -- /path/to/audio.wav\n'
          + `  2. Place a real conversation audio at: ${defaultFixture}\n`
          + '     See tests/fixtures/audio/README.md for setup instructions.',
      );
    }
  }
  if (!fs.existsSync(opts.audioPath)) {
    throw new Error(`Audio file does not exist: ${opts.audioPath}`);
  }

  const result = await transcribeReal({ apiKey, ...opts });
  printSummary({ ...result, raw: opts.raw });
}

main().catch(error => {
  const detail = error?.response?.data || error?.message || error;
  console.error('[Doubao AUC] FAILED:', detail);
  process.exitCode = 1;
});
