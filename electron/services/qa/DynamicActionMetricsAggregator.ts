import type { AnswerQualityMetrics } from '../../db/DatabaseManager';
import type { ReplayAssetCoverage, ReplayEnvironmentStatus, ReplayReport } from './DynamicActionReplayRunner';

type ModeId = 'sales' | 'fde' | 'team-meet' | 'recruiting';

export interface TelemetryLikeRecord {
  name: string;
  timestamp: string;
  sessionId?: string;
  modeId?: string;
  provider?: string;
  durationMs?: number;
  status?: string;
  properties?: Record<string, unknown>;
}

export interface AggregatorFixtureResult {
  fixtureId: string;
  actionType?: string;
  shouldEmit: boolean;
  emitted: boolean;
  actionTypeMatched: boolean;
  outputTypeMatched: boolean;
}

export interface DynamicActionMetricsInput {
  telemetryRecords: TelemetryLikeRecord[];
  fixtureResults: AggregatorFixtureResult[];
  replayReport?: ReplayReport | null;
  answerQualityMetrics: AnswerQualityMetrics | null;
}

export interface CountSummary {
  shown: number;
  accepted: number;
  auto_generated: number;
  dismissed: number;
  expired: number;
  generated_failed: number;
  completed: number;
}

export interface RateSummary {
  precision: number;
  recall: number;
  deferRate: number;
  cloudFallbackRate: number;
}

export interface TimingSummary {
  count: number;
  averageMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export interface DynamicActionQaSummary {
  modeQuality: Record<ModeId, CountSummary>;
  falsePositiveMissByAction: Record<string, RateSummary>;
  latency: {
    finalTranscriptToCardShown: TimingSummary;
    cardAcceptedToFirstToken: TimingSummary;
  };
  trustSources: {
    ragHit: number;
    pptxHit: number;
    windchillHit: number;
    screenUsed: number;
    scopeDenied: number;
    localFallback: number;
  };
  assetCoverage: ReplayAssetCoverage;
  environmentStatus: ReplayEnvironmentStatus;
  continuation: ContinuationQaMetrics;
  continuationGateFailures: string[];
  answerQualityMetrics: AnswerQualityMetrics | null;
}

export interface ContinuationQaMetrics {
  plannerCallsWithoutPending: number;
  maxPlannerCallsPerContinuation: number;
  duplicateDerivedActions: number;
  parentChildCorrelationRate: number;
  unsafeVisibleAnswerCount: number;
  derivedActionRecall: number;
  derivedActionFalsePositiveRate: number;
  finalTurnToDerivedCardP95Ms: number;
}

export interface RecruitingReleaseQualityMetrics {
  realMeetingCount: number;
  labeledFinalTurnCount: number;
  precision: number;
  recall: number;
  overallFalsePositiveRate: number;
  policyVerificationFalsePositiveRate: number;
  exclusiveMultiCardRate: number;
  wrongSpeakerContinuationRate: number;
  ungroundedPositivePolicyCommitments: number;
  candidateFacingEvidenceLeaks: number;
  duplicateDerivedActions: number;
  unsafeVisibleAnswerCount: number;
  derivedActionRecall: number;
  derivedActionFalsePositiveRate: number;
  derivedActionLatencySampleCount: number;
  finalTurnToDerivedCardP95Ms: number | null;
}

export const RECRUITING_RELEASE_GATES = {
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
} as const;

const MODES: ModeId[] = ['sales', 'fde', 'team-meet', 'recruiting'];

export function parseTelemetryJsonlLines(content: string): {
  records: TelemetryLikeRecord[];
  warnings: string[];
} {
  const records: TelemetryLikeRecord[] = [];
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as TelemetryLikeRecord;
      if (parsed && typeof parsed.name === 'string') {
        records.push({ ...parsed, properties: parsed.properties ?? {} });
      } else {
        warnings.push(`Invalid telemetry JSONL line ${index + 1}: missing name`);
      }
    } catch {
      warnings.push(`Invalid telemetry JSONL line ${index + 1}: parse failed`);
    }
  });

  return { records, warnings };
}

