import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/electron/services/qa/DynamicActionMetricsAggregator.js'),
).href;

async function load() {
  return import(moduleUrl);
}

test('aggregates all dynamic action lifecycle counts by stable telemetry event name', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [
      { name: 'dynamic_action_shown', timestamp: '2026-07-07T00:00:00.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection' } },
      { name: 'dynamic_action_accepted', timestamp: '2026-07-07T00:00:01.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection' } },
      { name: 'dynamic_action_auto_generated', timestamp: '2026-07-07T00:00:02.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection', triggerSource: 'auto_countdown' } },
      { name: 'dynamic_action_dismissed', timestamp: '2026-07-07T00:00:03.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection' } },
      { name: 'dynamic_action_expired', timestamp: '2026-07-07T00:00:04.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection' } },
      { name: 'dynamic_action_generation_failed', timestamp: '2026-07-07T00:00:05.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection', generationStatus: 'generated_failed' } },
      { name: 'dynamic_action_completed', timestamp: '2026-07-07T00:00:06.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection', generationStatus: 'completed' } },
    ],
    fixtureResults: [],
    answerQualityMetrics: null,
  });

  assert.deepEqual(summary.modeQuality.sales, {
    shown: 1,
    accepted: 1,
    auto_generated: 1,
    dismissed: 1,
    expired: 1,
    generated_failed: 1,
    completed: 1,
  });
});

test('keeps legacy status compatibility without changing the new lifecycle names', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [
      { name: 'dynamic_action_completed', timestamp: '2026-07-07T00:00:00.000Z', modeId: 'team-meet', status: 'generated_failed', properties: { actionType: 'action_item' } },
    ],
    fixtureResults: [],
    answerQualityMetrics: null,
  });

  assert.equal(summary.modeQuality['team-meet'].generated_failed, 1);
  assert.equal(summary.modeQuality['team-meet'].completed, 0);
});

test('aggregates precision and recall from fixture results by action type', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [],
    fixtureResults: [
      { fixtureId: 's1', actionType: 'pricing_objection', shouldEmit: true, emitted: true, actionTypeMatched: true, outputTypeMatched: true },
      { fixtureId: 's2', actionType: 'pricing_objection', shouldEmit: true, emitted: false, actionTypeMatched: false, outputTypeMatched: false },
      { fixtureId: 's3', actionType: 'pricing_request', shouldEmit: false, emitted: true, actionTypeMatched: false, outputTypeMatched: false },
    ],
    answerQualityMetrics: null,
  });

  assert.equal(summary.falsePositiveMissByAction.pricing_objection.recall, 0.5);
  assert.equal(summary.falsePositiveMissByAction.pricing_request.precision, 0);
});

test('aggregates latency and trust source counters from telemetry', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [
      { name: 'dynamic_action_shown', timestamp: '2026-07-07T00:00:00.000Z', durationMs: 120, properties: { latencyKind: 'final_transcript_to_card_shown' } },
      { name: 'llm_first_token_latency', timestamp: '2026-07-07T00:00:01.000Z', durationMs: 300, properties: { source: 'dynamic_action' } },
      { name: 'rag_hit', timestamp: '2026-07-07T00:00:02.000Z', properties: { source: 'pptx' } },
      { name: 'screen_context_captured', timestamp: '2026-07-07T00:00:03.000Z', properties: {} },
      { name: 'provider_fallback', timestamp: '2026-07-07T00:00:04.000Z', status: 'local_fallback', properties: {} },
    ],
    fixtureResults: [],
    answerQualityMetrics: null,
  });

  assert.equal(summary.latency.finalTranscriptToCardShown.averageMs, 120);
  assert.equal(summary.latency.cardAcceptedToFirstToken.averageMs, 300);
  assert.equal(summary.trustSources.pptxHit, 1);
  assert.equal(summary.trustSources.screenUsed, 1);
  assert.equal(summary.trustSources.localFallback, 1);
});

test('carries replay asset coverage and environment status into the QA summary', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [],
    fixtureResults: [],
    replayReport: {
      totalEntries: 9,
      skippedEntries: 9,
      failedEntries: 0,
      passedEntries: 0,
      environmentStatus: 'blocked_missing_credentials',
      assetCoverage: {
        requiredReal: { sales: 15, fde: 10, 'team-meet': 5 },
        availableReal: { sales: 0, fde: 0, 'team-meet': 0 },
        availableSynthetic: { sales: 3, fde: 2, 'team-meet': 1 },
        blockedReal: { sales: 15, fde: 10, 'team-meet': 5 },
      },
      entries: [],
    },
    answerQualityMetrics: null,
  });

  assert.equal(summary.environmentStatus, 'blocked_missing_credentials');
  assert.equal(summary.assetCoverage.availableSynthetic.sales, 3);
  assert.equal(summary.assetCoverage.blockedReal['team-meet'], 5);
});

test('parses telemetry JSONL with warnings for invalid lines', async () => {
  const { parseTelemetryJsonlLines } = await load();
  const parsed = parseTelemetryJsonlLines('{"name":"app_start","timestamp":"2026-07-07T00:00:00.000Z","properties":{}}\nnot-json\n\n');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /Invalid telemetry JSONL line 2/);
});
