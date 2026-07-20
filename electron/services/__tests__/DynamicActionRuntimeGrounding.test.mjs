import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadGrounding() {
  return import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionRuntimeGrounding.js',
  )).href);
}

test('marks only context candidates actually injected into the prompt as used', async () => {
  const { buildDynamicActionRuntimeGrounding } = await loadGrounding();
  const grounding = buildDynamicActionRuntimeGrounding({
    actionType: 'capability_fit_answer',
    realtimeContextPlan: {
      injected: [{
        source: 'uploaded_material',
        sourceId: 'material-1',
        chunkId: 'chunk-1',
        text: '能力矩阵确认支持压降分析。',
        tokenCount: 20,
      }],
      omitted: [{
        source: 'uploaded_material',
        sourceId: 'material-2',
        chunkId: 'chunk-2',
        text: '另一份材料声称支持全部温升分析。',
        tokenCount: 20,
        reason: 'uploaded_material_context_truncated',
      }],
      sourceStatus: {},
      degradedReasons: [],
      contextFingerprint: 'fp',
      retrievalTimingMs: {},
    },
    citations: [
      { citationId: 'c1', sourceType: 'uploaded_material', sourceId: 'material-1', chunkId: 'chunk-1', title: 'capability.pdf' },
      { citationId: 'c2', sourceType: 'uploaded_material', sourceId: 'material-2', chunkId: 'chunk-2', title: 'omitted.pdf' },
    ],
    materialRagAttempted: true,
    uploadedMaterialHitCount: 2,
    degradedReasons: ['uploaded_material_context_truncated'],
    businessSystemResult: { kind: 'skipped' },
  });
  assert.equal(grounding.injectedEvidence.length, 1);
  assert.equal(grounding.injectedEvidence[0].sourceId, 'material-1');
  assert.equal(grounding.groundedSources.filter((item) => item.status === 'used').length, 1);
  assert.doesNotMatch(JSON.stringify(grounding.groundedSources), /能力矩阵|温升分析/);
  assert.doesNotMatch(JSON.stringify(grounding.groundedSources), /material-2|omitted\.pdf/);
});

test('FDE grounded answers reuse injected material and business context grounding', async () => {
  const { buildDynamicActionRuntimeGrounding } = await loadGrounding();
  const grounding = buildDynamicActionRuntimeGrounding({
    actionType: 'fde_grounded_answer',
    realtimeContextPlan: {
      injected: [
        {
          source: 'uploaded_material',
          sourceId: 'fde-process.pdf',
          chunkId: 'eco',
          text: 'ECO 流程说明质量经理必须做人审。',
          tokenCount: 16,
        },
        {
          source: 'business_system',
          sourceId: 'windchill-readonly',
          chunkId: 'eco-query',
          text: 'Windchill 只读查询可用于 ECO 基本信息。',
          tokenCount: 16,
        },
      ],
      omitted: [],
      sourceStatus: {},
      degradedReasons: [],
      contextFingerprint: 'fp-fde',
      retrievalTimingMs: {},
    },
    citations: [
      { citationId: 'c-fde-1', sourceType: 'uploaded_material', sourceId: 'fde-process.pdf', chunkId: 'eco', title: 'fde-process.pdf' },
    ],
    materialRagAttempted: true,
    uploadedMaterialHitCount: 1,
    degradedReasons: [],
    businessSystemResult: { kind: 'context', status: 'ok', sourceName: 'Windchill' },
  });
  assert.equal(grounding.injectedEvidence.length, 2);
  assert.ok(grounding.groundedSources.some((source) => source.type === 'material' && source.status === 'used'));
  assert.ok(grounding.groundedSources.some((source) => source.type === 'business_context' && source.status === 'used'));
  assert.doesNotMatch(JSON.stringify(grounding.groundedSources), /ECO 流程|Windchill 只读/);
});
