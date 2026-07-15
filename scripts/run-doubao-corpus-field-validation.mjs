#!/usr/bin/env node
/**
 * Validate which Doubao AUC corpus fields are effective for qcloud-auc.
 *
 * This script intentionally prints metrics and diagnostics only. It does not
 * print transcript text, prompt text, API keys, or private audio/docx content.
 */

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function usage() {
  console.log(`Doubao corpus field validation

Usage:
  npm run test:stt:doubao-corpus-fields:local -- --entry sales-real-004 --boosting-table-id <id> --boosting-table-name <name> --correct-table-id <id> --correct-table-name <name>

Options:
  --entry <id>                    Private replay entry id, default sales-real-004
  --boosting-table-id <id>         Hotword table id
  --boosting-table-name <name>     Hotword table name
  --correct-table-id <id>          Replacement table id
  --correct-table-name <name>      Replacement table name
  --parameter-group <name>         QCLOUD parameter group, default qcloud-current
  --start-sec <n>                 Clip start offset, default 300
  --duration-sec <n>              Clip duration, default 60
  --help                          Show this help`);
}

function parseArgs(argv) {
  const opts = {
    entry: 'sales-real-004',
    boostingTableId: process.env.DOUBAO_AUC_BOOSTING_TABLE_ID || process.env.QCLOUD_AUC_BOOSTING_TABLE_ID || '',
    boostingTableName: process.env.DOUBAO_AUC_BOOSTING_TABLE_NAME || process.env.QCLOUD_AUC_BOOSTING_TABLE_NAME || '',
    correctTableId: process.env.DOUBAO_AUC_CORRECT_TABLE_ID || process.env.QCLOUD_AUC_CORRECT_TABLE_ID || '',
    correctTableName: process.env.DOUBAO_AUC_CORRECT_TABLE_NAME || process.env.QCLOUD_AUC_CORRECT_TABLE_NAME || '',
    parameterGroup: 'qcloud-current',
    startSec: 300,
    durationSec: 60,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--entry') opts.entry = String(argv[++index] ?? '');
    else if (arg === '--boosting-table-id') opts.boostingTableId = String(argv[++index] ?? '');
    else if (arg === '--boosting-table-name') opts.boostingTableName = String(argv[++index] ?? '');
    else if (arg === '--correct-table-id') opts.correctTableId = String(argv[++index] ?? '');
    else if (arg === '--correct-table-name') opts.correctTableName = String(argv[++index] ?? '');
    else if (arg === '--parameter-group') opts.parameterGroup = String(argv[++index] ?? '');
    else if (arg === '--start-sec') opts.startSec = Number(argv[++index]);
    else if (arg === '--duration-sec') opts.durationSec = Number(argv[++index]);
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!/^sales-real-\d{3}$/.test(opts.entry)) {
    throw new Error('--entry must match sales-real-001 style ids');
  }
  if (!Number.isFinite(opts.startSec) || !Number.isFinite(opts.durationSec) || opts.durationSec <= 0) {
    throw new Error('--start-sec and --duration-sec must be finite positive values');
  }
  if (!opts.boostingTableId || !opts.boostingTableName || !opts.correctTableId || !opts.correctTableName) {
    throw new Error('All table id/name values are required for a complete validation matrix');
  }
  return opts;
}

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

function variants(opts) {
  return [
    {
      variant: 'baseline',
      env: {},
    },
    {
      variant: 'id-only',
      env: {
        DOUBAO_AUC_BOOSTING_TABLE_ID: opts.boostingTableId,
        DOUBAO_AUC_CORRECT_TABLE_ID: opts.correctTableId,
      },
    },
    {
      variant: 'name-only',
      env: {
        DOUBAO_AUC_BOOSTING_TABLE_NAME: opts.boostingTableName,
        DOUBAO_AUC_CORRECT_TABLE_NAME: opts.correctTableName,
      },
    },
    {
      variant: 'id-and-name',
      env: {
        DOUBAO_AUC_BOOSTING_TABLE_ID: opts.boostingTableId,
        DOUBAO_AUC_BOOSTING_TABLE_NAME: opts.boostingTableName,
        DOUBAO_AUC_CORRECT_TABLE_ID: opts.correctTableId,
        DOUBAO_AUC_CORRECT_TABLE_NAME: opts.correctTableName,
      },
    },
  ];
}

