import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/electron/services/qa/QaReportService.js'),
).href;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-qa-report-test-'));
}

async function load() {
  return import(moduleUrl);
}

function emptyAnswerQualityMetrics() {
  return {
    shownCount: 1,
    copiedCount: 0,
    acceptedCount: 0,
    ignoredCount: 0,
    regeneratedCount: 0,
    averageLatencyMs: null,
    p95LatencyMs: null,
    citationHitRate: 0,
    userAcceptanceRate: 0,
    regenerationRate: 0,
    ragHitRate: 0,
    noContextAnswerRate: 0,
  };
}

test('creates a QA ZIP with metadata and quality summary', async () => {
  const { QaReportService } = await load();
  const dir = tempDir();
  const outputPath = path.join(dir, 'cueup-qa-report-2026-07-07.zip');
  const telemetryPath = path.join(dir, 'telemetry.jsonl');
  fs.writeFileSync(
    telemetryPath,
    '{"name":"dynamic_action_shown","timestamp":"2026-07-07T00:00:00.000Z","modeId":"sales","properties":{"actionType":"pricing_objection"}}\n',
    'utf8',
  );

  const service = new QaReportService({
    now: () => new Date('2026-07-07T12:00:00.000Z'),
    appVersion: '2.7.0-test',
    platform: 'darwin',
    arch: 'arm64',
    verboseLoggingEnabled: () => true,
    telemetryPath,
    debugLogPaths: [],
    getAnswerQualityMetrics: () => emptyAnswerQualityMetrics(),
  });

  const result = await service.createQaReport({ outputPath });
  assert.equal(result.success, true);
  const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
  assert.ok(zip.file('metadata.json'));
  assert.ok(zip.file('quality-summary.json'));
  assert.ok(zip.file('telemetry.jsonl'));
  const metadata = JSON.parse(await zip.file('metadata.json').async('string'));
  assert.equal(metadata.appVersion, '2.7.0-test');
  assert.equal(metadata.verboseLoggingEnabled, true);
  const summary = JSON.parse(await zip.file('quality-summary.json').async('string'));
  assert.equal(summary.modeQuality.sales.shown, 1);
});

test('missing files do not fail export and are recorded in metadata', async () => {
  const { QaReportService } = await load();
  const dir = tempDir();
  const outputPath = path.join(dir, 'missing.zip');
  const service = new QaReportService({
    now: () => new Date('2026-07-07T12:00:00.000Z'),
    appVersion: '2.7.0-test',
    platform: 'darwin',
    arch: 'arm64',
    verboseLoggingEnabled: () => false,
    telemetryPath: path.join(dir, 'missing-telemetry.jsonl'),
    debugLogPaths: [path.join(dir, 'natively_debug.log'), path.join(dir, 'natively_debug.log.1')],
    getAnswerQualityMetrics: () => null,
  });

  const result = await service.createQaReport({ outputPath });
  assert.equal(result.success, true);
  const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const metadata = JSON.parse(await zip.file('metadata.json').async('string'));
  assert.deepEqual(metadata.missingFiles.sort(), ['natively_debug.log', 'natively_debug.log.1', 'telemetry.jsonl'].sort());
  assert.ok(metadata.reportWarnings.length >= 3);
});

test('exported QA ZIP does not contain raw sentinel private content', async () => {
  const { QaReportService } = await load();
  const dir = tempDir();
  const outputPath = path.join(dir, 'privacy.zip');
  const telemetryPath = path.join(dir, 'telemetry.jsonl');
  const debugLogPath = path.join(dir, 'natively_debug.log');
  fs.writeFileSync(
    telemetryPath,
    '{"name":"app_start","timestamp":"2026-07-07T00:00:00.000Z","properties":{"transcript":"SECRET_TRANSCRIPT_SENTINEL","prompt":"SECRET_PROMPT_SENTINEL","apiKey":"sk-abcdefghijklmnopqrstuvwxyz123456"}}\n',
    'utf8',
  );
  fs.writeFileSync(
    debugLogPath,
    'debug transcript SECRET_DEBUG_TRANSCRIPT_SENTINEL apiKey sk-abcdefghijklmnopqrstuvwxyz123456\n',
    'utf8',
  );

  const service = new QaReportService({
    now: () => new Date('2026-07-07T12:00:00.000Z'),
    appVersion: '2.7.0-test',
    platform: 'darwin',
    arch: 'arm64',
    verboseLoggingEnabled: () => false,
    telemetryPath,
    debugLogPaths: [debugLogPath],
    getAnswerQualityMetrics: () => null,
  });

  const result = await service.createQaReport({ outputPath });
  assert.equal(result.success, true);
  const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const summary = await zip.file('quality-summary.json').async('string');
  const telemetry = await zip.file('telemetry.jsonl').async('string');
  const debugLog = await zip.file('natively_debug.log').async('string');
  assert.doesNotMatch(summary, /SECRET_TRANSCRIPT_SENTINEL|SECRET_PROMPT_SENTINEL|sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(telemetry, /SECRET_TRANSCRIPT_SENTINEL|SECRET_PROMPT_SENTINEL|sk-abcdefghijklmnopqrstuvwxyz123456/);
  assert.doesNotMatch(debugLog, /SECRET_DEBUG_TRANSCRIPT_SENTINEL|sk-abcdefghijklmnopqrstuvwxyz123456/);
});
