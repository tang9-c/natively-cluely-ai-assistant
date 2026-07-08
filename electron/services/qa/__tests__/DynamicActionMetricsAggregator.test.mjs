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

test('aggregates mode quality lifecycle counts by mode', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [
      { name: 'dynamic_action_shown', timestamp: '2026-07-07T00:00:00.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection' } },
      { name: 'dynamic_action_accepted', timestamp: '2026-07-07T00:00:01.000Z', modeId: 'sales', properties: { actionType: 'pricing_objection' } },
      { name: 'dynamic_action_dismissed', timestamp: '2026-07-07T00:00:02.000Z', modeId: 'fde', properties: { actionType: 'risk_validation' } },
      { name: 'dynamic_action_completed', timestamp: '2026-07-07T00:00:03.000Z', modeId: 'team-meet', status: 'generated_failed', properties: { actionType: 'action_item' } },
    ],
    fixtureResults: [],
    answerQualityMetrics: null,
  });

  assert.equal(summary.modeQuality.sales.shown, 1);
  assert.equal(summary.modeQuality.sales.accepted, 1);
  assert.equal(summary.modeQuality.fde.dismissed, 1);
  assert.equal(summary.modeQuality['team-meet'].generated_failed, 1);
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

test('parses telemetry JSONL with warnings for invalid lines', async () => {
  const { parseTelemetryJsonlLines } = await load();
  const parsed = parseTelemetryJsonlLines('{"name":"app_start","timestamp":"2026-07-07T00:00:00.000Z","properties":{}}\nnot-json\n\n');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /Invalid telemetry JSONL line 2/);
});
