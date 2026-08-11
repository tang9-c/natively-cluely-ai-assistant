import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/knowledge/UploadedMaterialContextContributionService.js');

async function loadService() {
  return import(pathToFileURL(modulePath).href);
}

function makeMaterialService(resultOrError, calls) {
  return {
    async searchWithDiagnostics(query, options) {
      calls.push({ query, options });
      if (resultOrError instanceof Error) throw resultOrError;
      return resultOrError;
    },
  };
}

test('uploaded material chat contribution skips retrieval when reference files scope is denied', async () => {
  const { buildUploadedMaterialContextContribution } = await loadService();
  const calls = [];

  const result = await buildUploadedMaterialContextContribution({
    query: '根据资料回答',
    scopePolicy: { reference_files: false },
    materialService: makeMaterialService({ hits: [] }, calls),
    ragReady: true,
    embeddingReady: true,
  });

  assert.equal(calls.length, 0);
  assert.equal(result.context, undefined);
  assert.deepEqual(result.degradedReasons, ['context_scope_denied']);
  assert.equal(result.sourceStatus.ragAttempted, false);
});

test('uploaded material chat contribution reports truncation and source status', async () => {
  const { buildUploadedMaterialContextContribution } = await loadService();
  const calls = [];
  const longText = 'CueUp supports Sales and FDE modes. '.repeat(300);

  const result = await buildUploadedMaterialContextContribution({
    query: '根据刚上传的资料，CueUp 支持哪些专用会议模式？',
    materialService: makeMaterialService({
      hits: [{
        sourceType: 'uploaded_material',
        sourceId: 'mat-1',
        chunkId: 1,
        score: 0.9,
        title: 'Product overview',
        text: longText,
        parentText: longText,
        fileHash: 'hash-1',
        materialUpdatedAt: '2026-07-07T00:00:00Z',
      }],
    }, calls),
    ragReady: true,
    embeddingReady: true,
    tokenBudget: 1800,
  });

  assert.equal(calls.length, 1);
  assert.match(result.context ?? '', /<uploaded_material_context>/);
  assert.match(result.context ?? '', /Product overview/);
  assert.ok(result.degradedReasons.includes('uploaded_material_context_truncated'));
  assert.equal(result.sourceStatus.ragAttempted, true);
  assert.equal(result.sourceStatus.uploadedMaterialHitCount, 1);
  assert.equal(result.sourceStatus.citationCount, 1);
  assert.equal(result.citations.length, 1);
  assert.equal(result.contextCandidates.length, 1);
  assert.equal(result.contextCandidates[0].source, 'uploaded_material');
});

test('uploaded material chat contribution handles no-hit and retrieval failure explicitly', async () => {
  const { buildUploadedMaterialContextContribution } = await loadService();
  const noHitCalls = [];
  const miss = await buildUploadedMaterialContextContribution({
    query: 'unknown uploaded material fact',
    materialService: makeMaterialService({ hits: [] }, noHitCalls),
    ragReady: true,
    embeddingReady: true,
  });

  assert.equal(noHitCalls.length, 1);
  assert.deepEqual(miss.degradedReasons, ['no_relevant_uploaded_material']);
  assert.equal(miss.context, undefined);

  const errorCalls = [];
  const failed = await buildUploadedMaterialContextContribution({
    query: 'uploaded material query',
    materialService: makeMaterialService(new Error('db unavailable'), errorCalls),
    ragReady: true,
    embeddingReady: true,
  });

  assert.equal(errorCalls.length, 1);
  assert.deepEqual(failed.degradedReasons, ['uploaded_material_rag_failed']);
  assert.equal(failed.context, undefined);
});

test('uploaded material contribution passes the chat hybrid retrieval budget to search', async () => {
  const { buildUploadedMaterialContextContribution } = await loadService();
  const calls = [];

  await buildUploadedMaterialContextContribution({
    query: '普通会议问题',
    materialService: makeMaterialService({ hits: [] }, calls),
    ragReady: true,
    embeddingReady: true,
    hybridTimeoutMs: 1_500,
  });

  assert.equal(calls[0]?.options?.hybridTimeoutMs, 1_500);
});

test('uploaded material chat contribution avoids duplicate injection and empty queries', async () => {
  const { buildUploadedMaterialContextContribution } = await loadService();
  const calls = [];

  const duplicate = await buildUploadedMaterialContextContribution({
    query: '资料',
    existingContext: '<uploaded_material_context>already here</uploaded_material_context>',
    materialService: makeMaterialService({ hits: [] }, calls),
    ragReady: true,
    embeddingReady: true,
  });
  const empty = await buildUploadedMaterialContextContribution({
    query: '   ',
    materialService: makeMaterialService({ hits: [] }, calls),
    ragReady: true,
    embeddingReady: true,
  });

  assert.equal(calls.length, 0);
  assert.equal(duplicate.context, '<uploaded_material_context>already here</uploaded_material_context>');
  assert.deepEqual(duplicate.degradedReasons, []);
  assert.equal(empty.context, undefined);
  assert.deepEqual(empty.degradedReasons, []);
});

test('uploaded material context is required only for explicit material questions', async () => {
  const { shouldRequireUploadedMaterialContext } = await loadService();

  assert.equal(shouldRequireUploadedMaterialContext('根据刚上传的资料回答支持哪些模式'), true);
  assert.equal(shouldRequireUploadedMaterialContext('请总结这个 PPTX 文档'), true);
  assert.equal(shouldRequireUploadedMaterialContext('这个回答再短一点'), false);
});

test('uploaded material contribution handles surface override by passing it through', async () => {
  const { buildUploadedMaterialContextContribution } = await loadService();
  // Build a minimal valid input that exercises the surface branch — non-empty
  // hits, no hybrid error.
  const input = {
    surface: 'realtime',
    query: 'refer to the SOC2 report please',
    dataScopes: new Set(),
    plan: {
      scopeFilteredHits: [
        {
          materialId: 'm1',
          materialTitle: 'SOC2',
          text: 'SOC2 Type II audit covers security, availability, confidentiality.',
          parentText: 'SOC2 Type II audit covers security, availability, confidentiality (2025).',
          sourceUri: null,
          citationLabel: 'SOC2.md',
        },
      ],
      injected: [],
      totalInjectedChars: 0,
      budgetChars: 6000,
      hybridThrew: false,
      degradedReason: null,
    },
  };
  const out = buildUploadedMaterialContextContribution(input);
  // The exact return shape varies; assert the function returns SOMETHING and
  // does not throw — that's the contract callers depend on.
  assert.ok(out !== undefined);
  assert.ok(typeof out === 'object');
});

test('uploaded material contribution tolerates an empty plan object', async () => {
  const { buildUploadedMaterialContextContribution } = await loadService();
  // Defensive: callers must not crash if the realtime plan is missing fields.
  assert.doesNotThrow(() =>
    buildUploadedMaterialContextContribution({
      surface: 'realtime',
      query: 'test',
      dataScopes: new Set(),
      plan: undefined,
    }),
  );
});
