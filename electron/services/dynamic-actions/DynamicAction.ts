export type ActionStatus = 'candidate' | 'shown' | 'accepted' | 'dismissed' | 'completed' | 'expired';
export type AutoSurfacePolicy = 'auto' | 'card' | 'silent';

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
    emotionSource?: string;
    keyEntities?: string[];
    retrievalQuery?: string;
    autoSurfacePolicy?: AutoSurfacePolicy;
    autoTriggerEligible?: boolean;
    autoTriggerReason?: string;
    answerStyle?: {
        maxWords: number;
        format: 'bullets' | 'short_script' | 'code' | 'checklist' | 'summary';
        tone: string;
    };
}
