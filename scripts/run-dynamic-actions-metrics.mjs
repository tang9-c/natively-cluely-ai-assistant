import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/qa/DynamicActionMetricsAggregator.js'),
).href;
const { aggregateDynamicActionQaMetrics } = await import(moduleUrl);

const summary = aggregateDynamicActionQaMetrics({
  telemetryRecords: [
    {
      name: 'dynamic_action_shown',
      timestamp: '2026-07-07T00:00:00.000Z',
      modeId: 'sales',
      properties: { actionType: 'pricing_objection', latencyKind: 'final_transcript_to_card_shown' },
      durationMs: 100,
    },
    {
      name: 'dynamic_action_accepted',
      timestamp: '2026-07-07T00:00:01.000Z',
      modeId: 'sales',
      properties: { actionType: 'pricing_objection' },
    },
    {
      name: 'llm_first_token_latency',
      timestamp: '2026-07-07T00:00:02.000Z',
      properties: { source: 'dynamic_action' },
      durationMs: 250,
    },
    {
      name: 'rag_hit',
      timestamp: '2026-07-07T00:00:03.000Z',
      properties: { source: 'pptx' },
    },
  ],
  fixtureResults: [
    {
      fixtureId: 'metrics-positive',
      actionType: 'pricing_objection',
      shouldEmit: true,
      emitted: true,
      actionTypeMatched: true,
      outputTypeMatched: true,
    },
  ],
  answerQualityMetrics: null,
});

const outDir = path.join(root, 'reports/dynamic-actions');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'metrics-report.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  modes: Object.keys(summary.modeQuality),
  actionTypes: Object.keys(summary.falsePositiveMissByAction),
}, null, 2));
