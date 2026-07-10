import type { AnswerQualityMetrics } from '../../db/DatabaseManager';

type ModeId = 'sales' | 'fde' | 'team-meet';

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
  answerQualityMetrics: AnswerQualityMetrics | null;
}

const MODES: ModeId[] = ['sales', 'fde', 'team-meet'];

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
    answerQualityMetrics: input.answerQualityMetrics,
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