export function aggregateDynamicActionQaMetrics(input: DynamicActionMetricsInput): DynamicActionQaSummary {
  const modeQuality = makeModeQuality();
  const actionBuckets = new Map<string, { tp: number; fp: number; expected: number; deferred: number; fallback: number }>();
  const finalToShown: number[] = [];
  const acceptToToken: number[] = [];
  const trustSources = {
    ragHit: 0,
    pptxHit: 0,
    windchillHit: 0,
    screenUsed: 0,
    scopeDenied: 0,
    localFallback: 0,
  };

  for (const record of input.telemetryRecords) {
    const mode = normalizeMode(record.modeId);
    const actionType = stringProp(record.properties, 'actionType');

    if (mode && isLifecycleEvent(record.name, record.status)) {
      modeQuality[mode][lifecycleName(record.name, record.status)] += 1;
    }

    if (actionType && record.name === 'provider_fallback') {
      getBucket(actionBuckets, actionType).fallback += 1;
    }

    if (record.name === 'dynamic_action_shown' && stringProp(record.properties, 'latencyKind') === 'final_transcript_to_card_shown') {
      pushDuration(finalToShown, record.durationMs);
    }
    if (record.name === 'llm_first_token_latency' && stringProp(record.properties, 'source') === 'dynamic_action') {
      pushDuration(acceptToToken, record.durationMs);
    }
    if (record.name === 'rag_hit') {
      trustSources.ragHit += 1;
      if (stringProp(record.properties, 'source') === 'pptx') trustSources.pptxHit += 1;
    }
    if (record.name === 'screen_context_captured') trustSources.screenUsed += 1;
    if (record.name === 'provider_fallback' && record.status === 'local_fallback') trustSources.localFallback += 1;
    if (record.status === 'scope_denied' || stringProp(record.properties, 'degradedReason') === 'context_scope_denied') {
      trustSources.scopeDenied += 1;
    }
    if (stringProp(record.properties, 'source') === 'windchill') trustSources.windchillHit += 1;
  }

  for (const result of input.fixtureResults) {
    const actionType = result.actionType ?? 'unknown';
    const bucket = getBucket(actionBuckets, actionType);
    if (result.shouldEmit) {
      bucket.expected += 1;
      if (result.emitted && result.actionTypeMatched && result.outputTypeMatched) bucket.tp += 1;
      if (!result.emitted) bucket.deferred += 1;
    } else if (result.emitted) {
      bucket.fp += 1;
    }
  }

  const continuation = aggregateContinuationMetrics(input.replayReport);
  return {
    modeQuality,
    falsePositiveMissByAction: Object.fromEntries([...actionBuckets.entries()].map(([actionType, bucket]) => [
      actionType,
      {
        precision: rate(bucket.tp, bucket.tp + bucket.fp),
        recall: rate(bucket.tp, bucket.expected),
        deferRate: rate(bucket.deferred, bucket.expected + bucket.fp),
        cloudFallbackRate: rate(bucket.fallback, bucket.expected + bucket.fp),
      },
    ])),
    latency: {
      finalTranscriptToCardShown: timing(finalToShown),
      cardAcceptedToFirstToken: timing(acceptToToken),
    },
    trustSources,
    assetCoverage: input.replayReport?.assetCoverage ?? emptyAssetCoverage(),
    environmentStatus: input.replayReport?.environmentStatus ?? 'not_applicable',
    continuation,
    continuationGateFailures: evaluateContinuationQualityGate(continuation),
    answerQualityMetrics: input.answerQualityMetrics,
  };
}

export function evaluateContinuationQualityGate(metrics: ContinuationQaMetrics): string[] {
  const failures: string[] = [];
  if (metrics.plannerCallsWithoutPending !== 0) failures.push('planner_calls_without_pending');
  if (metrics.maxPlannerCallsPerContinuation > 3) failures.push('planner_attempt_budget');
  if (metrics.duplicateDerivedActions !== 0) failures.push('duplicate_derived_actions');
  if (metrics.parentChildCorrelationRate !== 1) failures.push('parent_child_correlation');
  if (metrics.unsafeVisibleAnswerCount !== 0) failures.push('unsafe_visible_answer');
  if (metrics.derivedActionRecall < 0.8) failures.push('derived_action_recall');
  if (metrics.derivedActionFalsePositiveRate >= 0.1) failures.push('derived_action_false_positive_rate');
  if (metrics.finalTurnToDerivedCardP95Ms >= 2000) failures.push('final_turn_to_card_latency');
  return failures;
}

