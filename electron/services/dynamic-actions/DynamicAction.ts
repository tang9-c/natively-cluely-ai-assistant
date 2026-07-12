import type { SemanticGateTrace } from './ModeEventClassifier';
import type { TranscriptEmotionSource } from '../../../shared/senseVoiceEmotion';
import type { ContextNeedDecision } from '../context/ContextNeedDecision';

export type ActionStatus =
    | 'candidate'
    | 'shown'
    | 'accepted'
    | 'auto_generated'
    | 'dismissed'
    | 'expired'
    | 'generated_failed'
    | 'completed';
export type AutoSurfacePolicy = 'auto' | 'card' | 'silent';
export type DynamicActionAcceptTriggerSource = 'manual' | 'auto_countdown';
export type SignalStatus = 'candidate' | 'confirmed' | 'cooling_down' | 'expired';
export type SignalConfirmationSource = 'trigger' | 'cloud_intent' | 'local_intent' | 'heuristic';

export type DynamicActionOutputType =
    | 'spoken_response'
    | 'checklist'
    | 'email_draft'
    | 'action_item'
    | 'decision_record';

export type DynamicActionRiskState =
    | 'auto_countdown'
    | 'normal';

export type DynamicActionDiagnosticRiskState = 'silent_diagnostic';

export interface DynamicActionProductContract {
    userAction: string;
    whyNow: string;
    evidenceSummary?: string;
    outputType: DynamicActionOutputType;
    outputPromise: string;
    riskState: DynamicActionRiskState;
    contextNeedDecision: ContextNeedDecision;
}

export interface EvidenceRef {
    source: 'transcript' | 'screen' | 'reference' | 'meeting_history';
    text: string;
    timestamp?: number;
    speaker?: string;
    fileId?: string;
    chunkId?: string;
}

export interface DynamicAction {
    id: string;
    sessionId: string;
    modeId: string;
    modeTemplateType: string;
    type: string;  // e.g., 'pricing_objection', 'competitor_mention', 'coding_question'
    label: string;  // e.g., "Handle pricing objection"
    description?: string;
    productContract: DynamicActionProductContract;
    confidence: number;
    priority: number;
    evidenceRefs: EvidenceRef[];
    status: ActionStatus;
    createdAt: number;
    expiresAt?: number;
    promptInstruction: string;
    /**
     * Mode-aware event metadata used by the main answer flow. The intent label
     * directs the answer shape, but the LLM receives this richer packet instead
     * of an isolated keyword.
     */
    sourceIntent?: string;
    latestTurn?: string;
    language?: string;
    emotion?: string;
    emotionSource?: TranscriptEmotionSource;
    keyEntities?: string[];
    retrievalQuery?: string;
    autoSurfacePolicy?: AutoSurfacePolicy;
    autoTriggerEligible?: boolean;
    autoTriggerReason?: string;
    signalStatus?: SignalStatus;
    evidenceCount?: number;
    confirmationSource?: SignalConfirmationSource;
    confirmedIntent?: string;
    semanticGate?: SemanticGateTrace;
    answerStyle?: {
        maxWords: number;
        format: 'bullets' | 'short_script' | 'code' | 'checklist' | 'summary' | 'email';
        tone: string;
    };
}
