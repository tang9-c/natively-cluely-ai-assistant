import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const modulePath = path.resolve(
  import.meta.dirname,
  '../../../../dist-electron/shared/realtimeAnswerTrustViewModel.js',
);

async function loadViewModel() {
  return import(modulePath);
}

test('electron build emits shared trust view model sources', () => {
  assert.ok(
    fs.existsSync(modulePath),
    `expected Electron build output at ${modulePath}`,
  );
});

test('latest answer explanation uses single-answer trace and strips sensitive fixture content', async () => {
  const { buildLatestAnswerTrustExplanation } = await loadViewModel();
  const explanation = buildLatestAnswerTrustExplanation({
    trace: {
      contextUsed: { currentTranscript: true, uploadedDocumentRag: true, screenContext: false },
      sourceStatus: {
        ragReady: true,
        ragAttempted: true,
        embeddingReady: true,
        uploadedMaterialHitCount: 1,
        citationCount: 1,
        screenContextStatus: 'not_used',
        transcriptStatus: 'used',
      },
      citations: [],
      degradedReason: null,
    },
    citationStatus: 'candidate',
    citations: [
      {
        citationId: 'citation-safe',
        sourceType: 'uploaded_material',
        sourceId: 'material-1',
        title: 'Product FAQ',
      },
    ],
    degradedReason: null,
    forbiddenFixture: {
      transcript: 'SECRET_TRANSCRIPT_SHOULD_NOT_LEAK',
      prompt: 'SECRET_PROMPT_SHOULD_NOT_LEAK',
      screenshotPath: '/tmp/SECRET_SCREENSHOT.png',
      materialText: 'SECRET_CHUNK_TEXT_SHOULD_NOT_LEAK',
      evidenceText: 'SECRET_ACTION_EVIDENCE_SHOULD_NOT_LEAK',
    },
  });

  assert.equal(explanation.usedUploadedMaterial, true);
  assert.equal(explanation.materialHitCount, 1);
  assert.equal(explanation.citationStatus, 'candidate');
  assert.ok(explanation.primaryMessages.some((message) => message.includes('已使用上传资料')));
  const serialized = JSON.stringify(explanation);
  assert.doesNotMatch(serialized, /SECRET_TRANSCRIPT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_PROMPT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_SCREENSHOT/);
  assert.doesNotMatch(serialized, /SECRET_CHUNK_TEXT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_ACTION_EVIDENCE_SHOULD_NOT_LEAK/);
});

test('latest answer explanation does not treat unresolved citation candidates as verified sources', async () => {
  const { buildLatestAnswerTrustExplanation } = await loadViewModel();
  const explanation = buildLatestAnswerTrustExplanation({
    trace: {
      contextUsed: { currentTranscript: true, uploadedDocumentRag: true },
      sourceStatus: {
        ragReady: true,
        ragAttempted: true,
        embeddingReady: true,
        uploadedMaterialHitCount: 1,
        citationCount: 1,
        transcriptStatus: 'used',
      },
    },
    citationStatus: 'candidate',
    citations: [{ citationId: 'candidate-only', sourceType: 'uploaded_material', title: 'FAQ' }],
  });

  assert.equal(explanation.usedUploadedMaterial, true);
  assert.equal(explanation.citationStatus, 'candidate');
  assert.equal(explanation.hasCitationCandidate, true);
  assert.equal(explanation.primaryMessages.some((message) => /已确认引用可打开/.test(message)), false);
});

test('latest answer explanation distinguishes material miss from retrieval failure', async () => {
  const { buildLatestAnswerTrustExplanation } = await loadViewModel();
  const explanation = buildLatestAnswerTrustExplanation({
    trace: {
      contextUsed: { currentTranscript: true, uploadedDocumentRag: false },
      sourceStatus: {
        ragReady: true,
        ragAttempted: true,
        embeddingReady: true,
        uploadedMaterialHitCount: 0,
        citationCount: 0,
        screenContextStatus: 'not_used',
        transcriptStatus: 'used',
      },
      citations: [],
      degradedReason: 'no_relevant_uploaded_material',
    },
    citations: [],
    degradedReason: 'no_relevant_uploaded_material',
  });

  assert.equal(explanation.usedUploadedMaterial, false);
  assert.equal(explanation.materialHitCount, 0);
  assert.ok(explanation.primaryMessages.some((message) => /没有匹配到相关上传资料/.test(message)));
  assert.equal(explanation.reasonCodes.includes('no_relevant_uploaded_material'), true);
});

