import type { DynamicAction } from './DynamicAction';
import {
    type ContinuationTraceEvent,
    type PendingActionContinuation,
    resolveDynamicActionContinuationPolicy,
    transitionContinuationState,
} from './DynamicActionContinuation';

export interface DynamicActionContinuationServiceOptions {
    now?: () => number;
    traceSink?: (event: ContinuationTraceEvent) => void;
}

export class DynamicActionContinuationService {
    private readonly activeBySession = new Map<string, PendingActionContinuation>();
    private readonly registeredParentActionIds = new Set<string>();
    private readonly now: () => number;
    private readonly traceSink?: (event: ContinuationTraceEvent) => void;

    constructor(options: DynamicActionContinuationServiceOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.traceSink = options.traceSink;
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
            sessionId: action.sessionId,
            modeId: action.modeId,
            modeTemplateType: 'sales',
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
