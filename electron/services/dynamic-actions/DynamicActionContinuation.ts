import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { DynamicAction, EvidenceRef } from './DynamicAction';

export type DynamicActionContinuationGoal = 'answer_when_grounded';
export type DynamicActionContinuationModeTemplateType = 'sales' | 'fde' | 'recruiting';
export type DynamicActionContinuationAnswerActionType =
    | 'capability_fit_answer'
    | 'fde_grounded_answer'
    | 'candidate_evidence_summary';
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
export type RecruitingDynamicActionContinuationSourceIntent =
    | 'recruiting_scorecard_gap'
    | 'recruiting_bei_evidence_gap'
    | 'recruiting_situational_evidence_gap'
    | 'recruiting_risk_verification'
    | 'evaluate_answer'
    | 'request_example';
export type DynamicActionContinuationSourceIntent =
    | SalesDynamicActionContinuationSourceIntent
    | FdeDynamicActionContinuationSourceIntent
    | RecruitingDynamicActionContinuationSourceIntent;
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
    observedSpeaker: 'interviewer' | 'user';
    maxPlannerAttempts: 3;
    expiresAfterCustomerTurns: 6;
    expiresAfterMs: 300_000;
}

interface DynamicActionContinuationModePolicy extends DynamicActionContinuationPolicy {
    parentActionTypes: ReadonlySet<string>;
    sourceIntents: ReadonlySet<DynamicActionContinuationSourceIntent>;
}

export interface PendingActionContinuation {
    parentActionId: string;
    parentActionType: string;
    sessionId: string;
    modeId: string;
    modeTemplateType: DynamicActionContinuationModeTemplateType;
    sourceIntent: DynamicActionContinuationSourceIntent;
    observedSpeaker: 'interviewer' | 'user';
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
    observedSpeaker: 'interviewer',
    maxPlannerAttempts: 3,
    expiresAfterCustomerTurns: 6,
    expiresAfterMs: 300_000,
};

const DYNAMIC_ACTION_CONTINUATION_MODE_POLICIES: Record<
DynamicActionContinuationModeTemplateType,
DynamicActionContinuationModePolicy
> = {
    sales: {
        ...DYNAMIC_ACTION_CONTINUATION_POLICY,
        parentActionTypes: new Set(['discovery_question']),
        sourceIntents: new Set(['sales_capability_fit', 'sales_contextual_proof_discovery']),
    },
    fde: {
        ...DYNAMIC_ACTION_CONTINUATION_POLICY,
        parentActionTypes: new Set([
            'fde_discovery_probe',
            'fde_risk_blocker',
            'fde_agent_feasibility',
            'fde_success_criteria',
            'fde_next_step',
            'fde_integration_check',
            'fde_security_review',
        ]),
        sourceIntents: new Set([
            'fde_discovery',
            'fde_integration',
            'fde_security',
            'fde_risk',
            'fde_agent_feasibility',
            'fde_success',
            'fde_next_step',
        ]),
        answerActionType: 'fde_grounded_answer',
    },
    recruiting: {
        ...DYNAMIC_ACTION_CONTINUATION_POLICY,
        parentActionTypes: new Set(['candidate_experience_probe']),
        sourceIntents: new Set([
            'recruiting_scorecard_gap',
            'recruiting_bei_evidence_gap',
            'recruiting_situational_evidence_gap',
            'recruiting_risk_verification',
            'evaluate_answer',
            'request_example',
        ]),
        answerActionType: 'candidate_evidence_summary',
        observedSpeaker: 'interviewer',
    },
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
    if (action.status !== 'completed') {
        return null;
    }

    const policy = DYNAMIC_ACTION_CONTINUATION_MODE_POLICIES[
        action.modeTemplateType as DynamicActionContinuationModeTemplateType
    ];
    if (!policy || !policy.parentActionTypes.has(action.type)) return null;
    if (!action.sourceIntent || !policy.sourceIntents.has(action.sourceIntent as DynamicActionContinuationSourceIntent)) {
        return null;
    }
    return { ...policy };
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
