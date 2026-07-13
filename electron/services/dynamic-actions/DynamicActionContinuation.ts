import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { DynamicAction, EvidenceRef } from './DynamicAction';

export type DynamicActionContinuationGoal = 'answer_when_grounded';
export type DynamicActionContinuationSourceIntent =
    | 'sales_capability_fit'
    | 'sales_contextual_proof_discovery';
export type DynamicActionContinuationState =
    | 'pending'
    | 'planning'
    | 'ready'
    | 'emitted'
    | 'expired'
    | 'cancelled';

export interface DynamicActionContinuationPolicy {
    goal: DynamicActionContinuationGoal;
    answerActionType: 'capability_fit_answer';
    maxPlannerAttempts: 3;
    expiresAfterCustomerTurns: 6;
    expiresAfterMs: 300_000;
}

export interface PendingActionContinuation {
    parentActionId: string;
    sessionId: string;
    modeId: string;
    modeTemplateType: 'sales';
    sourceIntent: DynamicActionContinuationSourceIntent;
    originalTurn: string;
    originalEvidenceRefs: EvidenceRef[];
    keyEntities: string[];
    language?: string;
    collectedCustomerTurns: Array<{ text: string; timestamp: number }>;
    observedCustomerTurns: number;
    plannerAttempts: number;
    lastTurnHash?: string;
    seenTurnHashes: string[];
    inFlightToken?: string;
    queuedLatestTurn?: {
        text: string;
        timestamp: number;
        hash: string;
        providerDataScopes?: ProviderDataScopePolicy;
    };
    createdAt: number;
    expiresAt: number;
    state: DynamicActionContinuationState;
}

export interface ContinuationTraceEvent {
    event: 'registered' | 'cancelled' | 'observed' | 'planned' | 'ready' | 'emitted' | 'expired' | 'degraded';
    sessionId: string;
    parentActionId: string;
    reasonCode?: string;
    plannerAttempts?: number;
    observedCustomerTurns?: number;
    durationMs?: number;
}

export const DYNAMIC_ACTION_CONTINUATION_POLICY: DynamicActionContinuationPolicy = {
    goal: 'answer_when_grounded',
    answerActionType: 'capability_fit_answer',
    maxPlannerAttempts: 3,
    expiresAfterCustomerTurns: 6,
    expiresAfterMs: 300_000,
};

const ALLOWED_TRANSITIONS: Record<DynamicActionContinuationState, DynamicActionContinuationState[]> = {
    pending: ['planning', 'expired', 'cancelled'],
    planning: ['pending', 'ready', 'expired', 'cancelled'],
    ready: ['emitted', 'expired', 'cancelled'],
    emitted: [],
    expired: [],
    cancelled: [],
};

export function resolveDynamicActionContinuationPolicy(
    action: Pick<DynamicAction, 'type' | 'modeTemplateType' | 'sourceIntent' | 'status'>,
): DynamicActionContinuationPolicy | null {
    if (
        action.status !== 'completed' ||
        action.modeTemplateType !== 'sales' ||
        action.type !== 'discovery_question'
    ) {
        return null;
    }
    if (
        action.sourceIntent !== 'sales_capability_fit' &&
        action.sourceIntent !== 'sales_contextual_proof_discovery'
    ) {
        return null;
    }
    return { ...DYNAMIC_ACTION_CONTINUATION_POLICY };
}

export function transitionContinuationState(
    current: DynamicActionContinuationState,
    next: DynamicActionContinuationState,
): DynamicActionContinuationState {
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
        throw new Error(`invalid_continuation_transition:${current}->${next}`);
    }
    return next;
}
