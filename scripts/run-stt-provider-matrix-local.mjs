#!/usr/bin/env node
/**
 * Local private STT provider matrix runner.
 *
 * DO NOT print API keys or private transcript text.
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const DEFAULT_QCLOUD_GROUPS = [
  'qcloud-current',
  'qcloud-current-plus-punc',
  'qcloud-current-plus-vad',
  'qcloud-current-plus-punc-vad',
  'qcloud-current-plus-ssd',
  'qcloud-direct-aligned',
];

function usage() {
  console.log(`Local STT provider matrix

Usage:
  npm run test:stt:provider-matrix:local -- --entry sales-real-001 --providers qcloud-auc,local-sensevoice
  npm run test:stt:qcloud-auc:matrix -- --entries sales-real-001,sales-real-003

Options:
  --entry <id>                         Single entry id
  --entries <a,b,c>                    Multiple entry ids
  --providers <a,b>                    qcloud-auc,direct-doubao-auc,local-sensevoice
  --parameter-groups <a,b>             QCLOUD parameter groups, default qcloud-current
  --windows <start:duration,...>       Windows, default 300:60
  --segmentation-modes <a,b>           full,chunks,overlap; default full
  --pre-roll-sec <n>                   Extra bounded audio before each non-full segment, default 0
  --post-roll-sec <n>                  Extra bounded audio after each non-full segment, default 0
  --boosting-table-id <id>             Doubao AUC corpus boosting table id
  --boosting-table-name <name>         Doubao AUC corpus boosting table name
  --correct-table-id <id>              Doubao AUC corpus replacement table id
  --correct-table-name <name>          Doubao AUC corpus replacement table name
  --sensevoice-term-correction <mode>  off | industrial, default industrial
  --sensevoice-term <canonical=variant1|variant2>
  --local-channel-profile <name>       mic | system, default system
  --preprocessing-profiles <a,b>       baseline,soxr,fixed-frame-system-normalized
  --normalization-frame-ms <n>         Fixed-frame normalization duration, default 100
  --help                              Show this help`);
}

function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseMatrixArgs(argv) {
  const opts = {
    entries: [],
    providers: ['qcloud-auc', 'local-sensevoice'],
    parameterGroups: ['qcloud-current'],
    windows: [{ startSec: 300, durationSec: 60 }],
    segmentationModes: ['full'],
    preRollSec: 0,
    postRollSec: 0,
    boostingTableId: '',
    boostingTableName: '',
    correctTableId: '',
    correctTableName: '',
    sensevoiceTermCorrection: 'industrial',
    sensevoiceTerms: [],
    localChannelProfile: 'system',
    preprocessingProfiles: ['baseline'],
    normalizationFrameMs: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--entry') {
      opts.entries = [String(argv[++index] ?? '')];
      continue;
    }
    if (arg === '--entries') {
      opts.entries = splitCsv(argv[++index]);
      continue;
    }
    if (arg === '--providers') {
      opts.providers = splitCsv(argv[++index]);
      continue;
    }
    if (arg === '--parameter-groups') {
      const value = String(argv[++index] ?? '');
      opts.parameterGroups = value === 'all' ? DEFAULT_QCLOUD_GROUPS : splitCsv(value);
      continue;
    }
    if (arg === '--windows') {
      opts.windows = splitCsv(argv[++index]).map((item) => {
        const [start, duration] = item.split(':').map(Number);
        if (!Number.isFinite(start) || !Number.isFinite(duration)) {
          throw new Error(`Invalid --windows item: ${item}`);
        }
        return { startSec: start, durationSec: duration };
      });
      continue;
    }
    if (arg === '--segmentation-modes') {
      opts.segmentationModes = splitCsv(argv[++index]);
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
    if (arg === '--sensevoice-term-correction') {
      opts.sensevoiceTermCorrection = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--sensevoice-term') {
      opts.sensevoiceTerms.push(String(argv[++index] ?? ''));
      continue;
    }
    if (arg === '--local-channel-profile') {
      opts.localChannelProfile = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--preprocessing-profiles') {
      opts.preprocessingProfiles = splitCsv(argv[++index]);
      continue;
    }
    if (arg === '--normalization-frame-ms') {
      opts.normalizationFrameMs = Number(argv[++index]);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (opts.entries.length === 0) {
    throw new Error('--entry or --entries is required');
  }
  if (!Number.isInteger(opts.normalizationFrameMs) || opts.normalizationFrameMs < 20 || opts.normalizationFrameMs > 500) {
    throw new Error('--normalization-frame-ms must be an integer between 20 and 500');
  }
  return opts;
}

const parseArgs = parseMatrixArgs;

function parseJsonFromOutput(output) {
  const text = String(output ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function buildBenchmarkChildArgs(testCase, options) {
  const args = [
    'scripts/run-sales-local-stt-benchmark.mjs',
    '--entry',
    testCase.entry,
    '--provider',
    testCase.provider,
    '--start-sec',
    String(testCase.window.startSec),
    '--duration-sec',
    String(testCase.window.durationSec),
    '--segmentation-mode',
    testCase.segmentationMode,
    '--pre-roll-sec',
    String(testCase.preRollSec),
    '--post-roll-sec',
    String(testCase.postRollSec),
    '--sensevoice-term-correction',
    options.sensevoiceTermCorrection,
    '--local-channel-profile',
    options.localChannelProfile,
    '--preprocessing-profile',
    testCase.preprocessingProfile,
    '--normalization-frame-ms',
    String(options.normalizationFrameMs),
  ];
  for (const term of options.sensevoiceTerms) {
    args.push('--sensevoice-term', term);
  }
  if (options.boostingTableId) args.push('--boosting-table-id', options.boostingTableId);
  if (options.boostingTableName) args.push('--boosting-table-name', options.boostingTableName);
  if (options.correctTableId) args.push('--correct-table-id', options.correctTableId);
  if (options.correctTableName) args.push('--correct-table-name', options.correctTableName);
  if (testCase.provider === 'qcloud-auc') {
    args.push('--parameter-group', testCase.parameterGroup);
  }
  return args;
}

function runOne(testCase, options) {
  const args = buildBenchmarkChildArgs(testCase, options);
  const result = spawnSync('node', args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  const report = parseJsonFromOutput(result.stdout) ?? {
    status: result.status === 0 ? 'passed' : 'failed',
    provider: testCase.provider,
    entry: testCase.entry,
    parameterGroup: testCase.provider === 'qcloud-auc' ? testCase.parameterGroup : null,
    reason: result.stderr || result.stdout || 'benchmark did not emit JSON',
  };
  return {
    exitCode: result.status ?? 1,
    entry: testCase.entry,
    provider: testCase.provider,
    parameterGroup: testCase.provider === 'qcloud-auc' ? testCase.parameterGroup : null,
    segmentationMode: testCase.segmentationMode,
    preprocessingProfile: testCase.preprocessingProfile,
    clipStartSec: testCase.window.startSec,
    clipDurationSec: testCase.window.durationSec,
    status: report.status,
    environmentStatus: report.environmentStatus,
    providerStatus: report.providerStatus,
    comparison: report.comparison,
    referenceAlignmentStatus: report.referenceAlignmentStatus,
    segmentationDiagnostics: report.segmentation?.diagnostics ?? null,
    rawComparison: report.segmentation?.rawComparison ?? null,
    dedupedComparison: report.segmentation?.dedupedComparison ?? null,
    localModelStatus: report.localModelStatus,
    privateReportPath: report.privateReportPath,
    reason: report.reason === 'invalid_boundary_window' ? 'invalid_boundary_window' : report.reason,
  };
}

function summarize(results) {
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0, invalidReference: 0 };
  for (const result of results) {
    if (result.status === 'invalid_reference') {
      counts.invalidReference += 1;
    } else if (Object.prototype.hasOwnProperty.call(counts, result.status)) {
      counts[result.status] += 1;
    }
  }
  const comparable = results.filter((result) => result.comparison);
  const avgCer = comparable.length
    ? comparable.reduce((sum, result) => sum + result.comparison.characterErrorRate, 0) / comparable.length
    : null;
  const avgKeywordRecall = comparable.length
    ? comparable.reduce((sum, result) => sum + result.comparison.keywordRecall, 0) / comparable.length
    : null;
  return {
    counts,
    averageCharacterErrorRate: avgCer == null ? null : Number(avgCer.toFixed(4)),
    averageKeywordRecall: avgKeywordRecall == null ? null : Number(avgKeywordRecall.toFixed(4)),
  };
}

export function buildMatrixCases(opts) {
  const cases = [];
  for (const entry of opts.entries) {
    for (const provider of opts.providers) {
      const parameterGroups = provider === 'qcloud-auc' ? opts.parameterGroups : [null];
      for (const parameterGroup of parameterGroups) {
        for (const window of opts.windows) {
          for (const segmentationMode of opts.segmentationModes) {
            for (const preprocessingProfile of opts.preprocessingProfiles) {
              cases.push({
                entry,
                provider,
                parameterGroup,
                window,
                segmentationMode,
                preprocessingProfile,
                preRollSec: opts.preRollSec,
                postRollSec: opts.postRollSec,
              });
            }
          }
        }
      }
    }
  }
  return cases;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cases = buildMatrixCases(opts);
  const results = cases.map((testCase) => runOne(testCase, opts));
  const aggregate = {
    status: results.some((result) => result.status === 'failed') ? 'failed' : 'completed',
    generatedAt: new Date().toISOString(),
    summary: summarize(results),
    cases: results,
  };
  const outputDir = path.join(root, 'tests/fixtures/dynamic-actions/replay/private/stt-benchmark/matrix');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `stt-provider-matrix-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(aggregate, null, 2));
  console.log(JSON.stringify({ ...aggregate, privateReportPath: outputPath }, null, 2));
  if (aggregate.status === 'failed') process.exit(1);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
