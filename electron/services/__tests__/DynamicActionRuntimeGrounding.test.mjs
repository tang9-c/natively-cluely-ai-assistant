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

test('FDE grounded answers use uploaded material and do not treat business context as capability grounding', async () => {
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
  assert.equal(grounding.injectedEvidence.length, 1);
  assert.ok(grounding.groundedSources.some((source) => source.type === 'material' && source.status === 'used'));
  assert.equal(grounding.groundedSources.some((source) => source.type === 'business_context'), false);
  assert.doesNotMatch(JSON.stringify(grounding.groundedSources), /ECO 流程|Windchill 只读/);
});

test('case study runtime policy uses only uploaded material and never business system context', async () => {
  const { buildDynamicActionRuntimeGrounding } = await loadGrounding();
  const { getDynamicActionRuntimeValidationPolicy, buildDynamicActionRuntimeSafeFallback } = await import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionRuntimeValidationPolicy.js',
  )).href);
  const grounding = buildDynamicActionRuntimeGrounding({
    actionType: 'case_study_request',
    realtimeContextPlan: {
      injected: [
        { source: 'uploaded_material', sourceId: 'case-study.md', chunkId: 'roi', text: '跨境电商客户通过分阶段上线验证 ROI。', tokenCount: 12 },
        { source: 'business_system', sourceId: 'crm-live', chunkId: 'customer', text: 'CRM 客户状态查询结果。', tokenCount: 8 },
      ],
      omitted: [],
      sourceStatus: {},
      degradedReasons: [],
      contextFingerprint: 'case',
      retrievalTimingMs: {},
    },
    citations: [{ citationId: 'c-case', sourceType: 'uploaded_material', sourceId: 'case-study.md', chunkId: 'roi', title: 'case-study.md' }],
    materialRagAttempted: true,
    uploadedMaterialHitCount: 1,
    degradedReasons: [],
    businessSystemResult: { kind: 'context', status: 'ok', sourceName: 'CRM' },
  });

  assert.equal(getDynamicActionRuntimeValidationPolicy('case_study_request')?.evidenceKind, 'external_capability');
  assert.equal(grounding.injectedEvidence.length, 1);
  assert.equal(grounding.injectedEvidence[0].sourceId, 'case-study.md');
  assert.equal(grounding.groundedSources.some((source) => source.type === 'business_context'), false);
  assert.match(buildDynamicActionRuntimeSafeFallback('case_study_request', 'zh'), /没有找到可引用的匹配案例/);
});

test('recruiting runtime policy separates external policy and transcript evidence', async () => {
  const {
    buildDynamicActionRuntimeGrounding,
  } = await loadGrounding();
  const {
    getDynamicActionRuntimeValidationPolicy,
    buildDynamicActionRuntimeSafeFallback,
  } = await import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionRuntimeValidationPolicy.js',
  )).href);
  const realtimeContextPlan = {
    injected: [
      {
        source: 'uploaded_material',
        sourceId: 'recruiting-policy.pdf',
        chunkId: 'remote-work',
        text: '招聘政策说明远程办公需由招聘负责人确认。',
        tokenCount: 16,
      },
      {
        source: 'business_system',
        sourceId: 'windchill-readonly',
        chunkId: 'part',
        text: 'Windchill 只读查询结果。',
        tokenCount: 8,
      },
    ],
    omitted: [],
    sourceStatus: {},
    degradedReasons: [],
    contextFingerprint: 'recruiting',
    retrievalTimingMs: {},
  };
  const sharedInput = {
    realtimeContextPlan,
    citations: [{ citationId: 'c-policy', sourceType: 'uploaded_material', sourceId: 'recruiting-policy.pdf', chunkId: 'remote-work', title: 'recruiting-policy.pdf' }],
    materialRagAttempted: true,
    uploadedMaterialHitCount: 1,
    degradedReasons: [],
    businessSystemResult: { kind: 'context', status: 'ok', sourceName: 'Windchill' },
  };

  const concern = buildDynamicActionRuntimeGrounding({ actionType: 'candidate_concern', ...sharedInput });
  const summary = buildDynamicActionRuntimeGrounding({ actionType: 'candidate_evidence_summary', ...sharedInput });

  assert.deepEqual(getDynamicActionRuntimeValidationPolicy('candidate_concern'), {
    actionType: 'candidate_concern',
    evidenceKind: 'external_policy',
    claimDomain: 'recruiting_policy',
  });
  assert.equal(getDynamicActionRuntimeValidationPolicy('candidate_evidence_summary')?.evidenceKind, 'transcript_evidence');
  assert.equal(concern.injectedEvidence.length, 1);
  assert.equal(concern.injectedEvidence[0].type, 'material');
  assert.equal(summary.injectedEvidence.length, 0);
  assert.equal(summary.groundedSources.length, 0);
  assert.match(buildDynamicActionRuntimeSafeFallback('candidate_concern', 'zh'), /招聘材料不足/);
  assert.match(buildDynamicActionRuntimeSafeFallback('candidate_evidence_summary', 'zh'), /可验证岗位证据/);
});
