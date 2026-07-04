import type { AnswerQualityMetrics } from '../../db/DatabaseManager';
import type { SemanticGateTrace } from '../dynamic-actions/ModeEventClassifier';
import type { RealtimeContextSource } from '../context/RealtimeContextOrchestrator';

type Counter = Record<string, number>;

export interface ContextQualityDynamicActionInput {
    type?: string;
    semanticGate?: Partial<SemanticGateTrace>;
}

export interface ContextQualityPlanInput {
    injectedSources?: RealtimeContextSource[];
    omittedSources?: Array<{ source: RealtimeContextSource; reason?: string }>;
    degradedReasons?: string[];
    retrievalTimingMs?: Partial<Record<RealtimeContextSource, number>>;
}

export interface ContextQualityDiagnosticsInput {
    dynamicActions?: ContextQualityDynamicActionInput[];
    answerQualityMetrics?: AnswerQualityMetrics;
    contextPlans?: ContextQualityPlanInput[];
}

export interface TimingSummary {
    count: number;
    average: number;
    p95: number;
    max: number;
}

export interface ContextQualityDiagnosticsSummary {
    dynamicActions: {
        total: number;
        decisions: Counter;
        actionTypes: Counter;
        semanticProviders: Counter;
        degradedReasons: Counter;
        cloudArbitrationRate: number;
        cloudUnavailableRate: number;
        localFallbackPassRate: number;
    };
    answerQuality: AnswerQualityMetrics;
    context: {
        injectedSources: Counter;
        omittedSources: Counter;
        degradedReasons: Counter;
        tokenBudgetDropCount: number;
        retrievalTimingMs: Record<string, TimingSummary>;
    };
}

const EMPTY_ANSWER_QUALITY: AnswerQualityMetrics = {
    shownCount: 0,
    copiedCount: 0,
    acceptedCount: 0,
    ignoredCount: 0,
    regeneratedCount: 0,
    averageLatencyMs: null,
    p95LatencyMs: null,
    citationHitRate: 0,
    userAcceptanceRate: 0,
    regenerationRate: 0,
    ragHitRate: 0,
    noContextAnswerRate: 0,
};

const TOKEN_BUDGET_REASONS = new Set([
    'transcript_truncated',
    'screen_context_truncated',
    'business_system_context_dropped',
    'uploaded_material_context_truncated',
    'mode_context_truncated',
    'assistant_history_truncated',
    'meeting_history_truncated',
]);

function increment(counter: Counter, key: unknown): void {
    if (typeof key !== 'string' || key.length === 0) return;
    counter[key] = (counter[key] ?? 0) + 1;
}

function rate(count: number, total: number): number {
    return total > 0 ? count / total : 0;
}

function summarizeTiming(values: number[]): TimingSummary {
    const sorted = values
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b);
    if (sorted.length === 0) {
        return { count: 0, average: 0, p95: 0, max: 0 };
    }
    return {
        count: sorted.length,
        average: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
        p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
        max: sorted[sorted.length - 1],
    };
}

export function summarizeContextQualityDiagnostics(input: ContextQualityDiagnosticsInput): ContextQualityDiagnosticsSummary {
    const actions = input.dynamicActions ?? [];
    const decisions: Counter = {};
    const actionTypes: Counter = {};
    const semanticProviders: Counter = {};
    const actionDegradedReasons: Counter = {};
    let cloudArbitrations = 0;
    let cloudUnavailable = 0;
    let localFallbackPasses = 0;

    for (const action of actions) {
        increment(actionTypes, action.type ?? action.semanticGate?.actionType);
        increment(decisions, action.semanticGate?.decision);
        increment(semanticProviders, action.semanticGate?.semanticProvider);
        const countedDegradedReasons = new Set<string>();
        if (action.semanticGate?.degradedReason) {
            countedDegradedReasons.add(action.semanticGate.degradedReason);
            increment(actionDegradedReasons, action.semanticGate.degradedReason);
        }
        for (const reason of action.semanticGate?.reasons ?? []) {
            if (reason.includes('unavailable') || reason.includes('denied')) {
                if (!countedDegradedReasons.has(reason)) {
                    countedDegradedReasons.add(reason);
                    increment(actionDegradedReasons, reason);
                }
            }
            if (reason === 'cloud_unavailable_local_fallback' && action.semanticGate?.decision === 'pass') {
                localFallbackPasses += 1;
            }
        }
        if (action.semanticGate?.usedCloudArbitration) cloudArbitrations += 1;
        if (action.semanticGate?.semanticProvider === 'unavailable' || action.semanticGate?.degradedReason === 'cloud_semantic_gate_unavailable') {
            cloudUnavailable += 1;
        }
    }

    const injectedSources: Counter = {};
    const omittedSources: Counter = {};
    const contextDegradedReasons: Counter = {};
    const timingValues = new Map<string, number[]>();
    let tokenBudgetDropCount = 0;

    for (const plan of input.contextPlans ?? []) {
        for (const source of plan.injectedSources ?? []) {
            increment(injectedSources, source);
        }
        for (const omitted of plan.omittedSources ?? []) {
            increment(omittedSources, omitted.source);
            increment(contextDegradedReasons, omitted.reason);
            if (omitted.reason && TOKEN_BUDGET_REASONS.has(omitted.reason)) tokenBudgetDropCount += 1;
        }
        for (const reason of plan.degradedReasons ?? []) {
            increment(contextDegradedReasons, reason);
            if (TOKEN_BUDGET_REASONS.has(reason)) tokenBudgetDropCount += 1;
        }
        for (const [source, value] of Object.entries(plan.retrievalTimingMs ?? {})) {
            if (!Number.isFinite(value)) continue;
            const existing = timingValues.get(source) ?? [];
            existing.push(Number(value));
            timingValues.set(source, existing);
        }
    }

    const retrievalTimingMs: Record<string, TimingSummary> = {};
    for (const [source, values] of timingValues.entries()) {
        retrievalTimingMs[source] = summarizeTiming(values);
    }

    return {
        dynamicActions: {
            total: actions.length,
            decisions,
            actionTypes,
            semanticProviders,
            degradedReasons: actionDegradedReasons,
            cloudArbitrationRate: rate(cloudArbitrations, actions.length),
            cloudUnavailableRate: rate(cloudUnavailable, actions.length),
            localFallbackPassRate: rate(localFallbackPasses, actions.length),
        },
        answerQuality: input.answerQualityMetrics ?? EMPTY_ANSWER_QUALITY,
        context: {
            injectedSources,
            omittedSources,
            degradedReasons: contextDegradedReasons,
            tokenBudgetDropCount,
            retrievalTimingMs,
        },
    };
}
