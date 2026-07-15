#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function usage() {
  return 'Usage: node scripts/compare-stt-benchmark-reports.mjs --baseline <path> --after <path> [--baseline-filter <key=value,key=value>] [--after-filter <key=value,key=value>]';
}

function parseArgs(argv) {
  const opts = { baseline: '', after: '', baselineFilter: '', afterFilter: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--baseline') opts.baseline = String(argv[++index] || '');
    else if (arg === '--after') opts.after = String(argv[++index] || '');
    else if (arg === '--baseline-filter') opts.baselineFilter = String(argv[++index] || '');
    else if (arg === '--after-filter') opts.afterFilter = String(argv[++index] || '');
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!opts.baseline || !opts.after) {
    throw new Error(usage());
  }
  return opts;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function avg(cases, getter) {
  const values = cases
    .map(getter)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
    : null;
}

function collectCases(report) {
  if (Array.isArray(report.cases)) return report.cases;
  return [report];
}

function parseFilter(value) {
  if (!value) return {};
  return Object.fromEntries(value.split(',').filter(Boolean).map((pair) => {
    const separator = pair.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid filter pair: ${pair}`);
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
}

function readCaseValue(item, key) {
  if (key === 'parameterGroup') return item.parameterGroup || '';
  if (key === 'segmentationMode') return item.segmentationMode || item.segmentation?.mode || 'full';
  if (key === 'clipStartSec') return String(item.clipStartSec ?? '');
  if (key === 'clipDurationSec') return String(item.clipDurationSec ?? '');
  return String(item[key] ?? '');
}

function filterCases(cases, filter) {
  const entries = Object.entries(filter);
  if (entries.length === 0) return cases;
  return cases.filter((item) => entries.every(([key, expected]) => readCaseValue(item, key) === expected));
}

function summarize(report, filter) {
  const cases = filterCases(collectCases(report), filter);
  if (cases.length === 0) throw new Error(`No benchmark cases matched filter: ${JSON.stringify(filter)}`);
  return {
    caseCount: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    blocked: cases.filter((item) => item.status === 'blocked').length,
    skipped: cases.filter((item) => item.status === 'skipped').length,
    averageCharacterErrorRate: avg(cases, (item) => item.comparison?.characterErrorRate),
    averageLengthRatio: avg(cases, (item) => item.comparison?.lengthRatio),
    averageKeywordRecall: avg(cases, (item) => item.comparison?.keywordRecall),
    averageLatencyMs: avg(cases, (item) => item.transcribeLatencyMs),
  };
}

function delta(after, baseline, key) {
  if (typeof after[key] !== 'number' || typeof baseline[key] !== 'number') return null;
  return Number((after[key] - baseline[key]).toFixed(4));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baselineFilter = parseFilter(opts.baselineFilter);
  const afterFilter = parseFilter(opts.afterFilter);
  const baseline = summarize(readJson(opts.baseline), baselineFilter);
  const after = summarize(readJson(opts.after), afterFilter);
  const report = {
    generatedAt: new Date().toISOString(),
    baselinePath: path.relative(root, opts.baseline),
    afterPath: path.relative(root, opts.after),
    baselineFilter,
    afterFilter,
    baseline,
    after,
    deltas: {
      averageCharacterErrorRateDelta: delta(after, baseline, 'averageCharacterErrorRate'),
      averageLengthRatioDelta: delta(after, baseline, 'averageLengthRatio'),
      keywordRecallDelta: delta(after, baseline, 'averageKeywordRecall'),
      averageLatencyMsDelta: delta(after, baseline, 'averageLatencyMs'),
      providerFailureDelta: after.failed - baseline.failed,
    },
  };
  const outputDir = path.join(root, 'tests/fixtures/dynamic-actions/replay/private/stt-benchmark/compare');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `stt-benchmark-compare-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, privateReportPath: outputPath }, null, 2));
}

main();
