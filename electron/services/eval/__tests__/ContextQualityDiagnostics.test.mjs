import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadDiagnostics() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/eval/ContextQualityDiagnostics.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('context quality diagnostics summarize gate, answer, and context metrics without raw content', async () => {
  const { summarizeContextQualityDiagnostics } = await loadDiagnostics();

  const summary = summarizeContextQualityDiagnostics({
    dynamicActions: [
      {
        type: 'pricing_request',
        semanticGate: {
          decision: 'reject',
          actionType: 'pricing_request',
          confidence: 0.82,
          reasons: ['neutral_pricing_reference'],
          regexCandidates: ['pricing_request:pricing page'],
          rejectedCandidates: ['pricing_request'],
          usedLocalIntentModel: false,
          usedCloudArbitration: false,
          semanticProvider: 'local_intent',
          upgradedByRepeatedEvidence: false,
        },
      },
      {
        type: 'case_study_request',
        semanticGate: {
          decision: 'pass',
          actionType: 'case_study_request',
          confidence: 0.93,
          reasons: ['cloud_confirmed_case_request'],
          regexCandidates: ['case_study_request:case study'],
          rejectedCandidates: [],
          usedLocalIntentModel: false,
          usedCloudArbitration: true,
          semanticProvider: 'cloud_llm',
          upgradedByRepeatedEvidence: false,
        },
      },
      {
        type: 'technical_requirements',
        semanticGate: {
          decision: 'defer',
          actionType: 'technical_requirements',
          confidence: 0.7,
          reasons: ['cloud_semantic_gate_unavailable'],
          regexCandidates: ['technical_requirements:technical solution'],
          rejectedCandidates: [],
          usedLocalIntentModel: false,
          usedCloudArbitration: false,
          semanticProvider: 'unavailable',
          degradedReason: 'cloud_semantic_gate_unavailable',
          upgradedByRepeatedEvidence: false,
        },
      },
    ],
    answerQualityMetrics: {
      shownCount: 10,
      copiedCount: 1,
      acceptedCount: 4,
      ignoredCount: 2,
      regeneratedCount: 3,
      averageLatencyMs: 820,
      p95LatencyMs: 1500,
      citationHitRate: 0.6,
      userAcceptanceRate: 0.4,
      regenerationRate: 0.3,
      ragHitRate: 0.5,
      noContextAnswerRate: 0.1,
    },
    contextPlans: [
      {
        injectedSources: ['current_transcript', 'uploaded_material', 'business_system'],
        omittedSources: [
          { source: 'short_term_history', reason: 'assistant_history_truncated' },
          { source: 'uploaded_material', reason: 'duplicate_context_dropped' },
        ],
        degradedReasons: ['assistant_history_truncated', 'business_system_timeout'],
        retrievalTimingMs: {
          business_system: 120,
          uploaded_material: 30,
          screen_context: 45,
        },
      },
    ],
  });

  assert.equal(summary.dynamicActions.total, 3);
  assert.equal(summary.dynamicActions.decisions.pass, 1);
  assert.equal(summary.dynamicActions.decisions.reject, 1);
  assert.equal(summary.dynamicActions.decisions.defer, 1);
  assert.equal(summary.dynamicActions.cloudArbitrationRate, 1 / 3);
  assert.equal(summary.dynamicActions.cloudUnavailableRate, 1 / 3);
  assert.equal(summary.dynamicActions.degradedReasons.cloud_semantic_gate_unavailable, 1);
  assert.equal(summary.answerQuality.p95LatencyMs, 1500);
  assert.equal(summary.answerQuality.ragHitRate, 0.5);
  assert.equal(summary.context.injectedSources.uploaded_material, 1);
  assert.equal(summary.context.omittedSources.short_term_history, 1);
  assert.equal(summary.context.degradedReasons.business_system_timeout, 1);
  assert.equal(summary.context.retrievalTimingMs.business_system.p95, 120);
  assert.doesNotMatch(JSON.stringify(summary), /pricing page|case study|technical solution/);
});