function runVariant(opts, variant) {
  const args = [
    'scripts/run-sales-local-stt-benchmark.mjs',
    '--entry',
    opts.entry,
    '--provider',
    'qcloud-auc',
    '--parameter-group',
    opts.parameterGroup,
    '--start-sec',
    String(opts.startSec),
    '--duration-sec',
    String(opts.durationSec),
  ];
  const result = spawnSync('node', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DOUBAO_AUC_BOOSTING_TABLE_ID: '',
      DOUBAO_AUC_BOOSTING_TABLE_NAME: '',
      DOUBAO_AUC_CORRECT_TABLE_ID: '',
      DOUBAO_AUC_CORRECT_TABLE_NAME: '',
      QCLOUD_AUC_BOOSTING_TABLE_ID: '',
      QCLOUD_AUC_BOOSTING_TABLE_NAME: '',
      QCLOUD_AUC_CORRECT_TABLE_ID: '',
      QCLOUD_AUC_CORRECT_TABLE_NAME: '',
      ...variant.env,
    },
  });
  const report = parseJsonFromOutput(result.stdout) ?? {
    status: result.status === 0 ? 'passed' : 'failed',
    reason: result.stderr || 'benchmark did not emit JSON',
  };

  return {
    variant: variant.variant,
    exitCode: result.status ?? 1,
    status: report.status,
    environmentStatus: report.environmentStatus,
    providerStatus: report.providerStatus,
    providerErrorCode: report.providerErrorCode,
    providerErrorType: report.providerErrorType,
    comparison: report.comparison ?? null,
    corpusConfig: report.providerConfig?.corpusConfig ?? null,
    doubaoVocabularyTableDiagnostics: report.doubaoVocabularyTableDiagnostics ?? null,
    diagnostics: report.diagnostics ?? null,
    privateReportPath: report.privateReportPath ?? null,
    reason: report.reason ?? null,
  };
}

function metricDelta(result, baseline, key) {
  const after = result.comparison?.[key];
  const before = baseline.comparison?.[key];
  if (typeof after !== 'number' || typeof before !== 'number') return null;
  return Number((after - before).toFixed(4));
}

function summarize(results) {
  const baseline = results.find((result) => result.variant === 'baseline') || results[0];
  return results.map((result) => ({
    variant: result.variant,
    status: result.status,
    environmentStatus: result.environmentStatus,
    providerStatus: result.providerStatus,
    providerErrorCode: result.providerErrorCode,
    characterErrorRate: result.comparison?.characterErrorRate ?? null,
    characterErrorRateDelta: metricDelta(result, baseline, 'characterErrorRate'),
    lengthRatio: result.comparison?.lengthRatio ?? null,
    lengthRatioDelta: metricDelta(result, baseline, 'lengthRatio'),
    keywordRecall: result.comparison?.keywordRecall ?? null,
    keywordRecallDelta: metricDelta(result, baseline, 'keywordRecall'),
    missingKeywords: result.comparison?.missingKeywords ?? [],
    corpusConfig: result.corpusConfig,
    sentFields: result.doubaoVocabularyTableDiagnostics?.sentFields ?? [],
    ignoredOrUnconfirmedFields: result.doubaoVocabularyTableDiagnostics?.ignoredOrUnconfirmedFields ?? [],
    privateReportPath: result.privateReportPath,
  }));
}

function reportOutputPath(opts) {
  const outputDir = path.join(root, 'tests/fixtures/dynamic-actions/replay/private/stt-benchmark/doubao-corpus-field-validation');
  fs.mkdirSync(outputDir, { recursive: true });
  return path.join(outputDir, `doubao-corpus-field-validation-${opts.entry}-${Date.now()}.json`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = variants(opts).map((variant) => runVariant(opts, variant));
  const report = {
    generatedAt: new Date().toISOString(),
    entry: opts.entry,
    provider: 'qcloud-auc',
    parameterGroup: opts.parameterGroup,
    clipStartSec: opts.startSec,
    clipDurationSec: opts.durationSec,
    variants: summarize(results),
  };
  const outputPath = reportOutputPath(opts);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, privateReportPath: outputPath }, null, 2));
  if (results.some((result) => result.status === 'blocked')) process.exit(2);
  if (results.every((result) => result.status !== 'passed')) process.exit(1);
}

main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(err.message);
  process.exit(1);
});
