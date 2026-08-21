#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPerformanceBaselineReport, renderPerformanceBaselineMarkdown } from './lib/performanceBaselineReport.mjs';

const METRICS = [
  ['app.cold-start', 'ms', 'cold_start_runner_not_configured'],
  ['stt.audio-to-final', 'ms', 'stt_final_latency_not_recorded'],
  ['dynamic-action.final-transcript-to-card', 'ms', 'dynamic_action_latency_not_recorded'],
  ['llm.first-token', 'ms', 'llm_first_token_latency_not_recorded'],
  ['llm.completed', 'ms', 'llm_completed_not_recorded'],
  ['rag.query', 'ms', 'rag_query_latency_not_recorded'],
  ['meeting.summary', 'ms', 'post_call_summary_latency_not_recorded'],
];

export function buildMetricInputs({
  telemetryRecords = [],
  longMeetingReports = [],
  coldStartReports = [],
  sttReports = [],
  dynamicActionReports = [],
  qcloudRealtimeReports = [],
  qcloudSummaryReports = [],
  qcloudSttRendererReports = [],
}) {
  const metrics = METRICS.map(([id, unit, blockedReason]) => ({ id, unit, samples: [], blockedReason }));
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const add = (id, record, predicate = () => true) => {
    if (record.name && predicate(record) && Number.isFinite(record.durationMs) && record.durationMs >= 0) {
      byId.get(id).samples.push(record.durationMs);
    }
  };

  for (const record of telemetryRecords) {
    add('stt.audio-to-final', record, (item) => item.name === 'stt_final_latency');
    add('dynamic-action.final-transcript-to-card', record, (item) => (
      item.name === 'dynamic_action_shown'
      && item.properties?.latencyKind === 'final_transcript_to_card_shown'
    ));
    add('llm.first-token', record, (item) => item.name === 'llm_first_token_latency');
    add('llm.completed', record, (item) => item.name === 'llm_completed');
    add('rag.query', record, (item) => item.name === 'rag_query');
    add('meeting.summary', record, (item) => item.name === 'post_call_summary_completed');
  }

  for (const report of coldStartReports) {
    for (const run of report.runs ?? []) {
      if (run.errorCode == null && Number.isFinite(run.readyMs)) byId.get('app.cold-start').samples.push(run.readyMs);
    }
  }

  for (const report of sttReports) {
    for (const run of report.runs ?? []) {
      if (run.errorCode == null && Number.isFinite(run.audioToFinalMs)) byId.get('stt.audio-to-final').samples.push(run.audioToFinalMs);
    }
  }

  for (const report of dynamicActionReports) {
    for (const run of report.runs ?? []) {
      if (run.errorCode == null && Number.isFinite(run.finalTranscriptToCardShownMs)) {
        byId.get('dynamic-action.final-transcript-to-card').samples.push(run.finalTranscriptToCardShownMs);
      }
    }
  }

  for (const report of qcloudRealtimeReports) {
    for (const run of report.runs ?? []) {
      if (run.errorCode !== null && run.errorCode !== undefined) continue;
      if (Number.isFinite(run.firstTokenMs)) byId.get('llm.first-token').samples.push(run.firstTokenMs);
      if (Number.isFinite(run.completedMs)) byId.get('llm.completed').samples.push(run.completedMs);
    }
  }

  for (const report of qcloudSummaryReports) {
    for (const run of report.runs ?? []) {
      if (run.variant === 'after' && run.generationStatus === 'success' && Number.isFinite(run.completedMs)) {
        byId.get('meeting.summary').samples.push(run.completedMs);
      }
    }
  }

  for (const report of qcloudSttRendererReports) {
    const samples = (report.runs ?? []).filter((run) => run.errorCode == null);
    metrics.push(
      metricFromSamples('qcloud-stt.segment-submit-to-final', 'ms', samples.map((run) => run.segmentSubmitToFinalMs), 'qcloud_stt_segment_final_not_recorded'),
      metricFromSamples('qcloud-stt.final-to-renderer', 'ms', samples.map((run) => run.finalToRendererMs), 'qcloud_stt_renderer_not_recorded'),
      metricFromSamples('qcloud-stt.segment-submit-to-renderer', 'ms', samples.map((run) => run.segmentSubmitToRendererMs), 'qcloud_stt_end_to_end_not_recorded'),
    );
  }

  for (const report of longMeetingReports) {
    const duration = report.configuration?.durationMinutes ?? 30;
    const prefix = `meeting.${duration}m`;
    const samples = Array.isArray(report.samples) ? report.samples : [];
    metrics.push(
      metricFromSamples(`${prefix}.cpu`, '%', samples.map((sample) => sample.main?.cpuPercent), 'long_meeting_cpu_not_recorded'),
      metricFromSamples(`${prefix}.memory`, 'bytes', samples.map((sample) => sample.main?.rssBytes), 'long_meeting_memory_not_recorded'),
      metricFromSamples(`${prefix}.database-size`, 'bytes', samples.map((sample) => sample.files?.databaseBytes), 'long_meeting_database_not_recorded'),
      metricFromSamples(`${prefix}.renderer-long-frames`, 'count', samples.map((sample) => sample.renderer?.longTaskCount), 'renderer_frame_metrics_not_recorded'),
      metricFromSamples(`${prefix}.renderer-render-commits`, 'count', samples.map((sample) => sample.renderer?.updateCount), 'renderer_commit_metrics_not_recorded'),
    );
  }

  return metrics;
}

