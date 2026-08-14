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

test('aggregates recruiting lifecycle counts under modeQuality.recruiting', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [
      { name: 'dynamic_action_shown', timestamp: '2026-07-20T00:00:00.000Z', modeId: 'recruiting', properties: { actionType: 'candidate_concern' } },
      { name: 'dynamic_action_accepted', timestamp: '2026-07-20T00:00:01.000Z', modeId: 'recruiting', properties: { actionType: 'candidate_concern' } },
      { name: 'dynamic_action_completed', timestamp: '2026-07-20T00:00:02.000Z', modeId: 'recruiting', properties: { actionType: 'candidate_concern' } },
    ],
    fixtureResults: [],
    answerQualityMetrics: null,
  });

  assert.deepEqual(summary.modeQuality.recruiting, {
    shown: 1,
    accepted: 1,
    auto_generated: 0,
    dismissed: 0,
    expired: 0,
    generated_failed: 0,
    completed: 1,
  });
});

test('falls back to modeTemplateType for lifecycle events with custom mode ids', async () => {
  const { aggregateDynamicActionQaMetrics } = await load();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [
      {
        name: 'dynamic_action_shown',
        timestamp: '2026-08-14T03:00:37.644Z',
        modeId: 'mode_186d93c0-46bc-43d0-b8a8-c88d7f1182b7',
        properties: { actionType: 'case_study_request', modeTemplateType: 'sales' },
      },
    ],
    fixtureResults: [],
    answerQualityMetrics: null,
  });

  assert.equal(summary.modeQuality.sales.shown, 1);
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

test('aggregates continuation metrics and passes the quality gate', async () => {
  const { aggregateDynamicActionQaMetrics, evaluateContinuationQualityGate } = await load();
  const continuation = {
    fixtureId: 'c1',
    shouldEmit: true,
    initialActionCompleted: true,
    plannerCalls: 2,
    plannerCallsWithoutPending: 0,
    parentActionId: 'p1',
    childActionId: 'c1',
    derivedActionEmitted: true,
    duplicateDerivedActions: 0,
    unsafeVisibleAnswerCount: 0,
    finalTurnToDerivedCardMs: 120,
    visibleAnswerKind: 'generated',
    postCallCarryover: true,
    passed: true,
  };
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: [],
    fixtureResults: [],
    replayReport: {
      totalEntries: 2,
      skippedEntries: 0,
      failedEntries: 0,
      passedEntries: 2,
      environmentStatus: 'ok',
      assetCoverage: {
        requiredReal: { sales: 15, fde: 10, 'team-meet': 5 },
        availableReal: { sales: 0, fde: 0, 'team-meet': 0 },
        availableSynthetic: { sales: 4, fde: 2, 'team-meet': 1 },
        blockedReal: { sales: 15, fde: 10, 'team-meet': 5 },
      },
      entries: [
        { id: 'positive', status: 'passed', continuation },
        {
          id: 'negative',
          status: 'passed',
          continuation: {
            ...continuation,
            fixtureId: 'c2',
            shouldEmit: false,
            plannerCalls: 0,
            parentActionId: undefined,
            childActionId: undefined,
            derivedActionEmitted: false,
            finalTurnToDerivedCardMs: undefined,
            visibleAnswerKind: 'none',
            postCallCarryover: false,
          },
        },
      ],
    },
    answerQualityMetrics: null,
  });

  assert.equal(summary.continuation.derivedActionRecall, 1);
  assert.equal(summary.continuation.derivedActionFalsePositiveRate, 0);
  assert.equal(summary.continuation.parentChildCorrelationRate, 1);
  assert.deepEqual(summary.continuationGateFailures, []);
  assert.deepEqual(evaluateContinuationQualityGate(summary.continuation), []);
});