test('latest answer explanation uses transient chat source status when no answer trace exists', async () => {
  const { buildLatestAnswerTrustExplanation } = await loadViewModel();
  const explanation = buildLatestAnswerTrustExplanation({
    trace: null,
    sourceStatusFallback: {
      ragReady: true,
      ragAttempted: true,
      embeddingReady: true,
      uploadedMaterialHitCount: 1,
      citationCount: 1,
    },
    citations: [],
  });

  assert.equal(explanation.usedUploadedMaterial, true);
  assert.equal(explanation.materialHitCount, 1);
  assert.ok(explanation.sourceLabels.includes('上传资料'));
});

test('embedding degradation copy separates config, indexing, and query fallback states', async () => {
  const { mapTrustReasonToCopy } = await loadViewModel();

  assert.equal(
    mapTrustReasonToCopy('embedding_not_configured'),
    '未配置语义检索。CueUp 会对上传资料使用关键词匹配。',
  );
  assert.equal(
    mapTrustReasonToCopy('embedding_failed'),
    '资料文本可用，但语义索引失败。CueUp 仍可尝试关键词匹配。',
  );
  assert.equal(
    mapTrustReasonToCopy('hybrid_threw'),
    '这次语义检索失败，CueUp 已使用关键词匹配。',
  );
});

test('material status reports a missing PDF parser component instead of blaming the file', async () => {
  const { explainMaterialStatus } = await loadViewModel();
  const explanation = explainMaterialStatus({
    status: 'failed',
    errorCode: 'pdf_parser_component_missing',
  });

  assert.equal(explanation.label, '索引失败');
  assert.equal(explanation.message, 'PDF 解析组件缺失，请更新或重新安装 CueUp 后重试。');
  assert.equal(explanation.severity, 'error');
});

test('material status distinguishes PDF runtime failures from damaged input', async () => {
  const { explainMaterialStatus } = await loadViewModel();
  const expectedByCode = {
    pdf_parse_timeout: 'PDF 解析超时，请重试；如果仍失败，请拆分文件后重新上传。',
    pdf_worker_failed: 'PDF 解析进程异常，请重试上传。',
    pdf_access_failed: 'CueUp 无法继续读取该 PDF，请重新选择文件后上传。',
  };

  for (const [errorCode, expectedMessage] of Object.entries(expectedByCode)) {
    const explanation = explainMaterialStatus({ status: 'failed', errorCode });
    assert.equal(explanation.message, expectedMessage);
    assert.doesNotMatch(explanation.message, /更干净的副本|文件损坏/);
  }
});

test('material status distinguishes PPTX process failures from invalid files', async () => {
  const { explainMaterialStatus } = await loadViewModel();
  const expectedByCode = {
    pptx_render_timeout: 'PPTX 渲染超时，请重试；如果仍失败，请拆分文件后重新上传。',
    pptx_render_process_start_failed: 'PPTX 渲染进程无法启动，请重启 CueUp 后重试。',
    pptx_render_process_crashed: 'PPTX 渲染进程异常退出，请重试上传。',
    pptx_render_child_failed: 'PPTX 渲染失败，请重试上传。',
    pptx_render_failed: 'PPTX 渲染失败，请重试上传。',
    pptx_input_access_failed: 'CueUp 无法读取所选 PPTX，请重新选择文件后上传。',
    pptx_render_input_read_failed: 'PPTX 临时副本读取失败，请重试上传。',
    pptx_renderer_dependency_missing: 'PPTX 渲染组件缺失，请更新或重新安装 CueUp 后重试。',
  };

  for (const [errorCode, expectedMessage] of Object.entries(expectedByCode)) {
    const explanation = explainMaterialStatus({ status: 'failed', errorCode });
    assert.equal(explanation.message, expectedMessage);
    assert.doesNotMatch(explanation.message, /另存为标准|文件已损坏/);
  }
});

