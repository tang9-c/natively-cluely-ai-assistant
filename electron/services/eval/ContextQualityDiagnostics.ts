import type { AnswerDegradedReason, AnswerQualityMetrics } from '../../db/DatabaseManager';
import type { CodeHintTrace } from '../../llm/CodeHintLLM';
import type { ContinuationTraceEvent } from '../dynamic-actions/DynamicActionContinuation';
import type { DynamicActionLifecycleEvent } from '../dynamic-actions/DynamicActionLifecycle';
import type { SemanticGateArbitrationStatus, SemanticGateTrace } from '../dynamic-actions/ModeEventClassifier';
import type { RealtimeContextSource } from '../context/RealtimeContextOrchestrator';

type Counter = Record<string, number>;

export interface ContextQualityDynamicActionInput {
    type?: string;
    semanticGate?: Partial<SemanticGateTrace>;
}

export interface ContextQualityPlanInput {
    injectedSources?: RealtimeContextSource[];
    omittedSources?: Array<{ source: RealtimeContextSource; reason?: AnswerDegradedReason }>;
    degradedReasons?: AnswerDegradedReason[];
    retrievalTimingMs?: Partial<Record<RealtimeContextSource, number>>;
}

export interface ContextQualityCodeHintInput {
    status: CodeHintTrace['status'];
    dataScopesRequested: string[];
    dataScopesDenied: string[];
    degradedReasons: AnswerDegradedReason[];
    usedVision: boolean;
    usedTranscript: boolean;
    provider?: string;
}

export type DynamicActionLifecycleEventInput = DynamicActionLifecycleEvent;

