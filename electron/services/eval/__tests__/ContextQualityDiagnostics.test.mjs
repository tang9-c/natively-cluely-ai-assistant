import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
          arbitrationStatus: 'local_only_not_needed',
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
          arbitrationStatus: 'cloud_used',
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
          arbitrationStatus: 'local_fallback_cloud_unavailable',
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
  assert.equal(summary.dynamicActions.arbitrationStatuses.local_only_not_needed, 1);
  assert.equal(summary.dynamicActions.arbitrationStatuses.cloud_used, 1);
  assert.equal(summary.dynamicActions.arbitrationStatuses.local_fallback_cloud_unavailable, 1);
  assert.equal(summary.dynamicActions.cloudUsedRate, 1 / 3);
  assert.equal(summary.dynamicActions.localOnlyNotNeededRate, 1 / 3);
  assert.equal(summary.dynamicActions.cloudFallbackRate, 1 / 3);
  assert.equal(summary.dynamicActions.cloudArbitrationRate, 1 / 3);
  assert.equal(summary.dynamicActions.cloudUnavailableRate, 1 / 3);
  assert.equal(summary.dynamicActions.localFallbackRate, 0);
  assert.equal(summary.dynamicActions.localFallbackRejectRate, 0);
  assert.equal(summary.dynamicActions.degradedReasons.cloud_semantic_gate_unavailable, 1);
  assert.equal(summary.answerQuality.p95LatencyMs, 1500);
  assert.equal(summary.answerQuality.ragHitRate, 0.5);
  assert.equal(summary.context.injectedSources.uploaded_material, 1);
  assert.equal(summary.context.omittedSources.short_term_history, 1);
  assert.equal(summary.context.degradedReasons.business_system_timeout, 1);
  assert.equal(summary.context.tokenBudgetDropCount, 2);
  assert.equal(summary.context.nonTokenBudgetOmitCount, 1);
  assert.equal(summary.context.retrievalTimingMs.business_system.p95, 120);
  assert.doesNotMatch(JSON.stringify(summary), /pricing page|case study|technical solution/);
});

test('context quality diagnostics count fallback and omitted context reasons precisely', async () => {
  const { summarizeContextQualityDiagnostics } = await loadDiagnostics();
  const dynamicActions = [];
  const decisions = ['pass', 'reject', 'defer', 'pass'];
  for (let index = 0; index < 20; index++) {
    const decision = decisions[index % decisions.length];
    const fallback = index === 0 || index === 1;
    dynamicActions.push({
      type: index % 2 === 0 ? 'pricing_objection' : 'case_study_request',
      semanticGate: {
        decision,
        actionType: index % 2 === 0 ? 'pricing_objection' : 'case_study_request',
        confidence: 0.7,
        reasons: fallback
          ? ['cloud_unavailable_local_fallback']
          : index === 2
            ? ['provider_scope_denied']
            : index === 3
              ? ['plan_denied_for_future_reason']
              : ['neutral_pricing_reference'],
        regexCandidates: [`candidate_${index}`],
        rejectedCandidates: [],
        usedLocalIntentModel: fallback,
        usedCloudArbitration: false,
        semanticProvider: index === 2 ? 'unavailable' : 'local_intent',
        degradedReason: index === 2 ? 'provider_scope_denied' : undefined,
        arbitrationStatus: fallback
          ? 'local_fallback_cloud_unavailable'
          : index === 2
            ? 'local_only_by_privacy'
            : 'local_only_not_needed',
        upgradedByRepeatedEvidence: false,
      },
    });
  }

  const summary = summarizeContextQualityDiagnostics({
    dynamicActions,
    contextPlans: [
      {
        injectedSources: ['current_transcript'],
        omittedSources: [
          { source: 'short_term_history', reason: 'assistant_history_truncated' },
          { source: 'uploaded_material', reason: 'duplicate_context_dropped' },
        ],
        degradedReasons: ['screen_context_truncated'],
        retrievalTimingMs: {
          '': 55,
          business_system: 100,
          uploaded_material: -1,
          screen_context: Number.POSITIVE_INFINITY,
        },
      },
    ],
  });

  assert.equal(summary.dynamicActions.total, 20);
  assert.equal(summary.dynamicActions.localFallbackRate, 2 / 20);
  assert.equal(summary.dynamicActions.localFallbackPassRate, 1 / 20);
  assert.equal(summary.dynamicActions.localFallbackRejectRate, 1 / 20);
  assert.equal(summary.dynamicActions.cloudUnavailableRate, 2 / 20);
  assert.equal(summary.dynamicActions.arbitrationStatuses.local_fallback_cloud_unavailable, 2);
  assert.equal(summary.dynamicActions.arbitrationStatuses.local_only_by_privacy, 1);
  assert.equal(summary.dynamicActions.privacyLocalRate, 1 / 20);
  assert.equal(summary.dynamicActions.degradedReasons.provider_scope_denied, 1);
  assert.equal(summary.dynamicActions.degradedReasons.plan_denied_for_future_reason, undefined);
  assert.equal(summary.context.tokenBudgetDropCount, 2);
  assert.equal(summary.context.nonTokenBudgetOmitCount, 1);
  assert.equal(summary.context.retrievalTimingMs[''], undefined);
  assert.equal(summary.context.retrievalTimingMs.uploaded_material, undefined);
  assert.equal(summary.context.retrievalTimingMs.screen_context, undefined);
  assert.equal(summary.context.retrievalTimingMs.business_system.average, 100);
});

