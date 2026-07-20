import crypto from 'crypto';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { DynamicAction } from './DynamicAction';
import {
    type ContinuationTraceEvent,
    DYNAMIC_ACTION_CONTINUATION_POLICY,
    type PendingActionContinuation,
    resolveDynamicActionContinuationPolicy,
    transitionContinuationState,
} from './DynamicActionContinuation';
import {
    ContinuationPlannerError,
    type ContinuationPlannerResult,
    type DynamicActionContinuationPlanner,
} from './DynamicActionContinuationPlanner';

export interface DynamicActionContinuationServiceOptions {
    now?: () => number;
    traceSink?: (event: ContinuationTraceEvent) => void;
    planner?: Pick<DynamicActionContinuationPlanner, 'decide'>;
}

export interface ContinuationObservationInput {
    sessionId: string;
    modeId: string;
    modeTemplateType: string;
    speaker: 'interviewer';
    text: string;
    timestamp: number;
    providerDataScopes?: ProviderDataScopePolicy;
}

export interface ContinuationObservationOutcome {
    kind: 'none' | 'collecting' | 'ready' | 'expired' | 'degraded';
    continuation?: PendingActionContinuation;
    plannerResult?: ContinuationPlannerResult;
    reasonCode?: string;
}

export class DynamicActionContinuationService {
    private readonly activeBySession = new Map<string, PendingActionContinuation>();
    private readonly registeredParentActionIds = new Set<string>();
    private readonly now: () => number;
    private readonly traceSink?: (event: ContinuationTraceEvent) => void;
    private readonly planner?: Pick<DynamicActionContinuationPlanner, 'decide'>;

    constructor(options: DynamicActionContinuationServiceOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.traceSink = options.traceSink;
        this.planner = options.planner;
    }

    registerCompletedAction(action: DynamicAction): PendingActionContinuation | null {
        const policy = resolveDynamicActionContinuationPolicy(action);
        if (!policy || this.registeredParentActionIds.has(action.id)) return null;

        const now = this.now();
        const previous = this.activeBySession.get(action.sessionId);
        if (previous) {
            previous.state = transitionContinuationState(previous.state, 'cancelled');
            this.trace(previous, 'cancelled', 'superseded_by_new_completed_action');
        }

        const record: PendingActionContinuation = {
            parentActionId: action.id,
            parentActionType: action.type,
            sessionId: action.sessionId,
            modeId: action.modeId,
            modeTemplateType: action.modeTemplateType as PendingActionContinuation['modeTemplateType'],
            sourceIntent: action.sourceIntent as PendingActionContinuation['sourceIntent'],
            originalTurn: action.latestTurn?.trim() || '',
            originalEvidenceRefs: action.evidenceRefs.slice(0, 2).map((item) => ({
                ...item,
                text: item.text.slice(0, 280),
            })),
            keyEntities: [...new Set(action.keyEntities ?? [])].slice(0, 12),
            language: action.language,
            collectedCustomerTurns: [],
            observedCustomerTurns: 0,
            plannerAttempts: 0,
            seenTurnHashes: [],
            createdAt: now,
            expiresAt: now + policy.expiresAfterMs,
            state: 'pending',
        };
        this.registeredParentActionIds.add(action.id);
        this.activeBySession.set(action.sessionId, record);
        this.trace(record, 'registered');
        return record;
    }

    getActiveForSession(sessionId: string): PendingActionContinuation | null {
        const record = this.activeBySession.get(sessionId);
        if (!record) return null;
        if (record.expiresAt <= this.now()) {
            this.activeBySession.delete(sessionId);
            record.state = transitionContinuationState(record.state, 'expired');
            this.trace(record, 'expired', 'continuation_expired');
            return null;
        }
        return record;
    }