export interface ContextQualityDiagnosticsInput {
    dynamicActions?: ContextQualityDynamicActionInput[];
    dynamicActionLifecycleEvents?: DynamicActionLifecycleEventInput[];
    dynamicActionContinuationEvents?: ContinuationTraceEvent[];
    answerQualityMetrics?: AnswerQualityMetrics;
    contextPlans?: ContextQualityPlanInput[];
    codeHints?: ContextQualityCodeHintInput[];
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
        arbitrationStatuses: Counter;
        degradedReasons: Counter;
        lifecycleEvents: Counter;
        cloudUsedRate: number;
        privacyLocalRate: number;
        cloudFallbackRate: number;
        localOnlyNotNeededRate: number;
        cloudArbitrationRate: number;
        cloudUnavailableRate: number;
        localFallbackRate: number;
        localFallbackPassRate: number;
        localFallbackRejectRate: number;
    };
    continuation: {
        events: Counter;
        reasons: Counter;
        plannerAttempts: number;
        observedCustomerTurns: number;
    };
    answerQuality: AnswerQualityMetrics;
    context: {
        injectedSources: Counter;
        omittedSources: Counter;
        degradedReasons: Counter;
        tokenBudgetDropCount: number;
        nonTokenBudgetOmitCount: number;
        retrievalTimingMs: Record<string, TimingSummary>;
    };
    codeHints: {
        total: number;
        statuses: Counter;
        degradedReasons: Counter;
        providers: Counter;
        scopeDeniedRate: number;
        visionUsageRate: number;
        transcriptUsageRate: number;
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

const ACTION_DEGRADED_REASON_WHITELIST = new Set([
    'cloud_semantic_gate_unavailable',
    'cloud_timeout',
    'cloud_invalid_json',
    'cloud_provider_unavailable',
    'provider_scope_denied',
    'local_intent_unavailable',
    'semantic_gate_unavailable',
]);

const CLOUD_UNAVAILABLE_REASONS = new Set([
    'cloud_semantic_gate_unavailable',
    'cloud_unavailable_local_fallback',
    'cloud_timeout',
    'cloud_invalid_json',
    'cloud_provider_unavailable',
]);

const ARBITRATION_STATUS_LABELS: Record<SemanticGateArbitrationStatus, string> = {
    cloud_used: '云端',
    local_only_by_privacy: '隐私本地',
    local_fallback_cloud_unavailable: '本地兜底',
    cloud_unavailable: '云端不可用',
    local_only_not_needed: '本地',
};

const ARBITRATION_STATUS_MESSAGES: Record<SemanticGateArbitrationStatus, string> = {
    cloud_used: '已使用云端判定参与动态动作判断',
    local_only_by_privacy: '已按隐私设置仅使用本地判断',
    local_fallback_cloud_unavailable: '云端判定不可用，已使用本地兜底',
    cloud_unavailable: '云端判定不可用，已暂缓高风险动作',
    local_only_not_needed: '已使用本地判断',
};

const NON_TOKEN_BUDGET_OMIT_REASONS = new Set([
    'duplicate_context_dropped',
]);

function increment(counter: Counter, key: unknown): void {
    if (typeof key !== 'string' || key.length === 0) return;
    counter[key] = (counter[key] ?? 0) + 1;
}

function rate(count: number, total: number): number {
    return total > 0 ? count / total : 0;
}

export function getDynamicActionArbitrationStatusLabel(status: SemanticGateArbitrationStatus): string {
    return ARBITRATION_STATUS_LABELS[status];
}

export function getDynamicActionArbitrationStatusMessage(status: SemanticGateArbitrationStatus): string {
    return ARBITRATION_STATUS_MESSAGES[status];
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
    const arbitrationStatuses: Counter = {};
    const actionDegradedReasons: Counter = {};
    let cloudArbitrations = 0;
    let cloudUsed = 0;
    let privacyLocal = 0;
    let cloudFallback = 0;
    let localOnlyNotNeeded = 0;
    let cloudUnavailable = 0;
    let localFallbacks = 0;
    let localFallbackPasses = 0;
    let localFallbackRejects = 0;
    const lifecycleEvents: Counter = {};

    for (const event of input.dynamicActionLifecycleEvents ?? []) {
        increment(lifecycleEvents, event.event);
    }

    const continuationEvents: Counter = {};
    const continuationReasons: Counter = {};
    let continuationPlannerAttempts = 0;
    let continuationObservedCustomerTurns = 0;
    for (const event of input.dynamicActionContinuationEvents ?? []) {
        increment(continuationEvents, event.event);
        increment(continuationReasons, event.reasonCode);
        continuationPlannerAttempts = Math.max(continuationPlannerAttempts, event.plannerAttempts ?? 0);
        continuationObservedCustomerTurns = Math.max(
            continuationObservedCustomerTurns,
            event.observedCustomerTurns ?? 0,
        );
    }

    for (const action of actions) {
        increment(actionTypes, action.type ?? action.semanticGate?.actionType);
        increment(decisions, action.semanticGate?.decision);
        increment(semanticProviders, action.semanticGate?.semanticProvider);
        increment(arbitrationStatuses, action.semanticGate?.arbitrationStatus);
        if (action.semanticGate?.arbitrationStatus === 'cloud_used') cloudUsed += 1;
        if (action.semanticGate?.arbitrationStatus === 'local_only_by_privacy') privacyLocal += 1;
        if (action.semanticGate?.arbitrationStatus === 'local_fallback_cloud_unavailable') cloudFallback += 1;
        if (action.semanticGate?.arbitrationStatus === 'local_only_not_needed') localOnlyNotNeeded += 1;
        const countedDegradedReasons = new Set<string>();
        if (action.semanticGate?.degradedReason) {
            countedDegradedReasons.add(action.semanticGate.degradedReason);
            increment(actionDegradedReasons, action.semanticGate.degradedReason);
        }
        let actionHasCloudUnavailable = false;
        for (const reason of action.semanticGate?.reasons ?? []) {
            if (ACTION_DEGRADED_REASON_WHITELIST.has(reason)) {
                if (!countedDegradedReasons.has(reason)) {
                    countedDegradedReasons.add(reason);
                    increment(actionDegradedReasons, reason);
                }
            }
            if (CLOUD_UNAVAILABLE_REASONS.has(reason)) {
                actionHasCloudUnavailable = true;
            }
            if (reason === 'cloud_unavailable_local_fallback') {
                localFallbacks += 1;
                if (action.semanticGate?.decision === 'pass') localFallbackPasses += 1;
                if (action.semanticGate?.decision === 'reject') localFallbackRejects += 1;
            }
        }
        if (action.semanticGate?.usedCloudArbitration) cloudArbitrations += 1;
        if (CLOUD_UNAVAILABLE_REASONS.has(action.semanticGate?.degradedReason ?? '') || actionHasCloudUnavailable) {
            cloudUnavailable += 1;
        }
    }

    const injectedSources: Counter = {};
    const omittedSources: Counter = {};
    const contextDegradedReasons: Counter = {};
    const timingValues = new Map<string, number[]>();
    let tokenBudgetDropCount = 0;
    let nonTokenBudgetOmitCount = 0;

    for (const plan of input.contextPlans ?? []) {
        for (const source of plan.injectedSources ?? []) {
            increment(injectedSources, source);
        }
        for (const omitted of plan.omittedSources ?? []) {
            increment(omittedSources, omitted.source);
            increment(contextDegradedReasons, omitted.reason);
            if (omitted.reason && TOKEN_BUDGET_REASONS.has(omitted.reason)) tokenBudgetDropCount += 1;
            if (omitted.reason && NON_TOKEN_BUDGET_OMIT_REASONS.has(omitted.reason)) nonTokenBudgetOmitCount += 1;
        }
        for (const reason of plan.degradedReasons ?? []) {
            increment(contextDegradedReasons, reason);
            if (TOKEN_BUDGET_REASONS.has(reason)) tokenBudgetDropCount += 1;
        }
        for (const [source, value] of Object.entries(plan.retrievalTimingMs ?? {})) {
            if (typeof source !== 'string' || source.length === 0) continue;
            if (!Number.isFinite(value)) continue;
            if (Number(value) < 0) continue;
            const existing = timingValues.get(source) ?? [];
            existing.push(Number(value));
            timingValues.set(source, existing);
        }
    }

    const retrievalTimingMs: Record<string, TimingSummary> = {};
    for (const [source, values] of timingValues.entries()) {
        retrievalTimingMs[source] = summarizeTiming(values);
    }

    const codeHints = input.codeHints ?? [];
    const codeHintStatuses: Counter = {};
    const codeHintDegradedReasons: Counter = {};
    const codeHintProviders: Counter = {};
    let codeHintScopeDenied = 0;
    let codeHintVisionUsed = 0;
    let codeHintTranscriptUsed = 0;

    for (const trace of codeHints) {
        increment(codeHintStatuses, trace.status);
        increment(codeHintProviders, trace.provider);
        for (const reason of trace.degradedReasons ?? []) {
            increment(codeHintDegradedReasons, reason);
        }
        if ((trace.dataScopesDenied ?? []).length > 0) codeHintScopeDenied += 1;
        if (trace.usedVision) codeHintVisionUsed += 1;
        if (trace.usedTranscript) codeHintTranscriptUsed += 1;
    }

    return {
        dynamicActions: {
            total: actions.length,
            decisions,
            actionTypes,
            semanticProviders,
            arbitrationStatuses,
            degradedReasons: actionDegradedReasons,
            lifecycleEvents,
            cloudUsedRate: rate(cloudUsed, actions.length),
            privacyLocalRate: rate(privacyLocal, actions.length),
            cloudFallbackRate: rate(cloudFallback, actions.length),
            localOnlyNotNeededRate: rate(localOnlyNotNeeded, actions.length),
            cloudArbitrationRate: rate(cloudArbitrations, actions.length),
            cloudUnavailableRate: rate(cloudUnavailable, actions.length),
            localFallbackRate: rate(localFallbacks, actions.length),
            localFallbackPassRate: rate(localFallbackPasses, actions.length),
            localFallbackRejectRate: rate(localFallbackRejects, actions.length),
        },
        answerQuality: input.answerQualityMetrics ?? EMPTY_ANSWER_QUALITY,
        continuation: {
            events: continuationEvents,
            reasons: continuationReasons,
            plannerAttempts: continuationPlannerAttempts,
            observedCustomerTurns: continuationObservedCustomerTurns,
        },
        context: {
            injectedSources,
            omittedSources,
            degradedReasons: contextDegradedReasons,
            tokenBudgetDropCount,
            nonTokenBudgetOmitCount,
            retrievalTimingMs,
        },
        codeHints: {
            total: codeHints.length,
            statuses: codeHintStatuses,
            degradedReasons: codeHintDegradedReasons,
            providers: codeHintProviders,
            scopeDeniedRate: rate(codeHintScopeDenied, codeHints.length),
            visionUsageRate: rate(codeHintVisionUsed, codeHints.length),
            transcriptUsageRate: rate(codeHintTranscriptUsed, codeHints.length),
        },
    };
}

export class ContextQualityDiagnosticsCollector {
    private readonly dynamicActions: ContextQualityDynamicActionInput[] = [];
    private readonly dynamicActionLifecycleEvents: DynamicActionLifecycleEventInput[] = [];
    private readonly dynamicActionContinuationEvents: ContinuationTraceEvent[] = [];
    private readonly contextPlans: ContextQualityPlanInput[] = [];
    private readonly codeHints: ContextQualityCodeHintInput[] = [];
    private readonly maxEntries: number;
    private answerQualityMetrics?: AnswerQualityMetrics;

    constructor(options?: { maxEntries?: number }) {
        const requestedMaxEntries = options?.maxEntries ?? 1000;
        this.maxEntries = Number.isFinite(requestedMaxEntries) && requestedMaxEntries > 0
            ? Math.floor(requestedMaxEntries)
            : 1000;
    }

    recordDynamicActionTrace(trace: SemanticGateTrace): void {
        this.dynamicActions.push({
            type: trace.actionType,
            semanticGate: {
                decision: trace.decision,
                actionType: trace.actionType,
                semanticIntent: trace.semanticIntent,
                confidence: trace.confidence,
                reasons: [...trace.reasons],
                regexCandidates: [] as string[],
                rejectedCandidates: [...trace.rejectedCandidates],
                usedLocalIntentModel: trace.usedLocalIntentModel,
                usedCloudArbitration: trace.usedCloudArbitration,
                semanticProvider: trace.semanticProvider,
                arbitrationStatus: trace.arbitrationStatus,
                degradedReason: trace.degradedReason,
                upgradedByRepeatedEvidence: trace.upgradedByRepeatedEvidence,
            },
        });
        this.trimToMaxEntries(this.dynamicActions);
    }

    recordDynamicActionLifecycleEvent(event: DynamicActionLifecycleEventInput): void {
        this.dynamicActionLifecycleEvents.push({
            event: event.event,
            actionId: event.actionId,
            parentActionId: event.parentActionId,
            actionType: event.actionType,
            modeId: event.modeId,
            modeTemplateType: event.modeTemplateType,
            outputType: event.outputType,
            riskState: event.riskState,
            triggerSource: event.triggerSource,
            generationStatus: event.generationStatus,
            status: event.status,
        });
        this.trimToMaxEntries(this.dynamicActionLifecycleEvents);
    }

    recordDynamicActionContinuationTrace(event: ContinuationTraceEvent): void {
        this.dynamicActionContinuationEvents.push({
            event: event.event,
            sessionId: event.sessionId,
            parentActionId: event.parentActionId,
            reasonCode: event.reasonCode,
            plannerAttempts: event.plannerAttempts,
            observedCustomerTurns: event.observedCustomerTurns,
            durationMs: event.durationMs,
        });
        this.trimToMaxEntries(this.dynamicActionContinuationEvents);
    }

    recordContextPlan(plan: ContextQualityPlanInput): void {
        this.contextPlans.push({
            injectedSources: [...(plan.injectedSources ?? [])],
            omittedSources: (plan.omittedSources ?? []).map((item) => ({
                source: item.source,
                reason: item.reason,
            })),
            degradedReasons: [...(plan.degradedReasons ?? [])],
            retrievalTimingMs: { ...(plan.retrievalTimingMs ?? {}) },
        });
        this.trimToMaxEntries(this.contextPlans);
    }

    recordCodeHintTrace(trace: CodeHintTrace): void {
        this.codeHints.push({
            status: trace.status,
            dataScopesRequested: [...trace.dataScopesRequested],
            dataScopesDenied: [...trace.dataScopesDenied],
            degradedReasons: [...trace.degradedReasons],
            usedVision: trace.usedVision,
            usedTranscript: trace.usedTranscript,
            provider: trace.provider,
        });
        this.trimToMaxEntries(this.codeHints);
    }

    setAnswerQualityMetrics(metrics: AnswerQualityMetrics): void {
        this.answerQualityMetrics = { ...metrics };
    }

    snapshot(): ContextQualityDiagnosticsInput {
        return {
            dynamicActions: this.dynamicActions.map((action) => ({
                type: action.type,
                semanticGate: action.semanticGate ? {
                    ...action.semanticGate,
                    reasons: [...(action.semanticGate.reasons ?? [])],
                    regexCandidates: [] as string[],
                    rejectedCandidates: [...(action.semanticGate.rejectedCandidates ?? [])],
                } : undefined,
            })),
            dynamicActionLifecycleEvents: this.dynamicActionLifecycleEvents.map((event) => ({ ...event })),
            dynamicActionContinuationEvents: this.dynamicActionContinuationEvents.map((event) => ({ ...event })),
            answerQualityMetrics: this.answerQualityMetrics ? { ...this.answerQualityMetrics } : undefined,
            contextPlans: this.contextPlans.map((plan) => ({
                injectedSources: [...(plan.injectedSources ?? [])],
                omittedSources: (plan.omittedSources ?? []).map((item) => ({ ...item })),
                degradedReasons: [...(plan.degradedReasons ?? [])],
                retrievalTimingMs: { ...(plan.retrievalTimingMs ?? {}) },
            })),
            codeHints: this.codeHints.map((trace) => ({
                status: trace.status,
                dataScopesRequested: [...trace.dataScopesRequested],
                dataScopesDenied: [...trace.dataScopesDenied],
                degradedReasons: [...trace.degradedReasons],
                usedVision: trace.usedVision,
                usedTranscript: trace.usedTranscript,
                provider: trace.provider,
            })),
        };
    }

    clear(): void {
        this.dynamicActions.length = 0;
        this.dynamicActionLifecycleEvents.length = 0;
        this.dynamicActionContinuationEvents.length = 0;
        this.contextPlans.length = 0;
        this.codeHints.length = 0;
        this.answerQualityMetrics = undefined;
    }

    private trimToMaxEntries<T>(items: T[]): void {
        if (items.length <= this.maxEntries) return;
        items.splice(0, items.length - this.maxEntries);
    }
}

const defaultContextQualityDiagnosticsCollector = new ContextQualityDiagnosticsCollector();

export function getContextQualityDiagnosticsCollector(): ContextQualityDiagnosticsCollector {
    return defaultContextQualityDiagnosticsCollector;
}
