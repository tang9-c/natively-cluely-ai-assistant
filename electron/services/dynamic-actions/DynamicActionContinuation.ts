import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { DynamicAction, EvidenceRef } from './DynamicAction';

export type DynamicActionContinuationGoal = 'answer_when_grounded';
export type DynamicActionContinuationModeTemplateType = 'sales' | 'fde';
export type DynamicActionContinuationAnswerActionType = 'capability_fit_answer' | 'fde_grounded_answer';
export type SalesDynamicActionContinuationSourceIntent =
    | 'sales_capability_fit'
    | 'sales_contextual_proof_discovery';
export type FdeDynamicActionContinuationSourceIntent =
    | 'fde_discovery'
    | 'fde_integration'
    | 'fde_security'
    | 'fde_risk'
    | 'fde_agent_feasibility'
    | 'fde_success'
    | 'fde_next_step';
export type DynamicActionContinuationSourceIntent =
    | SalesDynamicActionContinuationSourceIntent
    | FdeDynamicActionContinuationSourceIntent;
export type DynamicActionContinuationState =
    | 'pending'
    | 'planning'
    | 'ready'
    | 'emitted'
    | 'expired'
    | 'cancelled';

export interface DynamicActionContinuationPolicy {
    goal: DynamicActionContinuationGoal;
    answerActionType: DynamicActionContinuationAnswerActionType;
    maxPlannerAttempts: 3;
    expiresAfterCustomerTurns: 6;
    expiresAfterMs: 300_000;
}

export interface PendingActionContinuation {
    parentActionId: string;
    parentActionType: string;
    sessionId: string;
    modeId: string;
    modeTemplateType: DynamicActionContinuationModeTemplateType;
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

const FDE_CONTINUATION_PARENT_ACTION_TYPES = new Set([
    'fde_discovery_probe',
    'fde_risk_blocker',
    'fde_agent_feasibility',
    'fde_success_criteria',
    'fde_next_step',
    'fde_integration_check',
    'fde_security_review',
]);

const FDE_CONTINUATION_SOURCE_INTENTS = new Set([
    'fde_discovery',
    'fde_integration',
    'fde_security',
    'fde_risk',
    'fde_agent_feasibility',
    'fde_success',
    'fde_next_step',
]);

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
    if (action.status !== 'completed') {
        return null;
    }

    if (action.modeTemplateType === 'sales') {
        if (action.type !== 'discovery_question') return null;
        if (
            action.sourceIntent !== 'sales_capability_fit' &&
            action.sourceIntent !== 'sales_contextual_proof_discovery'
        ) {
            return null;
        }
        return { ...DYNAMIC_ACTION_CONTINUATION_POLICY };
    }

    if (action.modeTemplateType === 'fde') {
        if (!FDE_CONTINUATION_PARENT_ACTION_TYPES.has(action.type)) return null;
        if (!action.sourceIntent || !FDE_CONTINUATION_SOURCE_INTENTS.has(action.sourceIntent)) return null;
        return {
            ...DYNAMIC_ACTION_CONTINUATION_POLICY,
            answerActionType: 'fde_grounded_answer',
        };
    }

    return null;
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