    cancelForContext(sessionId?: string): void {
        if (!sessionId) {
            for (const record of this.activeBySession.values()) {
                record.state = transitionContinuationState(record.state, 'cancelled');
                this.trace(record, 'cancelled', 'context_cleared');
            }
            this.activeBySession.clear();
            return;
        }

        const record = this.activeBySession.get(sessionId);
        if (record) {
            record.state = transitionContinuationState(record.state, 'cancelled');
            this.trace(record, 'cancelled', 'context_changed');
        }
        this.activeBySession.delete(sessionId);
    }

    markEmitted(sessionId: string, parentActionId: string, reasonCode?: string): void {
        const record = this.activeBySession.get(sessionId);
        if (!record || record.parentActionId !== parentActionId || record.state !== 'ready') return;
        record.state = transitionContinuationState('ready', 'emitted');
        this.activeBySession.delete(sessionId);
        this.trace(record, 'emitted', reasonCode);
    }

    async observeFinalCustomerTurn(input: ContinuationObservationInput): Promise<ContinuationObservationOutcome> {
        const record = this.getActiveForSession(input.sessionId);
        if (!record || !this.planner) return { kind: 'none' };
        if (record.modeId !== input.modeId || record.modeTemplateType !== input.modeTemplateType) return { kind: 'none' };

        const text = input.text.replace(/\s+/g, ' ').trim();
        if (!text) return { kind: 'none' };

        const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
        if (record.seenTurnHashes.includes(hash)) {
            this.trace(record, 'observed', 'duplicate_turn');
            return { kind: 'collecting', continuation: record, reasonCode: 'duplicate_turn' };
        }

        if (record.observedCustomerTurns >= DYNAMIC_ACTION_CONTINUATION_POLICY.expiresAfterCustomerTurns) {
            return this.expireRecord(record, 'max_customer_turns_reached');
        }

        record.lastTurnHash = hash;
        record.seenTurnHashes = [...record.seenTurnHashes, hash].slice(-12);
        record.observedCustomerTurns += 1;
        record.collectedCustomerTurns.push({ text, timestamp: input.timestamp });
        record.collectedCustomerTurns = record.collectedCustomerTurns.slice(-6);

        if (record.inFlightToken) {
            record.queuedLatestTurn = {
                text,
                timestamp: input.timestamp,
                hash,
                providerDataScopes: input.providerDataScopes ? { ...input.providerDataScopes } : undefined,
            };
            if (input.providerDataScopes?.transcript === false) {
                this.trace(record, 'degraded', 'provider_scope_denied');
                return { kind: 'degraded', continuation: record, reasonCode: 'provider_scope_denied' };
            }
            this.trace(record, 'observed', 'planner_in_flight');
            return { kind: 'collecting', continuation: record, reasonCode: 'planner_in_flight' };
        }

        if (input.providerDataScopes?.transcript === false) {
            this.trace(record, 'degraded', 'provider_scope_denied');
            return { kind: 'degraded', continuation: record, reasonCode: 'provider_scope_denied' };
        }

        if (record.plannerAttempts >= DYNAMIC_ACTION_CONTINUATION_POLICY.maxPlannerAttempts) {
            return this.expireRecord(record, 'max_attempts_reached');
        }

        return this.runPlanner(record, { text, timestamp: input.timestamp }, input.providerDataScopes);
    }

