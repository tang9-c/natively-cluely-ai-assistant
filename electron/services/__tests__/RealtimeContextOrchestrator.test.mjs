import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadOrchestrator() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/context/RealtimeContextOrchestrator.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('orchestrator keeps higher-priority duplicate evidence and records dropped duplicate', async () => {
  const { buildRealtimeContextPlan, formatInjectedContext } = await loadOrchestrator();
  const plan = buildRealtimeContextPlan({
    tokenBudget: 500,
    ragReady: true,
    embeddingReady: true,
    screenContextStatus: 'not_available',
    candidates: [
      {
        source: 'uploaded_material',
        sourceId: 'mat_security',
        chunkId: 1,
        text: 'SOC2 Type II completed in 2025.',
        score: 0.92,
        tokenCount: 20,
        contentHash: 'same-fact',
      },
      {
        source: 'mode_reference',
        sourceId: 'mode_security',
        chunkId: 'a',
        text: 'SOC2 Type II completed in 2025.',
        score: 0.81,
        tokenCount: 20,
        contentHash: 'same-fact',
      },
    ],
  });

  assert.equal(plan.injected.length, 1);
  assert.equal(plan.injected[0].source, 'uploaded_material');
  assert.equal(plan.omitted.length, 1);
  assert.equal(plan.omitted[0].reason, 'duplicate_context_dropped');
  assert.match(formatInjectedContext(plan), /<uploaded_material_context>/);
  assert.doesNotMatch(formatInjectedContext(plan), /mode_security/);
});

test('orchestrator drops low-priority context when token budget is exceeded', async () => {
  const { buildRealtimeContextPlan } = await loadOrchestrator();
  const plan = buildRealtimeContextPlan({
    tokenBudget: 60,
    ragReady: true,
    embeddingReady: true,
    screenContextStatus: 'not_available',
    candidates: [
      { source: 'current_transcript', sourceId: 'transcript', text: 'Important current question', tokenCount: 20 },
      { source: 'uploaded_material', sourceId: 'mat', chunkId: 1, text: 'Important material fact', tokenCount: 25 },
      { source: 'short_term_history', sourceId: 'history', text: 'Old assistant answer', tokenCount: 40 },
    ],
  });

  assert.deepEqual(plan.injected.map((item) => item.source), ['current_transcript', 'uploaded_material']);
  assert.equal(plan.omitted[0].source, 'short_term_history');
  assert.equal(plan.omitted[0].reason, 'assistant_history_truncated');
});

test('orchestrator records source status for RAG miss separately from RAG failure', async () => {
  const { buildRealtimeContextPlan } = await loadOrchestrator();
  const miss = buildRealtimeContextPlan({
    tokenBudget: 100,
    ragAttempted: true,
    ragReady: true,
    embeddingReady: true,
    uploadedMaterialHitCount: 0,
    screenContextStatus: 'not_available',
    candidates: [{ source: 'current_transcript', sourceId: 'transcript', text: 'Question', tokenCount: 10 }],
  });

  assert.equal(miss.sourceStatus.ragAttempted, true);
  assert.equal(miss.sourceStatus.uploadedMaterialHitCount, 0);
  assert.ok(miss.degradedReasons.includes('no_relevant_uploaded_material'));
});