test('context quality diagnostics aggregate continuation traces without raw content', async () => {
  const { summarizeContextQualityDiagnostics } = await loadDiagnostics();
  const summary = summarizeContextQualityDiagnostics({
    dynamicActionContinuationEvents: [
      {
        event: 'registered',
        sessionId: 's1',
        parentActionId: 'parent-1',
        plannerAttempts: 0,
        observedCustomerTurns: 0,
        text: 'PRIVATE_CUSTOMER_TURN_SHOULD_NOT_APPEAR',
      },
      {
        event: 'degraded',
        sessionId: 's1',
        parentActionId: 'parent-1',
        reasonCode: 'provider_scope_denied',
        plannerAttempts: 1,
        observedCustomerTurns: 2,
        text: 'PRIVATE_CUSTOMER_TURN_SHOULD_NOT_APPEAR',
      },
    ],
  });

  assert.equal(summary.continuation.events.registered, 1);
  assert.equal(summary.continuation.events.degraded, 1);
  assert.equal(summary.continuation.reasons.provider_scope_denied, 1);
  assert.equal(summary.continuation.plannerAttempts, 1);
  assert.equal(summary.continuation.observedCustomerTurns, 2);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_CUSTOMER_TURN_SHOULD_NOT_APPEAR/);
});

test('context quality diagnostics collector stores only summary-safe fields', async () => {
  const {
    ContextQualityDiagnosticsCollector,
    summarizeContextQualityDiagnostics,
  } = await loadDiagnostics();
  const collector = new ContextQualityDiagnosticsCollector();

  collector.recordDynamicActionTrace({
    decision: 'reject',
    actionType: 'pricing_request',
    confidence: 0.82,
    reasons: ['neutral_pricing_reference', 'cloud_unavailable_local_fallback'],
    regexCandidates: ['pricing_request:pricing page secret customer transcript'],
    rejectedCandidates: ['pricing_request'],
    usedLocalIntentModel: true,
    usedCloudArbitration: false,
    semanticProvider: 'local_intent',
    arbitrationStatus: 'local_fallback_cloud_unavailable',
    upgradedByRepeatedEvidence: false,
  });
  collector.recordContextPlan({
    injectedSources: ['current_transcript'],
    omittedSources: [{ source: 'uploaded_material', reason: 'duplicate_context_dropped' }],
    degradedReasons: ['duplicate_context_dropped'],
    retrievalTimingMs: { business_system: 42 },
  });

  const snapshot = collector.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /secret customer transcript|pricing page/);
  const summary = summarizeContextQualityDiagnostics(snapshot);
  assert.equal(summary.dynamicActions.localFallbackRejectRate, 1);
  assert.equal(summary.context.nonTokenBudgetOmitCount, 1);
});

test('context quality diagnostics aggregates safe dynamic action lifecycle events', async () => {
  const {
    ContextQualityDiagnosticsCollector,
    summarizeContextQualityDiagnostics,
  } = await loadDiagnostics();
  const collector = new ContextQualityDiagnosticsCollector();

  collector.recordDynamicActionLifecycleEvent({
    event: 'shown',
    actionType: 'pricing_objection',
    modeTemplateType: 'sales',
    outputType: 'spoken_response',
    riskState: 'normal',
    status: 'shown',
  });
  collector.recordDynamicActionLifecycleEvent({
    event: 'accepted',
    actionType: 'pricing_objection',
    modeTemplateType: 'sales',
    outputType: 'spoken_response',
    riskState: 'normal',
    status: 'accepted',
  });
  collector.recordDynamicActionLifecycleEvent({
    event: 'generated_failed',
    actionType: 'pricing_objection',
    modeTemplateType: 'sales',
    outputType: 'spoken_response',
    riskState: 'normal',
    status: 'generated_failed',
  });

  const snapshot = collector.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /price is too expensive|promptInstruction|provider error/);

  const summary = summarizeContextQualityDiagnostics(snapshot);
  assert.equal(summary.dynamicActions.lifecycleEvents.shown, 1);
  assert.equal(summary.dynamicActions.lifecycleEvents.accepted, 1);
  assert.equal(summary.dynamicActions.lifecycleEvents.generated_failed, 1);
});