    private async runPlanner(
        record: PendingActionContinuation,
        currentTurn: { text: string; timestamp: number },
        providerDataScopes?: ProviderDataScopePolicy,
    ): Promise<ContinuationObservationOutcome> {
        const token = crypto.randomUUID();
        record.inFlightToken = token;
        record.state = transitionContinuationState(record.state, 'planning');
        record.plannerAttempts += 1;
        const startedAt = this.now();

        let result: ContinuationPlannerResult;
        try {
            result = await this.planner!.decide({
                modeTemplateType: record.modeTemplateType,
                parentActionType: record.parentActionType,
                sourceIntent: record.sourceIntent,
                originalTurn: record.originalTurn,
                keyEntities: record.keyEntities,
                collectedCustomerTurns: record.collectedCustomerTurns,
                currentTurn,
                providerDataScopes,
            });
        } catch (error) {
            if (!this.isCurrentPlannerRun(record, token)) {
                return { kind: 'degraded', reasonCode: 'stale_planner_result' };
            }
            record.inFlightToken = undefined;
            record.state = transitionContinuationState('planning', 'pending');
            const reasonCode = error instanceof ContinuationPlannerError
                ? error.reason
                : 'planner_provider_unavailable';
            this.traceSink?.({
                event: 'degraded',
                sessionId: record.sessionId,
                parentActionId: record.parentActionId,
                reasonCode,
                plannerAttempts: record.plannerAttempts,
                observedCustomerTurns: record.observedCustomerTurns,
                durationMs: this.now() - startedAt,
            });
            return this.drainQueuedTurn(record, { kind: 'degraded', continuation: record, reasonCode });
        }

        if (!this.isCurrentPlannerRun(record, token)) {
            return { kind: 'degraded', reasonCode: 'stale_planner_result' };
        }

        record.inFlightToken = undefined;
        if (record.queuedLatestTurn) {
            record.state = transitionContinuationState('planning', 'pending');
            this.trace(record, 'planned', 'superseded_by_queued_turn');
            return this.drainQueuedTurn(record, {
                kind: 'collecting',
                continuation: record,
                plannerResult: result,
                reasonCode: 'superseded_by_queued_turn',
            });
        }

        if (result.decision === 'trigger_grounded_answer' && result.confidence >= 0.75) {
            record.state = transitionContinuationState('planning', 'ready');
            this.trace(record, 'ready', result.reasonCode);
            return { kind: 'ready', continuation: record, plannerResult: result };
        }

        record.state = transitionContinuationState('planning', 'pending');
        const normalized = result.confidence < 0.75
            ? { ...result, decision: 'continue_collecting' as const, reasonCode: 'insufficient_customer_detail' as const }
            : result;
        this.trace(record, 'planned', normalized.reasonCode);
        return this.drainQueuedTurn(record, { kind: 'collecting', continuation: record, plannerResult: normalized });
    }

    private async drainQueuedTurn(
        record: PendingActionContinuation,
        fallback: ContinuationObservationOutcome,
    ): Promise<ContinuationObservationOutcome> {
        const queued = record.queuedLatestTurn;
        record.queuedLatestTurn = undefined;
        if (!queued) return fallback;
        if (queued.providerDataScopes?.transcript === false) {
            this.trace(record, 'degraded', 'provider_scope_denied');
            return { kind: 'degraded', continuation: record, reasonCode: 'provider_scope_denied' };
        }
        if (record.plannerAttempts >= DYNAMIC_ACTION_CONTINUATION_POLICY.maxPlannerAttempts) {
            return this.expireRecord(record, 'max_attempts_reached');
        }
        return this.runPlanner(record, { text: queued.text, timestamp: queued.timestamp }, queued.providerDataScopes);
    }

    private isCurrentPlannerRun(record: PendingActionContinuation, token: string): boolean {
        const current = this.activeBySession.get(record.sessionId);
        return current === record &&
            current.parentActionId === record.parentActionId &&
            current.modeId === record.modeId &&
            current.inFlightToken === token;
    }

    private expireRecord(record: PendingActionContinuation, reasonCode: string): ContinuationObservationOutcome {
        if (this.activeBySession.get(record.sessionId) === record) {
            this.activeBySession.delete(record.sessionId);
        }
        if (record.state === 'pending' || record.state === 'planning' || record.state === 'ready') {
            record.state = transitionContinuationState(record.state, 'expired');
        }
        this.trace(record, 'expired', reasonCode);
        return { kind: 'expired', continuation: record, reasonCode };
    }

    private trace(record: PendingActionContinuation, event: ContinuationTraceEvent['event'], reasonCode?: string): void {
        this.traceSink?.({
            event,
            sessionId: record.sessionId,
            parentActionId: record.parentActionId,
            reasonCode,
            plannerAttempts: record.plannerAttempts,
            observedCustomerTurns: record.observedCustomerTurns,
        });
    }
}
