import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildMetricInputs, runPerformanceBaseline } from '../run-performance-baseline.mjs';

test('maps redacted telemetry and long-meeting samples into baseline metrics', () => {
  const metrics = buildMetricInputs({
    telemetryRecords: [
      { name: 'llm_first_token_latency', durationMs: 110, properties: {} },
      { name: 'llm_completed', durationMs: 240, properties: {} },
      { name: 'dynamic_action_shown', durationMs: 85, properties: { latencyKind: 'final_transcript_to_card_shown' } },
      { name: 'post_call_summary_completed', durationMs: 500, properties: {} },
    ],
    longMeetingReports: [{
      samples: [
        { main: { cpuPercent: 10, rssBytes: 1000 }, renderer: { updateCount: 4, longTaskCount: 1 }, files: { databaseBytes: 50 } },
        { main: { cpuPercent: 20, rssBytes: 1200 }, renderer: { updateCount: 7, longTaskCount: 2 }, files: { databaseBytes: 70 } },
      ],
    }],
  });

  assert.deepEqual(metrics.find((metric) => metric.id === 'llm.first-token').samples, [110]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'dynamic-action.final-transcript-to-card').samples, [85]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'meeting.summary').samples, [500]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'meeting.30m.cpu').samples, [10, 20]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'meeting.30m.database-size').samples, [50, 70]);
  assert.equal(metrics.find((metric) => metric.id === 'app.cold-start').status, undefined);
  assert.equal(metrics.find((metric) => metric.id === 'app.cold-start').blockedReason, 'cold_start_runner_not_configured');
});

test('ingests QCloud benchmark reports without response text or keys', () => {
  const metrics = buildMetricInputs({
    coldStartReports: [{ runs: [{ readyMs: 900, errorCode: null }] }],
    sttReports: [{ runs: [{ audioToFinalMs: 1100, errorCode: null }] }],
    dynamicActionReports: [{ runs: [{ finalTranscriptToCardShownMs: 420, errorCode: null }] }],
    qcloudRealtimeReports: [{
      runs: [{ firstTokenMs: 300, completedMs: 700, errorCode: null }],
    }],
    qcloudSummaryReports: [{
      runs: [{ variant: 'after', completedMs: 1500, generationStatus: 'success' }],
    }],
    qcloudSttRendererReports: [{
      runs: [{ segmentSubmitToFinalMs: 8000, finalToRendererMs: 50, segmentSubmitToRendererMs: 8050, errorCode: null }],
    }],
  });

  assert.deepEqual(metrics.find((metric) => metric.id === 'app.cold-start').samples, [900]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'stt.audio-to-final').samples, [1100]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'dynamic-action.final-transcript-to-card').samples, [420]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'llm.first-token').samples, [300]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'llm.completed').samples, [700]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'meeting.summary').samples, [1500]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'qcloud-stt.segment-submit-to-final').samples, [8000]);
  assert.deepEqual(metrics.find((metric) => metric.id === 'qcloud-stt.final-to-renderer').samples, [50]);
});

test('writes JSON and Markdown reports under the requested local directory', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'performance-baseline-'));
  const jsonPath = path.join(outputDir, 'report.json');
  const markdownPath = path.join(outputDir, 'report.md');

  runPerformanceBaseline({ telemetry: [], longMeeting: [], output: jsonPath, markdown: markdownPath });

  const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.configuration.baselineMachine, 'apple-m4-16gb');
  assert.match(fs.readFileSync(markdownPath, 'utf8'), /性能基线报告/);
});