export function evaluateRecruitingReleaseQualityGate(metrics: RecruitingReleaseQualityMetrics): string[] {
  const failures: string[] = [];
  if (metrics.realMeetingCount < RECRUITING_RELEASE_GATES.minimumRealMeetings) {
    failures.push('real_recruiting_meetings');
  }
  if (metrics.labeledFinalTurnCount < RECRUITING_RELEASE_GATES.minimumLabeledFinalTurns) {
    failures.push('labeled_recruiting_final_turns');
  }
  if (metrics.precision < RECRUITING_RELEASE_GATES.minimumPrecision) failures.push('precision');
  if (metrics.recall < RECRUITING_RELEASE_GATES.minimumRecall) failures.push('recall');
  if (metrics.overallFalsePositiveRate >= RECRUITING_RELEASE_GATES.maximumOverallFalsePositiveRateExclusive) {
    failures.push('overall_false_positive_rate');
  }
  if (
    metrics.policyVerificationFalsePositiveRate >=
    RECRUITING_RELEASE_GATES.maximumPolicyVerificationFalsePositiveRateExclusive
  ) {
    failures.push('policy_verification_false_positive_rate');
  }
  if (metrics.exclusiveMultiCardRate > RECRUITING_RELEASE_GATES.maximumExclusiveMultiCardRate) {
    failures.push('exclusive_multi_card_rate');
  }
  if (metrics.wrongSpeakerContinuationRate > RECRUITING_RELEASE_GATES.maximumWrongSpeakerContinuationRate) {
    failures.push('wrong_speaker_continuation_rate');
  }
  if (
    metrics.ungroundedPositivePolicyCommitments >
    RECRUITING_RELEASE_GATES.maximumUngroundedPositivePolicyCommitments
  ) {
    failures.push('ungrounded_positive_policy_commitment');
  }
  if (metrics.candidateFacingEvidenceLeaks > RECRUITING_RELEASE_GATES.maximumCandidateFacingEvidenceLeaks) {
    failures.push('candidate_facing_evidence_leak');
  }
  if (metrics.duplicateDerivedActions > RECRUITING_RELEASE_GATES.maximumDuplicateDerivedActions) {
    failures.push('duplicate_derived_actions');
  }
  if (metrics.unsafeVisibleAnswerCount > RECRUITING_RELEASE_GATES.maximumUnsafeVisibleAnswerCount) {
    failures.push('unsafe_visible_answer');
  }
  if (metrics.derivedActionRecall < RECRUITING_RELEASE_GATES.minimumDerivedActionRecall) {
    failures.push('derived_action_recall');
  }
  if (
    metrics.derivedActionFalsePositiveRate >=
    RECRUITING_RELEASE_GATES.maximumDerivedActionFalsePositiveRateExclusive
  ) {
    failures.push('derived_action_false_positive_rate');
  }
  if (metrics.derivedActionLatencySampleCount === 0 || metrics.finalTurnToDerivedCardP95Ms === null) {
    failures.push('derived_action_latency_sample_missing');
  } else if (
    metrics.finalTurnToDerivedCardP95Ms >= RECRUITING_RELEASE_GATES.maximumFinalTurnToDerivedCardP95MsExclusive
  ) {
    failures.push('final_turn_to_card_latency');
  }
  return failures;
}

