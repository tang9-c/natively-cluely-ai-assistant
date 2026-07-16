#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  calculateEditBreakdown,
} from './stt-benchmark/referenceQuality.mjs';

const root = process.cwd();

function usage() {
  console.log(`STT product-path evaluator

Usage:
  node scripts/run-stt-product-path-evaluator.mjs --user-data-dir <dir> --run-manifest <file> --expectations-manifest <file> --diagnostics-jsonl <file>

Writes aggregate-only reports under reports/private/stt-product-path.`);
}

function parseArgs(argv) {
  const opts = {
    userDataDir: '',
    runManifest: '',
    expectationsManifest: '',
    diagnosticsJsonl: '',
    outputDir: path.join(root, 'reports/private/stt-product-path'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--user-data-dir') {
      opts.userDataDir = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--run-manifest') {
      opts.runManifest = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--expectations-manifest') {
      opts.expectationsManifest = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--diagnostics-jsonl') {
      opts.diagnosticsJsonl = String(argv[++index] ?? '');
      continue;
    }
    if (arg === '--output-dir') {
      opts.outputDir = String(argv[++index] ?? '');
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  for (const key of ['userDataDir', 'runManifest', 'expectationsManifest', 'diagnosticsJsonl']) {
    if (!opts[key]) throw new Error(`--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} is required`);
  }
  return opts;
}

function normalizeForCer(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function compare(referenceText, hypothesisText) {
  const reference = normalizeForCer(referenceText);
  const hypothesis = normalizeForCer(hypothesisText);
  const breakdown = calculateEditBreakdown(reference, hypothesis);
  return {
    referenceChars: reference.length,
    hypothesisChars: hypothesis.length,
    characterErrorRate: reference.length === 0 ? 1 : Number((breakdown.distance / reference.length).toFixed(4)),
    lengthRatio: reference.length === 0 ? 0 : Number((hypothesis.length / reference.length).toFixed(4)),
    insertions: breakdown.insertions,
    deletions: breakdown.deletions,
    substitutions: breakdown.substitutions,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRunManifest(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.entries)) return value.entries;
  throw new Error('Run manifest must be an array or an object with an entries array');
}

function readDiagnostics(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function loadReferenceText(referenceReport) {
  const report = readJson(referenceReport);
  return report.referenceText || report.referenceWindow?.text || '';
}

async function loadDynamicActionHelper() {
  const helperPath = path.join(root, 'dist-electron/electron/services/qa/DynamicActionReplayRunner.js');
  return import(pathToFileURL(helperPath).href);
}

export async function evaluateProductPath(opts) {
  const userDataDir = fs.realpathSync(opts.userDataDir);
  if (!fs.existsSync(path.join(userDataDir, '.cueup-stt-quality-isolated'))) {
    throw new Error('Missing isolated user-data marker');
  }
  const dbPath = path.join(userDataDir, 'natively.db');
  const runManifest = normalizeRunManifest(readJson(opts.runManifest));
  const expectations = new Map(readJson(opts.expectationsManifest).map(entry => [entry.entry, entry]));
  const diagnostics = readDiagnostics(opts.diagnosticsJsonl);
  const uploadDiagnostics = diagnostics.filter(item => item.code === 'rest_stt_upload_diagnostics');
  const mappings = diagnostics.filter(item => item.code === 'stt_quality_meeting_mapping');
  const mappingByMeeting = new Map(mappings.map(item => [item.meetingId, item.runtimeSessionId]));
  const db = opts.transcriptRowsByMeeting
    ? null
    : new (await import('better-sqlite3')).default(dbPath, { readonly: true, fileMustExist: true });
  const { assessDynamicActionTranscriptRows } = await loadDynamicActionHelper();
  const entries = [];

  try {
    for (const run of runManifest) {
      const expectation = expectations.get(run.entry);
      if (!expectation) throw new Error(`Missing expectation for ${run.entry}`);
      if (!mappingByMeeting.has(run.meetingId)) throw new Error(`Missing diagnostics mapping for ${run.entry}`);
      const rows = opts.transcriptRowsByMeeting
        ? (opts.transcriptRowsByMeeting[run.meetingId] ?? [])
        : db.prepare(`
        SELECT speaker, speaker_id, speaker_label, content, timestamp_ms
        FROM transcripts
        WHERE meeting_id = ?
        ORDER BY timestamp_ms ASC
      `).all(run.meetingId);
      const unexpectedSpeakerTranscriptCount = rows.filter(row => row.speaker !== 'interviewer' && String(row.content ?? '').trim()).length;
      const interviewerRows = rows.filter(row => row.speaker === 'interviewer');
      const transcript = interviewerRows.map(row => row.content).join(' ');
      const comparison = compare(loadReferenceText(run.referenceReport), transcript);
      const actionAssessment = assessDynamicActionTranscriptRows({
        rows: interviewerRows.map(row => ({
          speaker: row.speaker,
          content: row.content,
          timestamp_ms: row.timestamp_ms,
        })),
        modeTemplateType: expectation.modeTemplateType,
        sessionId: `product-path-${run.entry}`,
        language: expectation.language,
        expectedActionType: expectation.expectedActionType,
      });
      const dynamicActionPassed = expectation.shouldEmit ? actionAssessment.matched : !actionAssessment.emitted;
      entries.push({
        entry: run.entry,
        status: unexpectedSpeakerTranscriptCount === 0 && dynamicActionPassed ? 'passed' : 'failed',
        characterErrorRate: comparison.characterErrorRate,
        lengthRatio: comparison.lengthRatio,
        unexpectedSpeakerTranscriptCount,
        dynamicActionPassed,
      });
    }
  } finally {
    db?.close();
  }

  const comparable = entries.filter(entry => Number.isFinite(entry.characterErrorRate));
  const latencies = uploadDiagnostics
    .map(item => item.speechEndToFinalMs)
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const report = {
    status: entries.every(entry => entry.status === 'passed') ? 'passed' : 'failed',
    totalEntries: entries.length,
    failedEntries: entries.filter(entry => entry.status === 'failed').length,
    productPathCharacterErrorRate: comparable.length
      ? Number((comparable.reduce((sum, entry) => sum + entry.characterErrorRate, 0) / comparable.length).toFixed(4))
      : null,
    averageLengthRatio: comparable.length
      ? Number((comparable.reduce((sum, entry) => sum + entry.lengthRatio, 0) / comparable.length).toFixed(4))
      : null,
    speechEndToFinalP50Ms: percentile(latencies, 50),
    speechEndToFinalP95Ms: percentile(latencies, 95),
    maxUploadDurationMs: uploadDiagnostics.length
      ? Math.max(...uploadDiagnostics.map(item => item.inputDurationMs ?? 0))
      : null,
    duplicateBoundaryCount: uploadDiagnostics.filter(item => item.duplicateBoundaryDetected).length,
    dynamicActionRecall: entries.length
      ? Number((entries.filter(entry => entry.dynamicActionPassed).length / entries.length).toFixed(4))
      : null,
    entries,
  };

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const outputPath = path.join(opts.outputDir, `product-path-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  return { report, outputPath };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { report, outputPath } = await evaluateProductPath(opts);
  console.log(JSON.stringify({
    status: report.status,
    totalEntries: report.totalEntries,
    failedEntries: report.failedEntries,
    productPathCharacterErrorRate: report.productPathCharacterErrorRate,
    privateReportPath: outputPath,
  }, null, 2));
  if (report.status === 'failed') process.exit(1);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