test('dynamic action lifecycle diagnostics preserve ids trigger source and generation status', async () => {
  const {
    ContextQualityDiagnosticsCollector,
    summarizeContextQualityDiagnostics,
  } = await loadDiagnostics();
  const collector = new ContextQualityDiagnosticsCollector();

  collector.recordDynamicActionLifecycleEvent({
    event: 'auto_generated',
    actionId: 'action_auto_1',
    actionType: 'pricing_objection',
    modeId: 'sales',
    modeTemplateType: 'sales',
    outputType: 'spoken_response',
    riskState: 'auto_countdown',
    triggerSource: 'auto_countdown',
    generationStatus: 'completed',
    status: 'completed',
  });

  const snapshot = collector.snapshot();
  assert.equal(snapshot.dynamicActionLifecycleEvents[0].actionId, 'action_auto_1');
  assert.equal(snapshot.dynamicActionLifecycleEvents[0].modeId, 'sales');
  assert.equal(snapshot.dynamicActionLifecycleEvents[0].triggerSource, 'auto_countdown');
  assert.equal(snapshot.dynamicActionLifecycleEvents[0].generationStatus, 'completed');

  const summary = summarizeContextQualityDiagnostics(snapshot);
  assert.equal(summary.dynamicActions.lifecycleEvents.auto_generated, 1);
});

test('context quality diagnostics exposes safe dynamic action arbitration labels', async () => {
  const {
    getDynamicActionArbitrationStatusLabel,
    getDynamicActionArbitrationStatusMessage,
  } = await loadDiagnostics();

  assert.equal(getDynamicActionArbitrationStatusLabel('local_only_not_needed'), '本地');
  assert.equal(getDynamicActionArbitrationStatusLabel('cloud_used'), '云端');
  assert.equal(getDynamicActionArbitrationStatusLabel('local_only_by_privacy'), '隐私本地');
  assert.equal(getDynamicActionArbitrationStatusLabel('local_fallback_cloud_unavailable'), '本地兜底');
  assert.equal(getDynamicActionArbitrationStatusLabel('cloud_unavailable'), '云端不可用');
  assert.equal(getDynamicActionArbitrationStatusMessage('local_only_by_privacy'), '已按隐私设置仅使用本地判断');
  assert.equal(getDynamicActionArbitrationStatusMessage('local_fallback_cloud_unavailable'), '云端判定不可用，已使用本地兜底');
  assert.equal(getDynamicActionArbitrationStatusMessage('cloud_unavailable'), '云端判定不可用，已暂缓高风险动作');

  const raw = 'secret transcript prompt provider stack body';
  const serialized = JSON.stringify([
    getDynamicActionArbitrationStatusLabel('local_fallback_cloud_unavailable'),
    getDynamicActionArbitrationStatusMessage('local_fallback_cloud_unavailable'),
  ]);
  assert.doesNotMatch(serialized, new RegExp(raw));
});