test('failed material guidance is honest about replacement upload', async () => {
  const { explainMaterialStatus } = await loadViewModel();
  const unsupported = explainMaterialStatus({
    id: 'm1',
    title: 'deck.pptx',
    status: 'failed',
    errorCode: 'unsupported_file_type',
    errorMessage: 'unsupported',
  });

  assert.equal(unsupported.canReindex, false);
  assert.equal(unsupported.primaryActionLabel, '重新上传新文件');
  assert.match(unsupported.message, /暂不支持此格式/);
  assert.doesNotMatch(unsupported.message, /重试此资料/);

  const complete = explainMaterialStatus({
    id: 'm2',
    title: 'faq.pdf',
    status: 'complete',
  });
  assert.equal(complete.canReindex, true);
  assert.equal(complete.primaryActionLabel, '重新索引');
});

test('interrupted material indexing asks for a new upload instead of staying in progress', async () => {
  const { explainMaterialStatus } = await loadViewModel();
  const explanation = explainMaterialStatus({
    id: 'interrupted-material',
    title: 'knowledge.md',
    status: 'failed',
    errorCode: 'index_interrupted',
  });

  assert.equal(explanation.label, '索引失败');
  assert.equal(explanation.message, '上次资料索引因 CueUp 异常退出而中断，请重新上传该文件。');
  assert.equal(explanation.severity, 'error');
  assert.equal(explanation.canReindex, false);
  assert.equal(explanation.primaryActionLabel, '重新上传新文件');
});

test('dynamic action explanation uses semantic gate metadata when present and conservative copy otherwise', async () => {
  const { explainDynamicAction } = await loadViewModel();
  const gated = explainDynamicAction({
    type: 'case_study_request',
    semanticGate: {
      decision: 'pass',
      actionType: 'case_study_request',
      confidence: 0.91,
      reasons: ['cloud_confirmed_case_request'],
      regexCandidates: [],
      rejectedCandidates: [],
      usedLocalIntentModel: false,
      usedCloudArbitration: true,
      semanticProvider: 'cloud_llm',
      arbitrationStatus: 'cloud_used',
      upgradedByRepeatedEvidence: false,
    },
  });
  assert.equal(gated.traceComplete, true);
  assert.match(gated.message, /已通过语义门控/);

  const fallback = explainDynamicAction({ type: 'case_study_request' });
  assert.equal(fallback.traceComplete, false);
  assert.equal(fallback.message, '基于会议信号触发。');

  const deferred = explainDynamicAction({
    type: 'pricing_objection',
    semanticGate: {
      decision: 'defer',
      actionType: 'pricing_objection',
      confidence: 0.42,
      reasons: ['provider_scope_denied'],
      regexCandidates: [],
      rejectedCandidates: [],
      usedLocalIntentModel: false,
      usedCloudArbitration: false,
      semanticProvider: 'unavailable',
      arbitrationStatus: 'local_only_by_privacy',
      upgradedByRepeatedEvidence: false,
    },
  });
  assert.equal(deferred.message, '基于会议信号触发。');
  assert.equal(deferred.traceComplete, false);
});

test('aggregate diagnostics mark low sample sizes and use persisted metrics source', async () => {
  const { buildRealtimeDiagnosticsSummary } = await loadViewModel();
  const summary = buildRealtimeDiagnosticsSummary({
    metrics: {
      shownCount: 2,
      copiedCount: 0,
      acceptedCount: 1,
      ignoredCount: 0,
      regeneratedCount: 1,
      averageLatencyMs: 900,
      p95LatencyMs: 1200,
      citationHitRate: 0.5,
      userAcceptanceRate: 0.5,
      regenerationRate: 0.5,
      ragHitRate: 0.5,
      noContextAnswerRate: 0,
    },
    sourceStatusCounts: { 'rag.hit': 1, 'citations.present': 1 },
    degradedReasons: { embedding_unavailable: 1 },
    traceSampleSize: 2,
    eventSampleSize: 2,
  });

  assert.equal(summary.source, 'persisted');
  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.traceSampleSize, 2);
  assert.equal(summary.eventSampleSize, 2);
  assert.equal(summary.insufficientData, true);
  assert.ok(summary.messages.some((message) => /样本不足/.test(message)));
});
