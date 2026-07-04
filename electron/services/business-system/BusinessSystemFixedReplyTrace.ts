import type {
    AnswerContextTraceInput,
    AnswerDegradedReason,
    AnswerSourceStatus,
} from '../../db/DatabaseManager';
import type { BusinessSystemFixedReplyStatus } from './BusinessSystemTypes';

export interface BusinessSystemFixedReplyTraceInput {
    answerId: string;
    surface?: string;
    latencyMs: number | null;
    question?: string;
    ragReady: boolean;
    embeddingReady: boolean;
    screenContextStatus: AnswerSourceStatus['screenContextStatus'];
    businessSystemStatus: BusinessSystemFixedReplyStatus;
    businessSystemSourceName?: string;
    degradedReason: AnswerDegradedReason;
    businessSystemTimingMs: number;
}

export function buildBusinessSystemFixedReplyTraceInput(input: BusinessSystemFixedReplyTraceInput): AnswerContextTraceInput {
    return {
        answerId: input.answerId,
        answerType: 'what_to_say',
        surface: input.surface ?? 'overlay',
        provider: null,
        model: null,
        latencyMs: input.latencyMs,
        contextUsed: {
            currentTranscript: Boolean(input.question?.trim()),
            shortTermHistory: false,
            uploadedDocumentRag: false,
            historicalMeetings: false,
            longTermMemory: false,
            enterpriseKnowledge: false,
            businessSystemContext: false,
            screenContext: false,
        },
        sourceStatus: {
            ragAttempted: false,
            ragReady: input.ragReady,
            embeddingReady: input.embeddingReady,
            uploadedMaterialHitCount: 0,
            citationCount: 0,
            screenContextStatus: input.screenContextStatus,
            businessSystemStatus: input.businessSystemStatus,
            businessSystemSourceName: input.businessSystemSourceName,
        },
        citations: [],
        degradedReason: input.degradedReason,
        status: 'generated_with_fallback',
        traceId: input.answerId,
        observability: {
            retrievalTimingMs: { business_system: input.businessSystemTimingMs },
            businessSystemStatus: input.businessSystemStatus,
            businessSystemSourceName: input.businessSystemSourceName,
        },
    };
}