test('continuation quality gate reports every boundary failure', async () => {
  const { evaluateContinuationQualityGate } = await load();
  assert.deepEqual(evaluateContinuationQualityGate({
    plannerCallsWithoutPending: 1,
    maxPlannerCallsPerContinuation: 4,
    duplicateDerivedActions: 1,
    parentChildCorrelationRate: 0,
    unsafeVisibleAnswerCount: 1,
    derivedActionRecall: 0.79,
    derivedActionFalsePositiveRate: 0.1,
    finalTurnToDerivedCardP95Ms: 2000,
  }), [
    'planner_calls_without_pending',
    'planner_attempt_budget',
    'duplicate_derived_actions',
    'parent_child_correlation',
    'unsafe_visible_answer',
    'derived_action_recall',
    'derived_action_false_positive_rate',
    'final_turn_to_card_latency',
  ]);
});

test('recruiting release quality gate uses the explicit release thresholds', async () => {
  const {
    RECRUITING_RELEASE_GATES,
    evaluateRecruitingReleaseQualityGate,
  } = await load();
  assert.deepEqual(RECRUITING_RELEASE_GATES, {
    minimumRealMeetings: 5,
    minimumLabeledFinalTurns: 80,
    minimumPrecision: 0.9,
    minimumRecall: 0.8,
    maximumOverallFalsePositiveRateExclusive: 0.1,
    maximumPolicyVerificationFalsePositiveRateExclusive: 0.05,
    maximumExclusiveMultiCardRate: 0,
    maximumWrongSpeakerContinuationRate: 0,
    maximumUngroundedPositivePolicyCommitments: 0,
    maximumCandidateFacingEvidenceLeaks: 0,
    maximumDuplicateDerivedActions: 0,
    maximumUnsafeVisibleAnswerCount: 0,
    minimumDerivedActionRecall: 0.8,
    maximumDerivedActionFalsePositiveRateExclusive: 0.1,
    maximumFinalTurnToDerivedCardP95MsExclusive: 2000,
  });

  const passing = {
    realMeetingCount: 5,
    labeledFinalTurnCount: 80,
    precision: 0.9,
    recall: 0.8,
    overallFalsePositiveRate: 0.099,
    policyVerificationFalsePositiveRate: 0.049,
    exclusiveMultiCardRate: 0,
    wrongSpeakerContinuationRate: 0,
    ungroundedPositivePolicyCommitments: 0,
    candidateFacingEvidenceLeaks: 0,
    duplicateDerivedActions: 0,
    unsafeVisibleAnswerCount: 0,
    derivedActionRecall: 0.8,
    derivedActionFalsePositiveRate: 0.099,
    derivedActionLatencySampleCount: 1,
    finalTurnToDerivedCardP95Ms: 1999,
  };
  assert.deepEqual(evaluateRecruitingReleaseQualityGate(passing), []);

  assert.deepEqual(evaluateRecruitingReleaseQualityGate({
    ...passing,
    realMeetingCount: 4,
    labeledFinalTurnCount: 79,
    precision: 0.899,
    recall: 0.799,
    overallFalsePositiveRate: 0.1,
    policyVerificationFalsePositiveRate: 0.05,
    exclusiveMultiCardRate: 0.01,
    wrongSpeakerContinuationRate: 0.01,
    ungroundedPositivePolicyCommitments: 1,
    candidateFacingEvidenceLeaks: 1,
    duplicateDerivedActions: 1,
    unsafeVisibleAnswerCount: 1,
    derivedActionRecall: 0.799,
    derivedActionFalsePositiveRate: 0.1,
    derivedActionLatencySampleCount: 0,
    finalTurnToDerivedCardP95Ms: 2000,
  }), [
    'real_recruiting_meetings',
    'labeled_recruiting_final_turns',
    'precision',
    'recall',
    'overall_false_positive_rate',
    'policy_verification_false_positive_rate',
    'exclusive_multi_card_rate',
    'wrong_speaker_continuation_rate',
    'ungrounded_positive_policy_commitment',
    'candidate_facing_evidence_leak',
    'duplicate_derived_actions',
    'unsafe_visible_answer',
    'derived_action_recall',
    'derived_action_false_positive_rate',
    'derived_action_latency_sample_missing',
  ]);
});

test('parses telemetry JSONL with warnings for invalid lines', async () => {
  const { parseTelemetryJsonlLines } = await load();
  const parsed = parseTelemetryJsonlLines('{"name":"app_start","timestamp":"2026-07-07T00:00:00.000Z","properties":{}}\nnot-json\n\n');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /Invalid telemetry JSONL line 2/);
});
