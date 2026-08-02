import type { EvidenceRef } from './DynamicAction';

export type SignalStatus = 'candidate' | 'confirmed' | 'cooling_down' | 'expired';
export type SignalConfirmationSource =
    | 'trigger'
    | 'cloud_intent'
    | 'local_intent'
    | 'heuristic'
    | 'continuation_planner';

export const SIGNAL_THRESHOLDS = {
    INTERNAL_MIN: 0.55,
    CARD_MIN: 0.75,
    AUTO_MIN: 0.9,
    COOLDOWN_MS: 120_000,
    EXPIRE_MS: 90_000,
};

export interface ConversationSignalState {
    sessionId: string;
    modeTemplateType: string;
    signalType: string;
    status: SignalStatus;
    confidence: number;
    firstSeenAt: number;
    lastSeenAt: number;
    cooldownUntil?: number;
    latestTurn?: string;
    emotion?: string;
    confirmationSource: SignalConfirmationSource;
    confirmedIntent?: string;
    evidenceRefs: EvidenceRef[];
}

export interface SignalAssessmentInput {
    sessionId: string;
    modeTemplateType: string;
    signalType: string;
    confidence: number;
    evidenceRef: EvidenceRef;
    latestTurn?: string;
    emotion?: string;
    confirmationSource: SignalConfirmationSource;
    confirmedIntent?: string;
    now?: number;
}

export interface SignalAssessmentResult {
    state: ConversationSignalState;
    shouldStoreAction: boolean;
    autoSurfaceEligible: boolean;
}

interface RollbackSnapshot {
    evidenceSignature: string;
    previous?: ConversationSignalState;
}

function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function keyFor(sessionId: string, modeTemplateType: string, signalType: string): string {
    return `${sessionId}|${modeTemplateType}|${signalType}`;
}

function evidenceSignature(evidenceRef: EvidenceRef): string {
    return JSON.stringify({
        source: evidenceRef.source,
        text: evidenceRef.text,
        timestamp: evidenceRef.timestamp,
        speaker: evidenceRef.speaker,
    });
}

export class SignalStateTracker {
    private states = new Map<string, ConversationSignalState>();
    private rollbackSnapshots = new Map<string, RollbackSnapshot>();

    assess(input: SignalAssessmentInput): SignalAssessmentResult {
        const now = input.now ?? Date.now();
        const key = keyFor(input.sessionId, input.modeTemplateType, input.signalType);
        const previous = this.states.get(key);
        const rawConfidence = clampConfidence(input.confidence);

        if (previous?.cooldownUntil && now < previous.cooldownUntil) {
            const coolingState: ConversationSignalState = {
                ...previous,
                status: 'cooling_down',
                lastSeenAt: now,
                latestTurn: input.latestTurn ?? previous.latestTurn,
                emotion: input.emotion ?? previous.emotion,
                confirmationSource: input.confirmationSource,
                confirmedIntent: input.confirmedIntent ?? previous.confirmedIntent,
                evidenceRefs: [...previous.evidenceRefs, input.evidenceRef].slice(-5),
            };
            this.states.set(key, coolingState);
            this.rollbackSnapshots.set(key, {
                evidenceSignature: evidenceSignature(input.evidenceRef),
                previous,
            });
            return { state: coolingState, shouldStoreAction: false, autoSurfaceEligible: false };
        }

        const isRepeat = Boolean(previous && now - previous.lastSeenAt <= SIGNAL_THRESHOLDS.EXPIRE_MS);
        const confidence = previous && isRepeat
            ? clampConfidence(previous.confidence * 0.6 + rawConfidence * 0.4 + 0.1)
            : rawConfidence;
        const status: SignalStatus = confidence >= SIGNAL_THRESHOLDS.CARD_MIN ? 'confirmed' : 'candidate';
        const evidenceRefs = previous && isRepeat
            ? [...previous.evidenceRefs, input.evidenceRef].slice(-5)
            : [input.evidenceRef];
        const state: ConversationSignalState = {
            sessionId: input.sessionId,
            modeTemplateType: input.modeTemplateType,
            signalType: input.signalType,
            status,
            confidence,
            firstSeenAt: previous && isRepeat ? previous.firstSeenAt : now,
            lastSeenAt: now,
            latestTurn: input.latestTurn,
            emotion: input.emotion,
            confirmationSource: input.confirmationSource,
            confirmedIntent: input.confirmedIntent,
            evidenceRefs,
        };
        this.states.set(key, state);
        this.rollbackSnapshots.set(key, {
            evidenceSignature: evidenceSignature(input.evidenceRef),
            previous: previous && isRepeat ? previous : undefined,
        });

        return {
            state,
            shouldStoreAction: status === 'confirmed',
            autoSurfaceEligible: confidence >= SIGNAL_THRESHOLDS.AUTO_MIN && evidenceRefs.length >= 2,
        };
    }

    dismiss(sessionId: string, modeTemplateType: string, signalType: string, now: number = Date.now()): void {
        const key = keyFor(sessionId, modeTemplateType, signalType);
        const previous = this.states.get(key);
        const cooldownUntil = now + SIGNAL_THRESHOLDS.COOLDOWN_MS;
        if (previous) {
            this.states.set(key, {
                ...previous,
                status: 'cooling_down',
                cooldownUntil,
                lastSeenAt: now,
            });
            this.rollbackSnapshots.delete(key);
            return;
        }
        this.states.set(key, {
            sessionId,
            modeTemplateType,
            signalType,
            status: 'cooling_down',
            confidence: 0,
            firstSeenAt: now,
            lastSeenAt: now,
            cooldownUntil,
            confirmationSource: 'heuristic',
            evidenceRefs: [],
        });
        this.rollbackSnapshots.delete(key);
    }

    clear(sessionId: string, modeTemplateType: string, signalType: string): void {
        const key = keyFor(sessionId, modeTemplateType, signalType);
        this.states.delete(key);
        this.rollbackSnapshots.delete(key);
    }

    rollbackLatestAssessmentIfEvidenceMatches(
        sessionId: string,
        modeTemplateType: string,
        signalType: string,
        evidenceRef: EvidenceRef,
    ): void {
        const key = keyFor(sessionId, modeTemplateType, signalType);
        const snapshot = this.rollbackSnapshots.get(key);
        if (snapshot?.evidenceSignature !== evidenceSignature(evidenceRef)) {
            return;
        }
        if (snapshot.previous) {
            this.states.set(key, snapshot.previous);
        } else {
            this.states.delete(key);
        }
        this.rollbackSnapshots.delete(key);
    }

    expire(now: number = Date.now()): void {
        for (const [key, state] of this.states.entries()) {
            if (state.status !== 'expired' && now - state.lastSeenAt > SIGNAL_THRESHOLDS.EXPIRE_MS) {
                this.states.set(key, { ...state, status: 'expired' });
            }
        }
    }

    getState(sessionId: string, modeTemplateType: string, signalType: string): ConversationSignalState | undefined {
        return this.states.get(keyFor(sessionId, modeTemplateType, signalType));
    }
}
