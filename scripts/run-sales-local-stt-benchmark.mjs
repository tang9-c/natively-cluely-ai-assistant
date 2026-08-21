#!/usr/bin/env node
/**
 * Local private sales real-audio STT benchmark.
 *
 * DO NOT print API keys, full transcripts, prompts, evidence, or private filenames by default.
 */

import axios from 'axios';
import 'dotenv/config';
import mammoth from 'mammoth';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  calculateEditBreakdown,
  extractTimedReferenceSegments,
  selectBoundaryAlignedWindow,
} from './stt-benchmark/referenceQuality.mjs';

const root = process.cwd();
const require = createRequire(import.meta.url);
const ENTRY_PATTERN = /^sales-real-\d{3}$/;
const DEFAULT_CER_THRESHOLD = 0.35;
const DEFAULT_KEYWORD_RECALL_THRESHOLD = 0.75;
const PROVIDERS = new Set(['qcloud-auc', 'direct-doubao-auc', 'local-sensevoice']);
const SEGMENTATION_MODES = new Set(['full', 'chunks', 'overlap']);
const HARDWARE_PROVIDERS = new Set(['auto', 'cpu', 'coreml', 'directml']);
const QLOUD_PARAMETER_GROUPS = new Set([
  'qcloud-current',
  'qcloud-current-plus-punc',
  'qcloud-current-plus-vad',
  'qcloud-current-plus-punc-vad',
  'qcloud-current-plus-ssd',
  'qcloud-direct-aligned',
]);
const DIRECT_DOUBAO_SUBMIT_ENDPOINT = 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit';
const DIRECT_DOUBAO_QUERY_ENDPOINT = 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/query';
const INDUSTRIAL_CORPUS_CONTEXT = [
  'PLM',
  'QMS',
  'ERP',
  'MES',
  'ALM',
  'Creo',
  'Windchill',
  'BOM',
  'ECO',
  'ECR',
  'APQP',
  'PPAP',
  'FMEA',
  '流体仿真',
  '力学仿真',
  '流程',
  '图纸',
  '功能',
  '痛点',
  '案例',
  '质量',
].join('\n');
const DOMAIN_KEYWORDS = [
  'PLM',
  'QMS',
  'ERP',
  'MES',
  'ALM',
  'PDM',
  'CAD',
  'CAE',
  'CAM',
  'Creo',
  'BOM',
  'ECO',
  'ECR',
  'APQP',
  'PPAP',
  'SPC',
  'FMEA',
  'MBD',
  'AI',
  '智能体',
  '流体仿真',
  '力学仿真',
  '结构仿真',
  '热仿真',
  '仿真',
  '需求',
  '痛点',
  '功能',
  '案例',
  '集成',
  '流程',
  '质量',
  '变更',
  '物料',
  '图纸',
  '审批',
  '追溯',
];

function usage() {
  console.log(`Sales local real STT benchmark

Usage:
  npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-001

Options:
  --entry <sales-real-001>             Required private local entry id
  --provider <id>                      qcloud-auc | direct-doubao-auc | local-sensevoice, default qcloud-auc
  --parameter-group <name>             QCLOUD group, default qcloud-current
  --segmentation-mode <mode>           full | chunks | overlap, default full
  --segment-duration-sec <n>           Segment duration for chunks/overlap, default 10
  --overlap-sec <n>                    Overlap duration for overlap mode, default 2
  --pre-roll-sec <n>                   Extra bounded audio before each non-full segment, default 0
  --post-roll-sec <n>                  Extra bounded audio after each non-full segment, default 0
  --sensevoice-term-correction <mode>  off | industrial, default off
  --sensevoice-term <canonical=variant1|variant2>
                                      Add one explicit Local SenseVoice correction rule for benchmark
  --local-channel-profile <name>       mic | system, default system
  --preprocessing-profile <name>       baseline | soxr | fixed-frame-system-normalized, default baseline
  --normalization-frame-ms <n>         Fixed-frame normalization duration, default 100
  --boosting-table-id <id>             Doubao AUC corpus boosting table id
  --boosting-table-name <name>         Doubao AUC corpus boosting table name
  --correct-table-id <id>              Doubao AUC corpus replacement table id
  --correct-table-name <name>          Doubao AUC corpus replacement table name
  --corpus-context <text>              Doubao AUC corpus context / hotword text
  --industrial-corpus-context          Use the built-in industrial software corpus context
  --start-sec <n>                      Clip start offset, default 300
  --duration-sec <n>                   Clip duration, default 60, max 120
  --poll-interval-ms <n>               Poll interval, default 2000
  --max-attempts <n>                   Max query attempts, default 60
  --local-drain-timeout-ms <n>         Local SenseVoice drain timeout, default 60000
  --hardware-provider <name>           auto | cpu | coreml | directml, default auto
  --hardware-runs <n>                  First run is cold; remaining runs are warm, default 1
  --alignment-search-sec <n>           Search reference transcript offset range, default 30
  --alignment-search-step-sec <n>      Search step, default 5
  --cer-threshold <n>                  Passing CER threshold, default ${DEFAULT_CER_THRESHOLD}
  --keyword-recall-threshold <n>       Passing keyword recall threshold, default ${DEFAULT_KEYWORD_RECALL_THRESHOLD}
  --include-private-text               Include short transcript previews in the ignored local report/stdout
  --prepare-only                       Build aligned PCM WAV and manifest without calling an STT provider
  --prepared-output-dir <dir>          Output directory for --prepare-only corpus
  --help                              Show this help

Notes:
  - Cloud providers make real STT network requests and may incur usage cost.
  - Local SenseVoice requires a downloaded local model but does not require an API key.
  - Private assets are read from ignored audio/real/sales and transcripts/real/sales directories.
  - Benchmark reports are written under ignored private/stt-benchmark by default.
  - API keys are read from environment variables and are never printed.`);
}