test('dynamic action cloud adapter preserves typed failure reasons for production diagnostics', () => {
  const source = fs.readFileSync(path.resolve(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  const methodSource = source.slice(
    source.indexOf('private async classifyDynamicActionWithCloud'),
    source.indexOf('constructor(llmHelper', source.indexOf('private async classifyDynamicActionWithCloud')),
  );

  assert.match(methodSource, /throw new CloudSemanticGateError\(cloudFailureReasonFromError\(error\)\)/);
  assert.match(methodSource, /throw new CloudSemanticGateError\('cloud_invalid_json'\)/);
  assert.doesNotMatch(methodSource, /catch\s*\([^)]*\)\s*\{[\s\S]{0,220}return null;/);
});

test('ordinary meeting UI does not expose dynamic action arbitration diagnostics', () => {
  const source = fs.readFileSync(path.resolve(root, 'src/components/NativelyInterface.tsx'), 'utf8');
  assert.doesNotMatch(source, /provider_scope_denied|cloud_timeout|cloud_invalid_json|cloud_provider_unavailable/);
  assert.doesNotMatch(source, /云端判定不可用|已按隐私设置仅使用本地判断/);
});

test('context quality diagnostics collector keeps a bounded recent sample', async () => {
  const { ContextQualityDiagnosticsCollector } = await loadDiagnostics();
  const collector = new ContextQualityDiagnosticsCollector({ maxEntries: 3 });

  for (let index = 0; index < 5; index++) {
    collector.recordDynamicActionTrace({
      decision: 'reject',
      actionType: `action_${index}`,
      confidence: 0.4,
      reasons: ['neutral_pricing_reference'],
      regexCandidates: [`action_${index}:secret transcript ${index}`],
      rejectedCandidates: [],
      usedLocalIntentModel: true,
      usedCloudArbitration: false,
      semanticProvider: 'local_intent',
      upgradedByRepeatedEvidence: false,
    });
    collector.recordContextPlan({
      injectedSources: ['current_transcript'],
      omittedSources: [{ source: 'uploaded_material', reason: 'duplicate_context_dropped' }],
      degradedReasons: ['duplicate_context_dropped'],
      retrievalTimingMs: { business_system: index },
    });
  }

  const snapshot = collector.snapshot();
  assert.equal(snapshot.dynamicActions?.length, 3);
  assert.equal(snapshot.contextPlans?.length, 3);
  assert.deepEqual(snapshot.dynamicActions?.map((action) => action.type), ['action_2', 'action_3', 'action_4']);
});

test('context quality diagnostics summarize code hint traces without raw content', async () => {
  const {
    ContextQualityDiagnosticsCollector,
    summarizeContextQualityDiagnostics,
  } = await loadDiagnostics();
  const collector = new ContextQualityDiagnosticsCollector({ maxEntries: 2 });

  collector.recordCodeHintTrace({
    entrypoint: 'code_hint',
    status: 'blocked',
    dataScopesRequested: ['screenshots'],
    dataScopesDenied: ['screenshots'],
    usedContextSources: [],
    sourceStatus: { screenContextStatus: 'blocked', transcriptStatus: 'not_used' },
    degradedReasons: ['screen_context_scope_blocked'],
    usedVision: false,
    usedTranscript: false,
    provider: 'gemini',
  });
  collector.recordCodeHintTrace({
    entrypoint: 'code_hint',
    status: 'generated',
    dataScopesRequested: ['screenshots'],
    dataScopesDenied: [],
    usedContextSources: ['screenshots'],
    sourceStatus: { screenContextStatus: 'available', transcriptStatus: 'not_used' },
    degradedReasons: [],
    usedVision: true,
    usedTranscript: false,
    provider: 'gemini',
  });
  collector.recordCodeHintTrace({
    entrypoint: 'code_hint',
    status: 'failed',
    dataScopesRequested: ['screenshots'],
    dataScopesDenied: [],
    usedContextSources: ['screenshots'],
    sourceStatus: { screenContextStatus: 'failed', transcriptStatus: 'not_used' },
    degradedReasons: ['screen_context_failed'],
    usedVision: true,
    usedTranscript: false,
    provider: 'gemini',
  });

  const snapshot = collector.snapshot();
  const summary = summarizeContextQualityDiagnostics(snapshot);

  assert.equal(snapshot.codeHints?.length, 2);
  assert.equal(summary.codeHints.total, 2);
  assert.equal(summary.codeHints.statuses.generated, 1);
  assert.equal(summary.codeHints.statuses.failed, 1);
  assert.equal(summary.codeHints.degradedReasons.screen_context_failed, 1);
  assert.equal(summary.codeHints.scopeDeniedRate, 0);
  assert.equal(summary.codeHints.visionUsageRate, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|screenshot\.png|prompt|code body/);

  collector.clear();
  assert.equal(collector.snapshot().codeHints?.length, 0);
});

test('context quality smoke report marks default collector snapshot as process-local', () => {
  const output = execFileSync('node', ['scripts/context-quality-smoke-report.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'process_local_snapshot');
  assert.equal(parsed.source, 'collector');
  assert.match(parsed.warning, /process-local/i);
  assert.equal(parsed.summary.dynamicActions.total, 0);
  assert.equal(parsed.summary.context.nonTokenBudgetOmitCount, 0);
});

test('context quality smoke report explains missing electron build output', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-quality-smoke-'));
  try {
    assert.throws(
      () => execFileSync('node', [path.join(root, 'scripts/context-quality-smoke-report.mjs')], {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
      /run npm run build:electron first/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