function aggregateContinuationMetrics(replayReport?: ReplayReport | null): ContinuationQaMetrics {
  const continuationResults = (replayReport?.entries ?? [])
    .map((entry) => entry.continuation)
    .filter(Boolean) as NonNullable<ReplayReport['entries'][number]['continuation']>[];
  const positives = continuationResults.filter((result) => result.shouldEmit);
  const negatives = continuationResults.filter((result) => !result.shouldEmit);
  const emitted = continuationResults.filter((result) => result.derivedActionEmitted);
  const emittedPositives = positives.filter((result) => result.derivedActionEmitted).length;
  const emittedNegatives = negatives.filter((result) => result.derivedActionEmitted).length;
  const correlated = emitted.filter((result) => Boolean(result.parentActionId && result.childActionId)).length;
  const latencies = continuationResults
    .map((result) => result.finalTurnToDerivedCardMs)
    .filter((value): value is number => Number.isFinite(value) && value >= 0);
  return {
    plannerCallsWithoutPending: continuationResults.reduce((sum, result) => sum + result.plannerCallsWithoutPending, 0),
    maxPlannerCallsPerContinuation: Math.max(0, ...continuationResults.map((result) => result.plannerCalls)),
    duplicateDerivedActions: continuationResults.reduce((sum, result) => sum + result.duplicateDerivedActions, 0),
    parentChildCorrelationRate: rate(correlated, emitted.length),
    unsafeVisibleAnswerCount: continuationResults.reduce((sum, result) => sum + result.unsafeVisibleAnswerCount, 0),
    derivedActionRecall: rate(emittedPositives, positives.length),
    derivedActionFalsePositiveRate: rate(emittedNegatives, negatives.length),
    finalTurnToDerivedCardP95Ms: timing(latencies).p95Ms ?? 0,
  };
}

function emptyAssetCoverage(): ReplayAssetCoverage {
  return {
    requiredReal: { sales: 15, fde: 10, 'team-meet': 5, recruiting: 5 },
    availableReal: { sales: 0, fde: 0, 'team-meet': 0, recruiting: 0 },
    availableSynthetic: { sales: 0, fde: 0, 'team-meet': 0, recruiting: 0 },
    blockedReal: { sales: 15, fde: 10, 'team-meet': 5, recruiting: 5 },
  };
}

function makeModeQuality(): Record<ModeId, CountSummary> {
  return Object.fromEntries(MODES.map((mode) => [
    mode,
    {
      shown: 0,
      accepted: 0,
      auto_generated: 0,
      dismissed: 0,
      expired: 0,
      generated_failed: 0,
      completed: 0,
    },
  ])) as Record<ModeId, CountSummary>;
}

function normalizeMode(modeId?: string): ModeId | null {
  return MODES.includes(modeId as ModeId) ? modeId as ModeId : null;
}

function isLifecycleEvent(name: string, status?: string): boolean {
  return [
    'dynamic_action_shown',
    'dynamic_action_accepted',
    'dynamic_action_auto_generated',
    'dynamic_action_dismissed',
    'dynamic_action_expired',
    'dynamic_action_generation_failed',
    'dynamic_action_completed',
  ].includes(name)
    || status === 'expired'
    || status === 'generated_failed';
}

function lifecycleName(name: string, status?: string): keyof CountSummary {
  if (name === 'dynamic_action_shown') return 'shown';
  if (name === 'dynamic_action_accepted') return 'accepted';
  if (name === 'dynamic_action_auto_generated') return 'auto_generated';
  if (name === 'dynamic_action_dismissed') return 'dismissed';
  if (name === 'dynamic_action_expired' || status === 'expired') return 'expired';
  if (name === 'dynamic_action_generation_failed' || status === 'generated_failed') return 'generated_failed';
  if (name === 'dynamic_action_completed') return 'completed';
  if (name === 'dynamic_action_accepted') return 'accepted';
  if (name === 'dynamic_action_dismissed') return 'dismissed';
  return 'shown';
}

function getBucket(
  buckets: Map<string, { tp: number; fp: number; expected: number; deferred: number; fallback: number }>,
  actionType: string,
) {
  if (!buckets.has(actionType)) {
    buckets.set(actionType, { tp: 0, fp: 0, expected: 0, deferred: 0, fallback: 0 });
  }
  return buckets.get(actionType)!;
}

function stringProp(properties: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = properties?.[key];
  return typeof value === 'string' ? value : undefined;
}

function pushDuration(target: number[], durationMs?: number): void {
  if (Number.isFinite(durationMs) && durationMs! >= 0) target.push(durationMs!);
}

function timing(values: number[]): TimingSummary {
  if (values.length === 0) return { count: 0, averageMs: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    averageMs: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
    maxMs: sorted[sorted.length - 1],
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