function parseArgs(argv) {
  const opts = {
    entry: '',
    provider: 'qcloud-auc',
    parameterGroup: 'qcloud-current',
    segmentationMode: 'full',
    segmentDurationSec: 10,
    overlapSec: 2,
    preRollSec: 0,
    postRollSec: 0,
    sensevoiceTermCorrection: 'off',
    sensevoiceTerms: [],
    localChannelProfile: 'system',
    preprocessingProfile: 'baseline',
    normalizationFrameMs: 100,
    boostingTableId: process.env.DOUBAO_AUC_BOOSTING_TABLE_ID || process.env.QCLOUD_AUC_BOOSTING_TABLE_ID || '',
    boostingTableName: process.env.DOUBAO_AUC_BOOSTING_TABLE_NAME || process.env.QCLOUD_AUC_BOOSTING_TABLE_NAME || '',
    correctTableId: process.env.DOUBAO_AUC_CORRECT_TABLE_ID || process.env.QCLOUD_AUC_CORRECT_TABLE_ID || '',
    correctTableName: process.env.DOUBAO_AUC_CORRECT_TABLE_NAME || process.env.QCLOUD_AUC_CORRECT_TABLE_NAME || '',
    corpusContext: process.env.DOUBAO_AUC_CORPUS_CONTEXT || process.env.QCLOUD_AUC_CORPUS_CONTEXT || '',
    startSec: 300,
    durationSec: 60,
    pollIntervalMs: 2000,
    maxAttempts: 60,
    localDrainTimeoutMs: 60000,
    hardwareProvider: 'auto',
    hardwareRuns: 1,
    alignmentSearchSec: 30,
    alignmentSearchStepSec: 5,
    cerThreshold: DEFAULT_CER_THRESHOLD,
    keywordRecallThreshold: DEFAULT_KEYWORD_RECALL_THRESHOLD,
    includePrivateText: false,
    prepareOnly: false,
    preparedOutputDir: '',
    reportOutput: '',
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
    if (arg === '--provider') {
      opts.provider = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--parameter-group') {
      opts.parameterGroup = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--segmentation-mode') {
      opts.segmentationMode = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--segment-duration-sec') {
      opts.segmentDurationSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--overlap-sec') {
      opts.overlapSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--pre-roll-sec') {
      opts.preRollSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--post-roll-sec') {
      opts.postRollSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--sensevoice-term-correction') {
      opts.sensevoiceTermCorrection = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--sensevoice-term') {
      const value = String(argv[++index] ?? '');
      const separator = value.indexOf('=');
      if (separator <= 0) throw new Error('--sensevoice-term must use canonical=variant1|variant2');
      const canonical = value.slice(0, separator).trim();
      const variants = value.slice(separator + 1).split('|').map((item) => item.trim()).filter(Boolean);
      opts.sensevoiceTerms.push({ canonical, variants });
      continue;
    }
    if (arg === '--local-channel-profile') {
      opts.localChannelProfile = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--preprocessing-profile') {
      opts.preprocessingProfile = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--normalization-frame-ms') {
      opts.normalizationFrameMs = Number(argv[++index]);
      continue;
    }
    if (arg === '--boosting-table-id') {
      opts.boostingTableId = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--boosting-table-name') {
      opts.boostingTableName = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--correct-table-id') {
      opts.correctTableId = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--correct-table-name') {
      opts.correctTableName = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--corpus-context') {
      opts.corpusContext = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--industrial-corpus-context') {
      opts.corpusContext = INDUSTRIAL_CORPUS_CONTEXT;
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
    if (arg === '--local-drain-timeout-ms') {
      opts.localDrainTimeoutMs = Number(argv[++index]);
      continue;
    }
    if (arg === '--hardware-provider') {
      opts.hardwareProvider = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--hardware-runs') {
      opts.hardwareRuns = Number(argv[++index]);
      continue;
    }
    if (arg === '--alignment-search-sec') {
      opts.alignmentSearchSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--alignment-search-step-sec') {
      opts.alignmentSearchStepSec = Number(argv[++index]);
      continue;
    }
    if (arg === '--cer-threshold') {
      opts.cerThreshold = Number(argv[++index]);
      continue;
    }
    if (arg === '--keyword-recall-threshold') {
      opts.keywordRecallThreshold = Number(argv[++index]);
      continue;
    }
    if (arg === '--include-private-text') {
      opts.includePrivateText = true;
      continue;
    }
    if (arg === '--prepare-only') {
      opts.prepareOnly = true;
      continue;
    }
    if (arg === '--prepared-output-dir') {
      opts.preparedOutputDir = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--report-output') {
      opts.reportOutput = String(argv[++index] ?? '');
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!ENTRY_PATTERN.test(opts.entry)) {
    throw new Error('--entry must match sales-real-001 style ids');
  }
  if (!PROVIDERS.has(opts.provider)) {
    throw new Error('--provider must be qcloud-auc, direct-doubao-auc, or local-sensevoice');
  }
  if (!QLOUD_PARAMETER_GROUPS.has(opts.parameterGroup)) {
    throw new Error(`--parameter-group must be one of: ${[...QLOUD_PARAMETER_GROUPS].join(', ')}`);
  }
  if (!SEGMENTATION_MODES.has(opts.segmentationMode)) {
    throw new Error('--segmentation-mode must be full, chunks, or overlap');
  }
  if (!['off', 'industrial'].includes(opts.sensevoiceTermCorrection)) {
    throw new Error('--sensevoice-term-correction must be off or industrial');
  }
  if (!['mic', 'system'].includes(opts.localChannelProfile)) {
    throw new Error('--local-channel-profile must be mic or system');
  }
  if (!['baseline', 'soxr', 'fixed-frame-system-normalized'].includes(opts.preprocessingProfile)) {
    throw new Error('--preprocessing-profile must be baseline, soxr, or fixed-frame-system-normalized');
  }
  if (!Number.isInteger(opts.normalizationFrameMs) || opts.normalizationFrameMs < 20 || opts.normalizationFrameMs > 500) {
    throw new Error('--normalization-frame-ms must be an integer between 20 and 500');
  }
  if (!Number.isFinite(opts.startSec) || opts.startSec < 0) {
    throw new Error('--start-sec must be a non-negative number');
  }
  if (!Number.isFinite(opts.durationSec) || opts.durationSec <= 0 || opts.durationSec > 120) {
    throw new Error('--duration-sec must be a number between 1 and 120');
  }
  if (!Number.isFinite(opts.segmentDurationSec) || opts.segmentDurationSec <= 0 || opts.segmentDurationSec > 120) {
    throw new Error('--segment-duration-sec must be a number between 1 and 120');
  }
  if (!Number.isFinite(opts.overlapSec) || opts.overlapSec < 0 || opts.overlapSec >= opts.segmentDurationSec) {
    throw new Error('--overlap-sec must be non-negative and smaller than --segment-duration-sec');
  }
  if (!Number.isFinite(opts.preRollSec) || opts.preRollSec < 0 || opts.preRollSec > 10) {
    throw new Error('--pre-roll-sec must be a number between 0 and 10');
  }
  if (!Number.isFinite(opts.postRollSec) || opts.postRollSec < 0 || opts.postRollSec > 10) {
    throw new Error('--post-roll-sec must be a number between 0 and 10');
  }
  if (!Number.isFinite(opts.pollIntervalMs) || opts.pollIntervalMs < 0) {
    throw new Error('--poll-interval-ms must be a non-negative number');
  }
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts <= 0) {
    throw new Error('--max-attempts must be a positive integer');
  }
  if (!Number.isFinite(opts.localDrainTimeoutMs) || opts.localDrainTimeoutMs <= 0) {
    throw new Error('--local-drain-timeout-ms must be a positive number');
  }
  if (!HARDWARE_PROVIDERS.has(opts.hardwareProvider)) {
    throw new Error('--hardware-provider must be auto, cpu, coreml, or directml');
  }
  if (!Number.isInteger(opts.hardwareRuns) || opts.hardwareRuns < 1 || opts.hardwareRuns > 10) {
    throw new Error('--hardware-runs must be an integer between 1 and 10');
  }
  if (!['auto', 'cpu'].includes(opts.hardwareProvider) && opts.hardwareRuns < 4) {
    throw new Error('candidate hardware benchmarks require --hardware-runs 4 or greater');
  }
  if (!Number.isFinite(opts.alignmentSearchSec) || opts.alignmentSearchSec < 0 || opts.alignmentSearchSec > 300) {
    throw new Error('--alignment-search-sec must be a number between 0 and 300');
  }
  if (!Number.isFinite(opts.alignmentSearchStepSec) || opts.alignmentSearchStepSec <= 0 || opts.alignmentSearchStepSec > 60) {
    throw new Error('--alignment-search-step-sec must be a number between 1 and 60');
  }
  if (!Number.isFinite(opts.cerThreshold) || opts.cerThreshold < 0 || opts.cerThreshold > 1) {
    throw new Error('--cer-threshold must be between 0 and 1');
  }
  if (!Number.isFinite(opts.keywordRecallThreshold) || opts.keywordRecallThreshold < 0 || opts.keywordRecallThreshold > 1) {
    throw new Error('--keyword-recall-threshold must be between 0 and 1');
  }
  if (opts.prepareOnly && !opts.preparedOutputDir) {
    throw new Error('--prepared-output-dir is required with --prepare-only');
  }
  return opts;
}

export function buildClip(inputPath, opts) {
  const outputPath = path.join(os.tmpdir(), `${opts.entry}-benchmark-${Date.now()}-${process.pid}.wav`);
  const ffmpegArgs = [
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
  ];
  if (opts.preprocessingProfile === 'soxr') {
    ffmpegArgs.push('-af', 'aresample=16000:resampler=soxr:precision=28');
  }
  ffmpegArgs.push(
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    outputPath,
  );
  const result = spawnSync('ffmpeg', ffmpegArgs, {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg clip failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  validateGeneratedClip(outputPath);
  return outputPath;
}

function probeAudio(inputPath) {
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'format=format_name:stream=codec_name,sample_rate,channels',
    '-of',
    'json',
    inputPath,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    const stream = parsed.streams?.[0] ?? {};
    return {
      formatName: parsed.format?.format_name ?? null,
      codecName: stream.codec_name ?? null,
      sampleRate: Number(stream.sample_rate) || null,
      channels: Number(stream.channels) || null,
    };
  } catch {
    return null;
  }
}

function validateGeneratedClip(outputPath) {
  const probe = probeAudio(outputPath);
  if (
    !probe
    || probe.codecName !== 'pcm_s16le'
    || probe.sampleRate !== 16000
    || probe.channels !== 1
  ) {
    throw new Error('Generated benchmark clip must be PCM s16le 16 kHz mono WAV');
  }
}

function buildRawPcmFromWav(inputPath, opts) {
  const outputPath = path.join(os.tmpdir(), `${opts.entry}-sensevoice-${Date.now()}-${process.pid}.pcm`);
  const result = spawnSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-f',
    's16le',
    outputPath,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg pcm conversion failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return outputPath;
}

function readAudioDurationSec(inputPath) {
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const parsed = Number(result.stdout.trim());
  return Number.isFinite(parsed) ? Number(parsed.toFixed(3)) : null;
}

function parseTimestampToSec(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function stripTranscriptMarkup(text) {
  return String(text)
    .replace(/(?:^|[\s\n/])(?:说话人\s*\d+|@[\p{L}\p{N}_-]+)\s*/gu, ' ')
    .replace(/\d{1,2}:\d{2}:\d{2}/g, ' ')
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTimedTranscriptSegments(rawText) {
  const source = String(rawText ?? '');
  const timestampRegex = /(?:^|[\s\n/])(?:说话人\s*\d+|@[\p{L}\p{N}_-]+)?\s*(\d{1,2}:\d{2}:\d{2})/gu;
  const matches = [...source.matchAll(timestampRegex)];
  return matches
    .map((match, index) => {
      const startSec = parseTimestampToSec(match[1]);
      if (startSec == null) return null;
      const textStart = match.index + match[0].length;
      const textEnd = index + 1 < matches.length ? matches[index + 1].index : source.length;
      const text = stripTranscriptMarkup(source.slice(textStart, textEnd));
      return { startSec, text };
    })
    .filter((segment) => segment && segment.text.length > 0);
}

export function selectReferenceWindow(segments, opts) {
  const startSec = Number(opts.startSec);
  const endSec = startSec + Number(opts.durationSec);
  if (!Array.isArray(segments) || segments.length === 0) {
    return { status: 'not_timestamped', text: '', segmentCount: 0 };
  }
  const selected = segments.filter((segment, index) => {
    const nextStartSec = index + 1 < segments.length ? segments[index + 1].startSec : segment.startSec + 30;
    return segment.startSec < endSec && nextStartSec > startSec;
  });
  if (selected.length === 0) {
    return { status: 'no_window_match', text: '', segmentCount: 0 };
  }
  return {
    status: 'aligned',
    text: selected.map((segment) => segment.text).join(' '),
    segmentCount: selected.length,
  };
}

function normalizeTranscriptForSttBenchmark(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(?:说话人\s*\d+|@[\p{L}\p{N}_-]+)\s*/gu, '')
    .replace(/\d{1,2}:\d{2}:\d{2}/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function levenshteinDistance(left, right) {
  const a = [...left];
  const b = [...right];
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function hasKeyword(text, keyword) {
  const normalizedText = normalizeTranscriptForSttBenchmark(text);
  const normalizedKeyword = normalizeTranscriptForSttBenchmark(keyword);
  return normalizedKeyword.length > 0 && normalizedText.includes(normalizedKeyword);
}

function collectDomainKeywords(text) {
  return DOMAIN_KEYWORDS.filter((keyword) => hasKeyword(text, keyword));
}

export function compareTranscripts({ referenceText, hypothesisText }) {
  const referenceNormalized = normalizeTranscriptForSttBenchmark(referenceText);
  const hypothesisNormalized = normalizeTranscriptForSttBenchmark(hypothesisText);
  const distance = levenshteinDistance(referenceNormalized, hypothesisNormalized);
  const breakdown = calculateEditBreakdown(referenceNormalized, hypothesisNormalized);
  const referenceChars = referenceNormalized.length;
  const hypothesisChars = hypothesisNormalized.length;
  const characterErrorRate = referenceChars === 0 ? 1 : distance / referenceChars;
  const referenceKeywords = collectDomainKeywords(referenceText);
  const hypothesisKeywords = collectDomainKeywords(hypothesisText);
  const missingKeywords = referenceKeywords.filter((keyword) => !hypothesisKeywords.includes(keyword));
  const keywordRecall = referenceKeywords.length === 0
    ? 1
    : (referenceKeywords.length - missingKeywords.length) / referenceKeywords.length;

  return {
    referenceChars,
    hypothesisChars,
    editDistance: distance,
    insertions: breakdown.insertions,
    deletions: breakdown.deletions,
    substitutions: breakdown.substitutions,
    deletionRate: referenceChars === 0 ? 1 : Number((breakdown.deletions / referenceChars).toFixed(4)),
    insertionRate: referenceChars === 0 ? 1 : Number((breakdown.insertions / referenceChars).toFixed(4)),
    substitutionRate: referenceChars === 0 ? 1 : Number((breakdown.substitutions / referenceChars).toFixed(4)),
    characterErrorRate: Number(characterErrorRate.toFixed(4)),
    similarity: Number(Math.max(0, 1 - characterErrorRate).toFixed(4)),
    lengthRatio: referenceChars === 0 ? 0 : Number((hypothesisChars / referenceChars).toFixed(4)),
    referenceKeywordCount: referenceKeywords.length,
    matchedKeywordCount: referenceKeywords.length - missingKeywords.length,
    keywordRecall: Number(keywordRecall.toFixed(4)),
    missingKeywords,
  };
}

export function dedupeOverlappedTranscript(parts) {
  const filtered = parts.map((part) => String(part ?? '').trim()).filter(Boolean);
  if (filtered.length === 0) return '';
  return filtered.reduce((combined, next) => {
    const left = normalizeTranscriptForSttBenchmark(combined);
    const right = normalizeTranscriptForSttBenchmark(next);
    let overlap = 0;
    const max = Math.min(left.length, right.length, 80);
    for (let size = 8; size <= max; size += 1) {
      if (left.slice(-size) === right.slice(0, size)) overlap = size;
    }
    if (overlap === 0) return `${combined} ${next}`.trim();
    const rightChars = [...next];
    return `${combined} ${rightChars.slice(overlap).join('')}`.trim();
  }, filtered[0]);
}

export function findBestReferenceWindow(segments, opts, hypothesisText) {
  const searchSec = Number(opts.alignmentSearchSec ?? 0);
  const stepSec = Math.max(1, Number(opts.alignmentSearchStepSec ?? 5));
  const offsets = [0];
  for (let offset = -searchSec; offset <= searchSec; offset += stepSec) {
    if (offset !== 0) offsets.push(offset);
  }

  const candidates = offsets
    .map((offsetSec) => {
      const window = selectReferenceWindow(segments, {
        startSec: Math.max(0, Number(opts.startSec) + offsetSec),
        durationSec: opts.durationSec,
      });
      if (window.status !== 'aligned') return null;
      return {
        offsetSec,
        window,
        comparison: compareTranscripts({
          referenceText: window.text,
          hypothesisText,
        }),
      };
    })
    .filter(Boolean);

  const nominalCandidate = candidates.find((candidate) => candidate.offsetSec === 0) ?? null;
  const bestCandidate = candidates.reduce((best, candidate) => {
    if (!best) return candidate;
    if (candidate.comparison.characterErrorRate < best.comparison.characterErrorRate) return candidate;
    if (
      candidate.comparison.characterErrorRate === best.comparison.characterErrorRate
      && candidate.comparison.keywordRecall > best.comparison.keywordRecall
    ) {
      return candidate;
    }
    return best;
  }, null);

  return {
    enabled: searchSec > 0,
    searchSec,
    stepSec,
    candidateCount: candidates.length,
    bestReferenceOffsetSec: bestCandidate?.offsetSec ?? 0,
    nominalComparison: nominalCandidate?.comparison ?? compareTranscripts({ referenceText: '', hypothesisText }),
    bestComparison: bestCandidate?.comparison ?? compareTranscripts({ referenceText: '', hypothesisText }),
  };
}

export function diagnoseSttBenchmark({ comparison, referenceAlignmentStatus, transcriptLength, alignmentSearch }) {
  const causes = [];
  if (referenceAlignmentStatus !== 'aligned') {
    causes.push('reference_alignment_failed');
  }
  if (transcriptLength === 0) {
    causes.push('stt_empty');
  }
  if (comparison.lengthRatio > 0 && comparison.lengthRatio < 0.55) {
    causes.push('stt_under_transcribed_or_clip_mismatch');
  } else if (comparison.lengthRatio > 0 && comparison.lengthRatio < 0.75) {
    causes.push('low_length_ratio');
  }
  if (comparison.lengthRatio > 1.8) {
    causes.push('stt_over_transcribed_or_reference_window_mismatch');
  }
  if (comparison.characterErrorRate > DEFAULT_CER_THRESHOLD) {
    causes.push('high_character_error_rate');
  }
  if (comparison.keywordRecall < DEFAULT_KEYWORD_RECALL_THRESHOLD) {
    causes.push('domain_terms_missed');
  }
  if (
    alignmentSearch
    && Math.abs(alignmentSearch.bestReferenceOffsetSec) >= alignmentSearch.stepSec
    && alignmentSearch.nominalComparison.characterErrorRate - alignmentSearch.bestComparison.characterErrorRate >= 0.15
  ) {
    causes.unshift('audio_reference_offset_suspected');
  }
  if (causes.length === 0) {
    causes.push('no_major_quality_gap_detected');
  }

  const summary = causes.includes('no_major_quality_gap_detected')
    ? '当前时间窗内，我们的 STT 与第三方转录在字符相似度和领域关键词召回上没有明显质量差距。'
    : '当前时间窗内存在 STT 质量差距；优先检查时间窗对齐、漏转/少转、领域词识别和网关返回稳定性。';

  return { causes, summary };
}

async function readDocxText(docxPath) {
  const result = await mammoth.extractRawText({ path: docxPath });
  return result.value || '';
}

function buildCorpusConfig(opts) {
  const corpus = {};
  if (opts.boostingTableId) corpus.boosting_table_id = opts.boostingTableId;
  if (opts.boostingTableName) corpus.boosting_table_name = opts.boostingTableName;
  if (opts.correctTableId) corpus.correct_table_id = opts.correctTableId;
  if (opts.correctTableName) corpus.correct_table_name = opts.correctTableName;
  if (opts.corpusContext) corpus.context = opts.corpusContext;
  return corpus;
}

function summarizeCorpusConfig(corpus) {
  return {
    hasBoostingTableId: !!corpus.boosting_table_id,
    hasBoostingTableName: !!corpus.boosting_table_name,
    hasCorrectTableId: !!corpus.correct_table_id,
    hasCorrectTableName: !!corpus.correct_table_name,
    hasContext: !!corpus.context,
    contextCharLength: corpus.context ? String(corpus.context).length : 0,
  };
}

function getQcloudParameterFields(parameterGroup, opts = {}) {
  const fields = {
    model: 'bigmodel',
    enable_speaker_info: 'true',
    enable_emotion_detection: 'true',
    show_utterances: 'true',
    enable_itn: 'true',
  };
  const status = {
    model: 'accepted',
    enable_speaker_info: 'accepted',
    enable_emotion_detection: 'accepted',
    show_utterances: 'accepted',
    enable_itn: 'accepted',
  };
  const extra = [];

  function add(name, value) {
    fields[name] = value;
    status[name] = 'ignored_or_unconfirmed';
    extra.push(name);
  }

  if (parameterGroup === 'qcloud-current-plus-punc') add('enable_punc', 'true');
  if (parameterGroup === 'qcloud-current-plus-vad') add('vad_segment', 'true');
  if (parameterGroup === 'qcloud-current-plus-punc-vad') {
    add('enable_punc', 'true');
    add('vad_segment', 'true');
  }
  if (parameterGroup === 'qcloud-current-plus-ssd') add('ssd_version', '200');
  if (parameterGroup === 'qcloud-direct-aligned') {
    add('enable_punc', 'true');
    add('vad_segment', 'true');
    add('enable_ddc', 'false');
    add('ssd_version', '200');
  }

  const corpus = buildCorpusConfig(opts);
  for (const [key, value] of Object.entries(corpus)) {
    fields[key] = String(value);
    status[key] = 'ignored_or_unconfirmed';
    extra.push(key);
  }

  return {
    fields,
    gatewayFieldStatus: status,
    unsupportedFields: [],
    ignoredOrUnconfirmedFields: extra,
    corpusConfig: summarizeCorpusConfig(corpus),
  };
}

function buildDoubaoVocabularyTableDiagnostics(opts, providerResult) {
  const sentFields = [];
  if (opts.boostingTableId) sentFields.push('boosting_table_id');
  if (opts.boostingTableName) sentFields.push('boosting_table_name');
  if (opts.correctTableId) sentFields.push('correct_table_id');
  if (opts.correctTableName) sentFields.push('correct_table_name');

  return {
    boostingTableId: opts.boostingTableId ? '[configured]' : null,
    boostingTableName: opts.boostingTableName ? '[configured]' : null,
    correctTableId: opts.correctTableId ? '[configured]' : null,
    correctTableName: opts.correctTableName ? '[configured]' : null,
    providerAcceptedFields: providerResult?.gatewayFieldStatus
      ? Object.entries(providerResult.gatewayFieldStatus)
        .filter(([, status]) => status === 'accepted')
        .map(([field]) => field)
      : [],
    ignoredOrUnconfirmedFields: providerResult?.ignoredOrUnconfirmedFields || [],
    providerErrorCode: providerResult?.providerErrorCode || null,
    sentFields,
  };
}

async function importAucClient() {
  const aucClientPath = path.join(root, 'dist-electron/electron/audio/doubaoAucClient.js');
  if (!fs.existsSync(aucClientPath)) {
    throw new Error('Missing dist-electron STT files. Run npm run build:electron first.');
  }
  return import(pathToFileURL(aucClientPath).href);
}

export async function transcribeClipWithQcloud({
  clipPath,
  entry,
  opts,
  apiKey,
  onPhase,
  dependencies = {},
}) {
  const constantsPath = path.join(root, 'dist-electron/electron/llm/QCloudLlmConstants.js');
  if (!dependencies.constants && !fs.existsSync(constantsPath)) {
    throw new Error('Missing dist-electron QCLOUD constants. Run npm run build:electron first.');
  }

  const {
    extractDoubaoAucTranscript,
    transcribeNewApiDoubaoAucMultipartFile,
  } = dependencies.aucClient ?? await importAucClient();
  const {
    QCLOUD_STT_QUERY_ENDPOINT,
    QCLOUD_STT_SUBMIT_ENDPOINT,
  } = dependencies.constants ?? await import(pathToFileURL(constantsPath).href);

  const post = dependencies.post ?? (async (url, body, options) => {
    const response = await axios.post(url, body, {
      headers: options.headers,
      timeout: options.timeout,
      validateStatus: () => true,
    });
    if (response.status >= 400) {
      const err = new Error(`QCLOUD API STT HTTP ${response.status}`);
      err.providerErrorCode = String(response.status);
      err.providerErrorType = 'http_error';
      throw err;
    }
    return { data: response.data, headers: response.headers };
  });

  const audioBuffer = dependencies.audioBuffer ?? fs.readFileSync(clipPath);
  const parameterConfig = getQcloudParameterFields(opts.parameterGroup, opts);
  const text = await transcribeNewApiDoubaoAucMultipartFile({
    submitEndpoint: QCLOUD_STT_SUBMIT_ENDPOINT,
    queryEndpoint: QCLOUD_STT_QUERY_ENDPOINT,
    authHeader: { Authorization: `Bearer ${apiKey.trim()}` },
    audioBuffer,
    filename: `${entry}-benchmark-clip.wav`,
    contentType: 'audio/wav',
    formFields: parameterConfig.fields,
    extractTranscript: extractDoubaoAucTranscript,
    post,
    pollIntervalMs: opts.pollIntervalMs,
    maxAttempts: opts.maxAttempts,
    onPhase,
  });

  return { text, providerConfig: parameterConfig };
}

async function transcribeClipWithDirectDoubao({ clipPath, opts, apiKey }) {
  const {
    extractDoubaoAucTranscript,
    transcribeDoubaoAucFile,
  } = await importAucClient();

  async function post(url, body, options) {
    const response = await axios.post(url, body, {
      headers: options.headers,
      timeout: options.timeout,
      validateStatus: () => true,
    });
    if (response.status >= 400) {
      const err = new Error(`Direct Doubao AUC HTTP ${response.status}`);
      err.providerErrorCode = String(response.status);
      err.providerErrorType = 'http_error';
      throw err;
    }
    return { data: response.data, headers: response.headers };
  }

  const audioBase64 = fs.readFileSync(clipPath).toString('base64');
  const requestBody = {
    user: { uid: 'cueup-local-stt-benchmark' },
    audio: {
      data: audioBase64,
      format: 'wav',
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
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
  const corpus = buildCorpusConfig(opts);
  if (Object.keys(corpus).length > 0) {
    requestBody.request.corpus = corpus;
  }

  const text = await transcribeDoubaoAucFile({
    submitEndpoint: DIRECT_DOUBAO_SUBMIT_ENDPOINT,
    queryEndpoint: DIRECT_DOUBAO_QUERY_ENDPOINT,
    authHeader: {
      'X-Api-Key': apiKey.trim(),
      'X-Api-Resource-Id': 'volc.seedasr.auc',
    },
    requestBody,
    extractTranscript: extractDoubaoAucTranscript,
    post,
    pollIntervalMs: opts.pollIntervalMs,
    maxAttempts: opts.maxAttempts,
  });

  return {
    text,
    providerConfig: {
      gatewayFieldStatus: {},
      unsupportedFields: [],
      ignoredOrUnconfirmedFields: [],
      directRequestShape: 'doubao-auc-json-bigmodel',
      corpusConfig: summarizeCorpusConfig(corpus),
    },
  };
}

function resolveSenseVoiceModelsDir() {
  return process.env.SENSEVOICE_MODELS_DIR
    || path.join(os.homedir(), 'Library/Application Support/natively/sensevoice-models');
}

function buildSenseVoiceTermCorrection(opts) {
  const defaultTermsPath = path.join(root, 'dist-electron/electron/audio/sensevoice/defaultTermCorrections.js');
  const { DEFAULT_SENSEVOICE_TERM_CORRECTIONS, mergeSenseVoiceTermCorrections } = require(defaultTermsPath);
  const explicitTerms = opts.sensevoiceTerms.map((term, index) => ({
    id: `custom-${index}`,
    canonical: term.canonical,
    variants: term.variants,
    enabled: true,
  }));
  if (opts.sensevoiceTermCorrection === 'industrial') {
    const terms = mergeSenseVoiceTermCorrections(explicitTerms);
    return { enabled: terms.length > 0, terms };
  }
  const terms = explicitTerms.length > 0 ? explicitTerms : [];
  void DEFAULT_SENSEVOICE_TERM_CORRECTIONS;
  return { enabled: terms.length > 0, terms };
}

function countOccurrences(text, needle) {
  if (!text || !needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = String(text).indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function countSenseVoiceCorrectionHits(rawText, correctedText, terms) {
  const hits = [];
  for (const term of terms) {
    for (const variant of term.variants || []) {
      const rawCount = countOccurrences(rawText, variant);
      const correctedCount = countOccurrences(correctedText, term.canonical);
      const count = Math.min(rawCount, correctedCount);
      if (count > 0) {
        hits.push({ canonical: term.canonical, variant, count });
      }
    }
  }
  return hits;
}

function summarizeSenseVoiceCorrectionDiagnostics({ correctionConfig, rawText, correctedText, referenceText }) {
  const hits = rawText
    ? countSenseVoiceCorrectionHits(rawText, correctedText, correctionConfig.terms)
    : [];
  const rawComparison = rawText && referenceText
    ? compareTranscripts({ referenceText, hypothesisText: rawText })
    : null;
  const correctedComparison = rawText && referenceText
    ? compareTranscripts({ referenceText, hypothesisText: correctedText })
    : null;

  return {
    enabled: correctionConfig.enabled,
    ruleCount: correctionConfig.terms.length,
    correctionHitCount: hits.reduce((sum, hit) => sum + hit.count, 0),
    hits,
    rawComparison,
    correctedComparison,
    cerDelta: rawComparison && correctedComparison
      ? Number((correctedComparison.characterErrorRate - rawComparison.characterErrorRate).toFixed(4))
      : null,
    keywordRecallDelta: rawComparison && correctedComparison
      ? Number((correctedComparison.keywordRecall - rawComparison.keywordRecall).toFixed(4))
      : null,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildConfigurationFingerprint(opts, correctionConfig) {
  const canonical = {
    provider: opts.provider,
    parameterGroup: opts.parameterGroup,
    boostingTableId: String(opts.boostingTableId ?? '').trim(),
    boostingTableName: String(opts.boostingTableName ?? '').trim(),
    correctTableId: String(opts.correctTableId ?? '').trim(),
    correctTableName: String(opts.correctTableName ?? '').trim(),
    sensevoiceTermCorrection: opts.sensevoiceTermCorrection,
    sensevoiceTerms: correctionConfig.terms.map((term) => ({
      canonical: term.canonical,
      variants: term.variants ?? [],
      enabled: term.enabled !== false,
    })),
    localChannelProfile: opts.localChannelProfile,
    preprocessingProfile: opts.preprocessingProfile,
    normalizationFrameMs: opts.normalizationFrameMs,
    hardwareProvider: opts.hardwareProvider,
    hardwareRuns: opts.hardwareRuns,
  };
  return createHash('sha256').update(stableJson(canonical)).digest('hex');
}

function buildBenchmarkConfiguration(opts, correctionConfig) {
  return {
    provider: opts.provider,
    parameterGroup: opts.parameterGroup,
    hasBoostingTableId: Boolean(opts.boostingTableId),
    hasBoostingTableName: Boolean(opts.boostingTableName),
    hasCorrectTableId: Boolean(opts.correctTableId),
    hasCorrectTableName: Boolean(opts.correctTableName),
    sensevoiceTermCorrection: opts.sensevoiceTermCorrection,
    sensevoiceTermCount: correctionConfig.terms.length,
    localChannelProfile: opts.localChannelProfile,
    preprocessingProfile: opts.preprocessingProfile,
    normalizationFrameMs: opts.normalizationFrameMs,
    hardwareProvider: opts.hardwareProvider,
    hardwareRuns: opts.hardwareRuns,
    configurationFingerprint: buildConfigurationFingerprint(opts, correctionConfig),
  };
}

export function buildBenchmarkConfigurationForProvider(opts, correctionConfig = null) {
  return buildBenchmarkConfiguration(opts, correctionConfig ?? { enabled: false, terms: [] });
}

async function transcribeLocalSenseVoiceRuns({
  LocalSenseVoiceSTT,
  modelFiles,
  clipPath,
  opts,
  termCorrection,
  runCount,
}) {
  const pcmPath = buildRawPcmFromWav(clipPath, opts);
  let peakRssBytes = process.memoryUsage().rss;
  const rssSampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 10);
  const channelProfiles = {
    mic: { channel: 'mic', vadOptions: { hangoverFrames: 30, minSpeechFrames: 4 } },
    system: { channel: 'system', vadOptions: { rmsThreshold: 0.004, hangoverFrames: 30, minSpeechFrames: 4 } },
  };
  const channelProfile = channelProfiles[opts.localChannelProfile] ?? channelProfiles.system;
  const stt = new LocalSenseVoiceSTT({
    modelFiles,
    termCorrection,
    vadOptions: channelProfile.vadOptions,
    ...(opts.hardwareProvider !== 'auto' ? {
      providerPlan: {
        requestedProviders: [opts.hardwareProvider],
        fallbackProvider: opts.hardwareProvider === 'cpu' ? null : 'cpu',
        cacheConfig: { enabled: false },
        diagnosticLabel: `benchmark-${opts.hardwareProvider}`,
        benchmarkRequired: opts.hardwareProvider !== 'cpu',
      },
    } : {}),
  });
  let activeRun = null;
  try {
    stt.setSampleRate(16000);
    stt.setAudioChannelCount(1);
    stt.setRecognitionLanguage('chinese');
    stt.setChannel(channelProfile.channel);
    stt.on('transcript', (segment) => {
      if (segment?.text && activeRun) {
        if (activeRun.firstTranscriptMs === null) {
          activeRun.firstTranscriptMs = performance.now() - activeRun.startedAt;
        }
        activeRun.transcriptParts.push(segment.text);
      }
    });
    stt.on('error', (error) => {
      if (activeRun) activeRun.errors.push('inference_error');
    });
    stt.start();

    const raw = fs.readFileSync(pcmPath);
    const chunkBytes = 32000;
    const audioDurationSec = readAudioDurationSec(clipPath) ?? opts.durationSec;
    const runs = [];
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      activeRun = {
        startedAt: performance.now(),
        firstTranscriptMs: null,
        transcriptParts: [],
        errors: [],
      };
      for (let offset = 0; offset < raw.length; offset += chunkBytes) {
        stt.write(raw.subarray(offset, Math.min(raw.length, offset + chunkBytes)));
        await new Promise(resolve => setImmediate(resolve));
      }
      stt.notifySpeechEnded();
      stt.finalize();
      await stt.drainFinals(opts.localDrainTimeoutMs);

      if (activeRun.errors.length > 0 && activeRun.transcriptParts.length === 0) {
        const err = new Error('Local SenseVoice inference failed');
        err.providerErrorType = 'local_sensevoice_error';
        throw err;
      }
      const elapsedMs = performance.now() - activeRun.startedAt;
      const hardware = stt.getHardwareDiagnostics();
      runs.push({
        text: activeRun.transcriptParts.join(' '),
        providerRequested: hardware.providerRequested ?? opts.hardwareProvider,
        providerActual: hardware.providerActual ?? null,
        fallbackReason: hardware.fallbackReason ?? null,
        initializationMs: runIndex === 0 ? hardware.initializationMs ?? null : null,
        firstTranscriptMs: activeRun.firstTranscriptMs,
        peakRssBytes,
        rtf: audioDurationSec > 0 ? Number((elapsedMs / 1000 / audioDurationSec).toFixed(4)) : null,
        error: activeRun.errors[0] ?? null,
      });
    }
    return runs;
  } finally {
    activeRun = null;
    stt.stop();
    clearInterval(rssSampler);
    fs.rmSync(pcmPath, { force: true });
  }
}

async function transcribeClipWithLocalSenseVoice({ clipPath, opts }) {
  const sttPath = path.join(root, 'dist-electron/electron/audio/sensevoice/LocalSenseVoiceSTT.js');
  const modelManagerPath = path.join(root, 'dist-electron/electron/audio/sensevoice/modelManager.js');
  const providerPolicyPath = path.join(root, 'dist-electron/electron/audio/hardwareProviderPolicy.js');
  if (!fs.existsSync(sttPath) || !fs.existsSync(modelManagerPath) || !fs.existsSync(providerPolicyPath)) {
    throw new Error('Missing dist-electron Local SenseVoice files. Run npm run build:electron first.');
  }

  const modelManager = await import(pathToFileURL(modelManagerPath).href);
  const modelsDir = resolveSenseVoiceModelsDir();
  if (!modelManager.isSenseVoiceModelCached(undefined, modelsDir)) {
    return {
      blocked: true,
      environmentStatus: 'blocked_missing_local_sensevoice_model',
      reason: 'Local SenseVoice model is not available',
      localModelStatus: 'missing',
      providerConfig: {
        termCorrectionEnabled: opts.sensevoiceTermCorrection !== 'off' || opts.sensevoiceTerms.length > 0,
        termCorrectionMode: opts.sensevoiceTermCorrection,
        customTermCount: opts.sensevoiceTerms.length,
        localChannelProfile: opts.localChannelProfile,
        preprocessingProfile: opts.preprocessingProfile,
        normalizationFrameMs: opts.normalizationFrameMs,
        benchmarkConfiguration: buildBenchmarkConfigurationForProvider(opts),
        modelsDirConfigured: true,
      },
    };
  }

  const { LocalSenseVoiceSTT } = await import(pathToFileURL(sttPath).href);
  const { evaluateLocalSttHardwareBenchmark } = await import(pathToFileURL(providerPolicyPath).href);
  const modelFiles = modelManager.resolveSenseVoiceModelFiles(undefined, modelsDir);
  const correctionConfig = buildSenseVoiceTermCorrection(opts);
  const needsRawComparison = correctionConfig.enabled && correctionConfig.terms.length > 0;
  const rawRun = needsRawComparison
    ? (await transcribeLocalSenseVoiceRuns({
      LocalSenseVoiceSTT,
      modelFiles,
      clipPath,
      opts,
      termCorrection: { enabled: false, terms: [] },
      runCount: 1,
    }))[0]
    : null;
  const isCandidateBenchmark = !['auto', 'cpu'].includes(opts.hardwareProvider);
  const cpuRuns = isCandidateBenchmark
    ? await transcribeLocalSenseVoiceRuns({
      LocalSenseVoiceSTT,
      modelFiles,
      clipPath,
      opts: { ...opts, hardwareProvider: 'cpu' },
      termCorrection: correctionConfig,
      runCount: opts.hardwareRuns,
    })
    : null;
  const hardwareRuns = await transcribeLocalSenseVoiceRuns({
    LocalSenseVoiceSTT,
    modelFiles,
    clipPath,
    opts,
    termCorrection: correctionConfig,
    runCount: opts.hardwareRuns,
  });
  const correctedRun = hardwareRuns[hardwareRuns.length - 1];
  const rawText = rawRun?.text ?? null;
  const correctedText = correctedRun.text;
  const cpuComparison = cpuRuns
    ? compareTranscripts({
      referenceText: opts.__referenceTextForCorrectionDiagnostics || '',
      hypothesisText: cpuRuns[cpuRuns.length - 1].text,
    })
    : null;
  const candidateComparison = isCandidateBenchmark
    ? compareTranscripts({
      referenceText: opts.__referenceTextForCorrectionDiagnostics || '',
      hypothesisText: correctedText,
    })
    : null;
  const hardwareDecision = cpuRuns && cpuComparison && candidateComparison
    ? evaluateLocalSttHardwareBenchmark({
      cpuRuns: cpuRuns.slice(1).map((run) => ({ rtf: run.rtf, error: run.error })),
      candidateRuns: hardwareRuns.slice(1).map((run) => ({
        rtf: run.rtf,
        error: run.error
          ?? (run.providerActual === opts.hardwareProvider ? null : 'provider_unverified_or_fallback'),
      })),
      cpuQuality: {
        characterErrorRate: cpuComparison.characterErrorRate,
        keywordRecall: cpuComparison.keywordRecall,
      },
      candidateQuality: {
        characterErrorRate: candidateComparison.characterErrorRate,
        keywordRecall: candidateComparison.keywordRecall,
      },
    })
    : null;

  return {
    text: correctedText,
    rawTextForCorrectionDiagnostics: rawText,
    correctedTextForCorrectionDiagnostics: correctedText,
    hardwareBenchmark: {
      providerRequested: correctedRun.providerRequested,
      providerActual: correctedRun.providerActual,
      fallbackReason: correctedRun.fallbackReason,
      initializationMs: hardwareRuns[0].initializationMs,
      firstTranscriptMs: correctedRun.firstTranscriptMs,
      peakRssBytes: Math.max(...hardwareRuns.map((run) => run.peakRssBytes)),
      rtf: correctedRun.rtf,
      runs: hardwareRuns.map((run, index) => ({
        phase: index === 0 ? 'cold' : 'warm',
        providerActual: run.providerActual,
        initializationMs: run.initializationMs,
        firstTranscriptMs: run.firstTranscriptMs,
        peakRssBytes: run.peakRssBytes,
        rtf: run.rtf,
        error: run.error,
      })),
      cpuBaseline: cpuRuns ? {
        providerActual: cpuRuns[cpuRuns.length - 1].providerActual,
        initializationMs: cpuRuns[0].initializationMs,
        peakRssBytes: Math.max(...cpuRuns.map((run) => run.peakRssBytes)),
        quality: {
          characterErrorRate: cpuComparison.characterErrorRate,
          keywordRecall: cpuComparison.keywordRecall,
        },
        runs: cpuRuns.map((run, index) => ({
          phase: index === 0 ? 'cold' : 'warm',
          firstTranscriptMs: run.firstTranscriptMs,
          rtf: run.rtf,
          error: run.error,
        })),
      } : null,
      quality: candidateComparison ? {
        characterErrorRate: candidateComparison.characterErrorRate,
        keywordRecall: candidateComparison.keywordRecall,
      } : null,
      decision: hardwareDecision,
    },
    termCorrectionDiagnostics: needsRawComparison
      ? summarizeSenseVoiceCorrectionDiagnostics({
        correctionConfig,
        rawText,
        correctedText,
        referenceText: opts.__referenceTextForCorrectionDiagnostics || '',
      })
      : null,
    localModelStatus: 'available',
    providerConfig: {
      termCorrectionEnabled: opts.sensevoiceTermCorrection !== 'off' || opts.sensevoiceTerms.length > 0,
      termCorrectionMode: opts.sensevoiceTermCorrection,
      customTermCount: opts.sensevoiceTerms.length,
      localChannelProfile: opts.localChannelProfile,
      preprocessingProfile: opts.preprocessingProfile,
      normalizationFrameMs: opts.normalizationFrameMs,
      benchmarkConfiguration: buildBenchmarkConfigurationForProvider(opts, correctionConfig),
      modelsDirConfigured: true,
      modelFile: path.basename(modelFiles.modelFile),
    },
  };
}

async function transcribeClip({ clipPath, entry, opts }) {
  if (opts.provider === 'qcloud-auc') {
    const apiKey = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      return {
        blocked: true,
        environmentStatus: 'blocked_missing_qcloud_credentials',
        reason: 'Missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY for QCLOUD AUC benchmark.',
      };
    }
    return transcribeClipWithQcloud({ clipPath, entry, opts, apiKey });
  }

  if (opts.provider === 'direct-doubao-auc') {
    const apiKey = process.env.DOUBAO_AUC_API_KEY || process.env.DOUBAO_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      return {
        blocked: true,
        environmentStatus: 'blocked_missing_direct_doubao_credentials',
        reason: 'Missing DOUBAO_AUC_API_KEY or DOUBAO_API_KEY for direct Doubao AUC benchmark.',
      };
    }
    return transcribeClipWithDirectDoubao({ clipPath, opts, apiKey });
  }

  return transcribeClipWithLocalSenseVoice({ clipPath, opts });
}

function makeWindowOpts(opts, startSec, durationSec) {
  return {
    ...opts,
    startSec,
    durationSec,
  };
}

async function loadSegmentationHelper() {
  const helperPath = path.join(root, 'dist-electron/electron/audio/SttSegmentation.js');
  if (!fs.existsSync(helperPath)) {
    throw new Error('Missing compiled SttSegmentation helper. Run npm run build:electron first.');
  }
  return import(pathToFileURL(helperPath).href);
}

function createSegments(opts) {
  if (opts.segmentationMode === 'full') {
    return [{ startSec: opts.startSec, durationSec: opts.durationSec }];
  }
  const segments = [];
  const step = opts.segmentationMode === 'overlap'
    ? opts.segmentDurationSec - opts.overlapSec
    : opts.segmentDurationSec;
  const endSec = opts.startSec + opts.durationSec;
  for (let start = opts.startSec; start < endSec; start += step) {
    const duration = Math.min(opts.segmentDurationSec, endSec - start);
    if (duration <= 0) break;
    segments.push({ startSec: start, durationSec: duration });
  }
  return segments;
}

async function transcribeWindowSet({ audioPath, entry, opts, referenceWindow }) {
  const segmentationHelper = await loadSegmentationHelper();
  const benchmarkOpts = {
    ...opts,
    __referenceTextForCorrectionDiagnostics: referenceWindow.text,
  };
  const plan = segmentationHelper.buildSttSegmentPlan({
    mode: benchmarkOpts.segmentationMode,
    sourceStartSec: benchmarkOpts.startSec,
    sourceDurationSec: benchmarkOpts.durationSec,
    segmentDurationSec: benchmarkOpts.segmentationMode === 'full' ? benchmarkOpts.durationSec : benchmarkOpts.segmentDurationSec,
    overlapSec: benchmarkOpts.segmentationMode === 'overlap' ? benchmarkOpts.overlapSec : 0,
    preRollSec: benchmarkOpts.segmentationMode === 'full' ? 0 : benchmarkOpts.preRollSec,
    postRollSec: benchmarkOpts.segmentationMode === 'full' ? 0 : benchmarkOpts.postRollSec,
  });
  const segments = plan.segments;
  const results = [];
  const segmentTranscripts = [];

  for (const segment of segments) {
    const segmentOpts = makeWindowOpts(benchmarkOpts, segment.audioStartSec, segment.audioDurationSec);
    const clipPath = buildClip(audioPath, segmentOpts);
    const startedAt = Date.now();
    try {
      const providerResult = await transcribeClip({ clipPath, entry, opts: segmentOpts });
      if (providerResult.blocked) {
        return {
          blocked: true,
          ...providerResult,
          segments: results,
        };
      }
      const normalizedText = normalizeTranscriptForSttBenchmark(providerResult.text);
      const transcribeLatencyMs = Date.now() - startedAt;
      segmentTranscripts.push({
        segmentId: segment.id,
        provider: opts.provider,
        text: providerResult.text || '',
        normalizedText,
        transcribeLatencyMs,
        providerStatus: 'ok',
      });
      results.push({
        segmentId: segment.id,
        startSec: segment.startSec,
        durationSec: segment.durationSec,
        audioStartSec: segment.audioStartSec,
        audioDurationSec: segment.audioDurationSec,
        transcribeLatencyMs,
        text: providerResult.text,
        rawChars: String(providerResult.text ?? '').length,
        normalizedChars: normalizedText.length,
        providerConfig: providerResult.providerConfig,
        localModelStatus: providerResult.localModelStatus,
        rawTextForCorrectionDiagnostics: providerResult.rawTextForCorrectionDiagnostics,
        correctedTextForCorrectionDiagnostics: providerResult.correctedTextForCorrectionDiagnostics,
        termCorrectionDiagnostics: providerResult.termCorrectionDiagnostics,
        hardwareBenchmark: providerResult.hardwareBenchmark,
      });
    } catch {
      const transcribeLatencyMs = Date.now() - startedAt;
      segmentTranscripts.push({
        segmentId: segment.id,
        provider: opts.provider,
        text: '',
        normalizedText: '',
        transcribeLatencyMs,
        providerStatus: 'failed',
      });
      results.push({
        segmentId: segment.id,
        startSec: segment.startSec,
        durationSec: segment.durationSec,
        audioStartSec: segment.audioStartSec,
        audioDurationSec: segment.audioDurationSec,
        transcribeLatencyMs,
        providerStatus: 'failed',
        reason: 'partial_segment_failure',
        rawChars: 0,
        normalizedChars: 0,
      });
    } finally {
      fs.rmSync(clipPath, { force: true });
    }
  }

  const rawText = segmentationHelper.mergeSegmentTranscripts(segmentTranscripts);
  const dedupedText = opts.segmentationMode === 'overlap'
    ? segmentationHelper.dedupeOverlappedTranscript(segmentTranscripts.map((segment) => segment.normalizedText))
    : rawText;
  const text = opts.segmentationMode === 'full' ? rawText : dedupedText;
  const firstConfig = results.find((segment) => segment.providerConfig)?.providerConfig ?? {};
  const localModelStatus = results.find((segment) => segment.localModelStatus)?.localModelStatus;
  const hardwareBenchmark = results.find((segment) => segment.hardwareBenchmark)?.hardwareBenchmark ?? null;
  const correctionParts = results.filter((segment) => segment.termCorrectionDiagnostics);
  const termCorrectionDiagnostics = correctionParts.length > 0
    ? summarizeSenseVoiceCorrectionDiagnostics({
      correctionConfig: {
        enabled: true,
        terms: [],
      },
      rawText: segmentationHelper.mergeSegmentTranscripts(correctionParts.map((segment) => ({
        segmentId: segment.segmentId,
        provider: opts.provider,
        text: segment.rawTextForCorrectionDiagnostics || '',
        normalizedText: normalizeTranscriptForSttBenchmark(segment.rawTextForCorrectionDiagnostics || ''),
        transcribeLatencyMs: segment.transcribeLatencyMs,
        providerStatus: 'ok',
      }))),
      correctedText: segmentationHelper.mergeSegmentTranscripts(correctionParts.map((segment) => ({
        segmentId: segment.segmentId,
        provider: opts.provider,
        text: segment.correctedTextForCorrectionDiagnostics || '',
        normalizedText: normalizeTranscriptForSttBenchmark(segment.correctedTextForCorrectionDiagnostics || ''),
        transcribeLatencyMs: segment.transcribeLatencyMs,
        providerStatus: 'ok',
      }))),
      referenceText: referenceWindow.text,
    })
    : null;
  if (termCorrectionDiagnostics) {
    const diagnostics = correctionParts.map((segment) => segment.termCorrectionDiagnostics);
    const hitMap = new Map();
    for (const diagnostic of diagnostics) {
      for (const hit of diagnostic.hits || []) {
        const key = `${hit.canonical}\u0000${hit.variant}`;
        const existing = hitMap.get(key) || { canonical: hit.canonical, variant: hit.variant, count: 0 };
        existing.count += hit.count;
        hitMap.set(key, existing);
      }
    }
    termCorrectionDiagnostics.ruleCount = Math.max(...diagnostics.map((diagnostic) => diagnostic.ruleCount || 0));
    termCorrectionDiagnostics.hits = [...hitMap.values()];
    termCorrectionDiagnostics.correctionHitCount = termCorrectionDiagnostics.hits.reduce((sum, hit) => sum + hit.count, 0);
  }
  const rawComparison = compareTranscripts({
    referenceText: referenceWindow.text,
    hypothesisText: rawText,
  });
  const dedupedComparison = compareTranscripts({
    referenceText: referenceWindow.text,
    hypothesisText: dedupedText,
  });
  const segmentationDiagnostics = segmentationHelper.buildSegmentationDiagnostics({
    mode: opts.segmentationMode,
    overlapSec: opts.segmentationMode === 'overlap' ? opts.overlapSec : 0,
    rawText,
    dedupedText,
    segmentCount: plan.segments.length,
    failedSegmentCount: segmentTranscripts.filter((part) => part.providerStatus !== 'ok').length,
  });

  const segmentation = {
    mode: opts.segmentationMode,
    segmentationMode: opts.segmentationMode,
    segmentDurationSec: opts.segmentationMode === 'full' ? opts.durationSec : opts.segmentDurationSec,
    overlapSec: opts.segmentationMode === 'overlap' ? opts.overlapSec : 0,
    preRollSec: opts.segmentationMode === 'full' ? 0 : opts.preRollSec,
    postRollSec: opts.segmentationMode === 'full' ? 0 : opts.postRollSec,
    plan,
    segments: results.map((segment) => ({
      segmentId: segment.segmentId,
      startSec: segment.startSec,
      durationSec: segment.durationSec,
      audioStartSec: segment.audioStartSec,
      audioDurationSec: segment.audioDurationSec,
      transcribeLatencyMs: segment.transcribeLatencyMs,
      rawChars: segment.rawChars,
      normalizedChars: segment.normalizedChars,
    })),
    rawComparison,
    dedupedComparison,
    segmentedRawComparison: rawComparison,
    segmentedDedupedComparison: dedupedComparison,
    diagnostics: segmentationDiagnostics,
  };

  return {
    text,
    rawText,
    dedupedText,
    providerConfig: firstConfig,
    localModelStatus,
    termCorrectionDiagnostics,
    hardwareBenchmark,
    transcribeLatencyMs: results.reduce((sum, segment) => sum + segment.transcribeLatencyMs, 0),
    segmentation,
  };
}

function buildStatus(comparison, opts, referenceWindow) {
  return comparison.characterErrorRate <= opts.cerThreshold
    && comparison.keywordRecall >= opts.keywordRecallThreshold
    && comparison.lengthRatio >= 0.75
    && referenceWindow.status === 'aligned'
    ? 'passed'
    : 'failed';
}

export function sanitizeSegmentationForReport(segmentation) {
  if (!segmentation) return null;
  const { diagnostics, ...rest } = segmentation;
  if (!diagnostics) return rest;
  const { rawText: _rawText, dedupedText: _dedupedText, ...safeDiagnostics } = diagnostics;
  return { ...rest, diagnostics: safeDiagnostics };
}

function buildReportPayload({
  opts,
  comparison,
  diagnostics,
  referenceWindow,
  transcript,
  referenceText,
  alignmentSearch,
  audioDurationSec,
  transcribeResult,
}) {
  const providerConfig = transcribeResult.providerConfig ?? {};
  const benchmarkConfiguration = providerConfig.benchmarkConfiguration
    ?? buildBenchmarkConfigurationForProvider(opts);
  const report = {
    environmentStatus: 'ok',
    providerStatus: 'ok',
    status: buildStatus(comparison, opts, referenceWindow),
    entry: opts.entry,
    provider: opts.provider,
    providerConfig,
    benchmarkConfiguration,
    providerErrorCode: null,
    providerErrorType: null,
    parameterGroup: opts.provider === 'qcloud-auc' ? opts.parameterGroup : null,
    gatewayFieldStatus: providerConfig.gatewayFieldStatus ?? {},
    unsupportedFields: providerConfig.unsupportedFields ?? [],
    ignoredOrUnconfirmedFields: providerConfig.ignoredOrUnconfirmedFields ?? [],
    localModelStatus: transcribeResult.localModelStatus ?? null,
    sourceAudioProbe: opts.sourceAudioProbe ?? null,
    requestedStartSec: opts.requestedStartSec ?? opts.startSec,
    requestedDurationSec: opts.requestedDurationSec ?? opts.durationSec,
    clipStartSec: opts.startSec,
    clipDurationSec: opts.durationSec,
    referenceWindow: {
      status: referenceWindow.status,
      requestedStartSec: referenceWindow.requestedStartSec,
      requestedDurationSec: referenceWindow.requestedDurationSec,
      actualStartSec: referenceWindow.actualStartSec,
      actualEndSec: referenceWindow.actualEndSec,
      actualDurationSec: referenceWindow.actualDurationSec,
      segmentCount: referenceWindow.segmentCount,
    },
    audioDurationSec,
    transcribeLatencyMs: transcribeResult.transcribeLatencyMs,
    hardwareBenchmark: transcribeResult.hardwareBenchmark ?? null,
    referenceAlignmentStatus: referenceWindow.status,
    referenceSegmentCount: referenceWindow.segmentCount,
    thresholds: {
      characterErrorRate: opts.cerThreshold,
      keywordRecall: opts.keywordRecallThreshold,
      lengthRatio: 0.75,
    },
    comparison,
    termCorrectionDiagnostics: transcribeResult.termCorrectionDiagnostics ?? null,
    doubaoVocabularyTableDiagnostics: ['qcloud-auc', 'direct-doubao-auc'].includes(opts.provider)
      ? buildDoubaoVocabularyTableDiagnostics(opts, providerConfig)
      : null,
    alignmentSearch: {
      diagnosticOnly: true,
      enabled: alignmentSearch.enabled,
      searchSec: alignmentSearch.searchSec,
      stepSec: alignmentSearch.stepSec,
      candidateCount: alignmentSearch.candidateCount,
      bestReferenceOffsetSec: alignmentSearch.bestReferenceOffsetSec,
      bestComparison: alignmentSearch.bestComparison,
    },
    ...(transcribeResult.segmentation ? {
      segmentation: {
        ...sanitizeSegmentationForReport(transcribeResult.segmentation),
        wholeWindowBaselineComparison: comparison,
      },
    } : {}),
    diagnostics,
    includePrivateText: opts.includePrivateText,
  };

  if (opts.includePrivateText) {
    report.privateTextPreview = {
      referencePreview: referenceText.slice(0, 500),
      hypothesisPreview: transcript.slice(0, 500),
    };
  }

  return report;
}

function buildInvalidReferenceReport({ opts, referenceWindow, audioDurationSec }) {
  return {
    environmentStatus: 'ok',
    providerStatus: 'not_called',
    status: 'invalid_reference',
    reason: 'invalid_boundary_window',
    entry: opts.entry,
    provider: opts.provider,
    providerConfig: {},
    benchmarkConfiguration: buildBenchmarkConfigurationForProvider(opts),
    providerErrorCode: null,
    providerErrorType: null,
    parameterGroup: opts.provider === 'qcloud-auc' ? opts.parameterGroup : null,
    gatewayFieldStatus: {},
    unsupportedFields: [],
    ignoredOrUnconfirmedFields: [],
    localModelStatus: null,
    sourceAudioProbe: opts.sourceAudioProbe ?? null,
    requestedStartSec: opts.startSec,
    requestedDurationSec: opts.durationSec,
    clipStartSec: opts.startSec,
    clipDurationSec: opts.durationSec,
    audioDurationSec,
    referenceAlignmentStatus: referenceWindow.status,
    referenceSegmentCount: referenceWindow.segmentCount ?? 0,
    includePrivateText: false,
  };
}

function reportOutputPath(opts) {
  if (opts.reportOutput) return path.resolve(root, opts.reportOutput);
  const parts = [
    opts.entry,
    opts.provider,
    opts.provider === 'qcloud-auc' ? opts.parameterGroup : null,
    opts.segmentationMode !== 'full' ? opts.segmentationMode : null,
    `${opts.startSec}s-${opts.durationSec}s`,
  ].filter(Boolean);
  return path.join(
    root,
    'tests/fixtures/dynamic-actions/replay/private/stt-benchmark',
    `${parts.join('-')}.json`,
  );
}

function writeAndPrintReport(report, opts) {
  const outputPath = reportOutputPath(opts);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ...report,
    privateReportPath: path.relative(root, outputPath),
  }, null, 2));
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writePreparedCorpus({ opts, alignedOpts, referenceWindow, audioPath }) {
  const outputDir = path.resolve(opts.preparedOutputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const tempClip = buildClip(audioPath, alignedOpts);
  const clipPath = path.join(outputDir, `${opts.entry}-${referenceWindow.actualStartSec}s-${referenceWindow.actualDurationSec}s.wav`);
  fs.copyFileSync(tempClip, clipPath);
  fs.rmSync(tempClip, { force: true });
  const referenceWindowId = `${opts.entry}:${referenceWindow.actualStartSec}-${referenceWindow.actualEndSec}`;
  const referenceReport = path.join(outputDir, `${opts.entry}-reference.json`);
  fs.writeFileSync(referenceReport, JSON.stringify({
    entry: opts.entry,
    referenceWindowId,
    referenceWindow,
    referenceText: referenceWindow.text,
  }, null, 2));
  const manifestEntry = {
    entry: opts.entry,
    clipPath,
    clipSha256: sha256File(clipPath),
    referenceReport,
    referenceWindowId,
  };
  const manifestPath = path.join(outputDir, 'prepared-corpus-manifest.json');
  const existing = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const next = existing.filter((entry) => entry.entry !== opts.entry);
  next.push(manifestEntry);
  fs.writeFileSync(manifestPath, JSON.stringify(next, null, 2));
  console.log(JSON.stringify({
    status: 'prepared',
    entry: opts.entry,
    preparedManifestPath: manifestPath,
    preparedEntry: manifestEntry,
  }, null, 2));
  return manifestEntry;
}

async function runBenchmark(opts) {
  const audioPath = path.join(root, 'tests/fixtures/dynamic-actions/replay/audio/real/sales', `${opts.entry}.wav`);
  const transcriptPath = path.join(root, 'tests/fixtures/dynamic-actions/replay/transcripts/real/sales', `${opts.entry}.docx`);
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Missing private audio asset for ${opts.entry}`);
  }
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Missing private transcript asset for ${opts.entry}`);
  }
  const sourceAudioProbe = probeAudio(audioPath);
  const baseOpts = { ...opts, sourceAudioProbe };

  const rawReferenceText = await readDocxText(transcriptPath);
  const referenceSegments = extractTimedReferenceSegments(rawReferenceText);
  const referenceWindow = selectBoundaryAlignedWindow(referenceSegments, {
    requestedStartSec: opts.startSec,
    requestedDurationSec: opts.durationSec,
    maxStartShiftSec: 45,
    minDurationRatio: 0.75,
    maxDurationRatio: 1.25,
  });
  if (referenceWindow.status !== 'aligned') {
    const report = buildInvalidReferenceReport({
      opts: baseOpts,
      referenceWindow,
      audioDurationSec: readAudioDurationSec(audioPath),
    });
    writeAndPrintReport(report, opts);
    return report;
  }

  const alignedOpts = {
    ...opts,
    sourceAudioProbe,
    requestedStartSec: opts.startSec,
    requestedDurationSec: opts.durationSec,
    startSec: referenceWindow.actualStartSec,
    durationSec: referenceWindow.actualDurationSec,
  };

  if (opts.prepareOnly) {
    return writePreparedCorpus({ opts, alignedOpts, referenceWindow, audioPath });
  }

  const transcribeResult = await transcribeWindowSet({
    audioPath,
    entry: opts.entry,
    opts: alignedOpts,
    referenceWindow,
  });

  if (transcribeResult.blocked) {
    const report = {
      environmentStatus: transcribeResult.environmentStatus,
      providerStatus: 'blocked',
      status: 'blocked',
      entry: opts.entry,
      provider: opts.provider,
      providerConfig: transcribeResult.providerConfig ?? {},
      benchmarkConfiguration: transcribeResult.providerConfig?.benchmarkConfiguration
        ?? buildBenchmarkConfigurationForProvider(alignedOpts),
      providerErrorCode: null,
      providerErrorType: null,
      parameterGroup: opts.provider === 'qcloud-auc' ? opts.parameterGroup : null,
      gatewayFieldStatus: {},
      unsupportedFields: [],
      ignoredOrUnconfirmedFields: [],
      doubaoVocabularyTableDiagnostics: ['qcloud-auc', 'direct-doubao-auc'].includes(opts.provider)
        ? buildDoubaoVocabularyTableDiagnostics(opts, transcribeResult.providerConfig ?? {})
        : null,
      localModelStatus: transcribeResult.localModelStatus ?? null,
      requestedStartSec: opts.startSec,
      requestedDurationSec: opts.durationSec,
      clipStartSec: alignedOpts.startSec,
      clipDurationSec: alignedOpts.durationSec,
      audioDurationSec: readAudioDurationSec(audioPath),
      reason: transcribeResult.reason,
    };
    writeAndPrintReport(report, opts);
    return report;
  }

  const transcript = transcribeResult.text ?? '';
  const comparison = compareTranscripts({
    referenceText: referenceWindow.text,
    hypothesisText: transcript,
  });
  const alignmentSearch = findBestReferenceWindow(referenceSegments, opts, transcript);
  const diagnostics = diagnoseSttBenchmark({
    comparison,
    referenceAlignmentStatus: referenceWindow.status,
    transcriptLength: transcript.trim().length,
    alignmentSearch,
  });
  const report = buildReportPayload({
    opts: alignedOpts,
    comparison,
    diagnostics,
    referenceWindow,
    transcript,
    referenceText: referenceWindow.text,
    alignmentSearch,
    audioDurationSec: readAudioDurationSec(audioPath),
    transcribeResult,
  });
  writeAndPrintReport(report, opts);
  return report;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const report = await runBenchmark(opts);
    if (report.status === 'failed') process.exit(1);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const attemptedQcloudConfig = opts.provider === 'qcloud-auc'
      ? getQcloudParameterFields(opts.parameterGroup, opts)
      : { gatewayFieldStatus: {}, unsupportedFields: [], ignoredOrUnconfirmedFields: [] };
    if (
      opts.provider === 'qcloud-auc'
      && String(err.providerErrorCode ?? '').startsWith('4')
      && attemptedQcloudConfig.ignoredOrUnconfirmedFields.length > 0
    ) {
      attemptedQcloudConfig.unsupportedFields = [...attemptedQcloudConfig.ignoredOrUnconfirmedFields];
      attemptedQcloudConfig.ignoredOrUnconfirmedFields = [];
      for (const field of attemptedQcloudConfig.unsupportedFields) {
        attemptedQcloudConfig.gatewayFieldStatus[field] = 'unsupported';
      }
    }
    const report = {
      environmentStatus: 'ok',
      providerStatus: 'failed',
      status: 'failed',
      entry: opts.entry,
      provider: opts.provider,
      providerConfig: attemptedQcloudConfig,
      providerErrorCode: err.providerErrorCode ?? null,
      providerErrorType: err.providerErrorType ?? 'benchmark_error',
      parameterGroup: opts.provider === 'qcloud-auc' ? opts.parameterGroup : null,
      gatewayFieldStatus: attemptedQcloudConfig.gatewayFieldStatus,
      unsupportedFields: attemptedQcloudConfig.unsupportedFields,
      ignoredOrUnconfirmedFields: attemptedQcloudConfig.ignoredOrUnconfirmedFields,
      doubaoVocabularyTableDiagnostics: ['qcloud-auc', 'direct-doubao-auc'].includes(opts.provider)
        ? buildDoubaoVocabularyTableDiagnostics(opts, {
          ...attemptedQcloudConfig,
          providerErrorCode: err.providerErrorCode ?? null,
        })
        : null,
      localModelStatus: null,
      clipStartSec: opts.startSec,
      clipDurationSec: opts.durationSec,
      reason: err.providerErrorType ?? 'benchmark_error',
    };
    writeAndPrintReport(report, opts);
    process.exit(1);
  }
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main();
}