function metricFromSamples(id, unit, samples, blockedReason) {
  return { id, unit, samples: samples.filter(Number.isFinite), blockedReason };
}

function parseArgs(argv) {
  const options = {
    telemetry: [], longMeeting: [], coldStart: [], stt: [], dynamicAction: [], qcloudRealtime: [], qcloudSummary: [], qcloudSttRenderer: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--telemetry' && value) { options.telemetry.push(value); index += 1; }
    else if (flag === '--long-meeting' && value) { options.longMeeting.push(value); index += 1; }
    else if (flag === '--cold-start' && value) { options.coldStart.push(value); index += 1; }
    else if (flag === '--stt' && value) { options.stt.push(value); index += 1; }
    else if (flag === '--dynamic-action' && value) { options.dynamicAction.push(value); index += 1; }
    else if (flag === '--qcloud-realtime' && value) { options.qcloudRealtime.push(value); index += 1; }
    else if (flag === '--qcloud-summary' && value) { options.qcloudSummary.push(value); index += 1; }
    else if (flag === '--qcloud-stt-renderer' && value) { options.qcloudSttRenderer.push(value); index += 1; }
    else if (flag === '--output' && value) { options.output = value; index += 1; }
    else if (flag === '--markdown' && value) { options.markdown = value; index += 1; }
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  if (!options.output) throw new Error('Usage: node scripts/run-performance-baseline.mjs --output <report.json> [--telemetry <telemetry.jsonl>] [--long-meeting <report.json>]');
  return options;
}

function readTelemetry(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function runPerformanceBaseline({
  telemetry = [],
  longMeeting = [],
  coldStart = [],
  stt = [],
  dynamicAction = [],
  qcloudRealtime = [],
  qcloudSummary = [],
  qcloudSttRenderer = [],
  environment = {},
  configuration = {},
  metricIds,
  ...options
}) {
  const metrics = buildMetricInputs({
    telemetryRecords: telemetry.flatMap(readTelemetry),
    longMeetingReports: longMeeting.map(readJson),
    coldStartReports: coldStart.map(readJson),
    sttReports: stt.map(readJson),
    dynamicActionReports: dynamicAction.map(readJson),
    qcloudRealtimeReports: qcloudRealtime.map(readJson),
    qcloudSummaryReports: qcloudSummary.map(readJson),
    qcloudSttRendererReports: qcloudSttRenderer.map(readJson),
  });
  const selectedMetricIds = metricIds ? new Set(metricIds) : null;
  const report = buildPerformanceBaselineReport({
    environment: {
      platform: process.platform,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      nodeVersion: process.version,
      ...environment,
    },
    configuration: {
      executionMode: 'dedicated-baseline',
      baselineMachine: 'apple-m4-16gb',
      provider: 'natively-qcloud',
      ...configuration,
    },
    metrics: selectedMetricIds ? metrics.filter(({ id }) => selectedMetricIds.has(id)) : metrics,
  });
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (options.markdown) {
    fs.mkdirSync(path.dirname(options.markdown), { recursive: true });
    fs.writeFileSync(options.markdown, renderPerformanceBaselineMarkdown(report), { mode: 0o600 });
  }
  return report;
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) {
  try {
    const report = runPerformanceBaseline(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: report.status, scenarios: Object.keys(report.scenarios).length })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
