import * as crypto from 'crypto';
import type { AnswerDegradedReason, AnswerSourceStatus } from '../../db/DatabaseManager';

export type RealtimeContextSource =
    | 'current_transcript'
    | 'short_term_history'
    | 'uploaded_material'
    | 'mode_reference'
    | 'historical_meetings'
    | 'profile_history'
    | 'screen_context';

export interface RealtimeContextCandidate {
    source: RealtimeContextSource;
    sourceId: string;
    chunkId?: string | number;
    text: string;
    score?: number;
    tokenCount: number;
    sourceVersion?: string;
    contentHash?: string;
    metadata?: Record<string, unknown>;
}

export interface OmittedRealtimeContextCandidate extends RealtimeContextCandidate {
    reason: AnswerDegradedReason;
}

export interface RealtimeContextPlan {
    injected: RealtimeContextCandidate[];
    omitted: OmittedRealtimeContextCandidate[];
    sourceStatus: AnswerSourceStatus;
    degradedReasons: AnswerDegradedReason[];
    contextFingerprint: string;
    retrievalTimingMs: Partial<Record<RealtimeContextSource, number>>;
}

export interface RealtimeContextPlanInput {
    candidates: RealtimeContextCandidate[];
    tokenBudget: number;
    ragAttempted?: boolean;
    ragReady: boolean;
    embeddingReady: boolean;
    uploadedMaterialHitCount?: number;
    screenContextStatus: 'not_available' | 'available' | 'failed';
    retrievalTimingMs?: Partial<Record<RealtimeContextSource, number>>;
    degradedReasons?: AnswerDegradedReason[];
}

const SOURCE_PRIORITY: Record<RealtimeContextSource, number> = {
    current_transcript: 0,
    screen_context: 1,
    uploaded_material: 2,
    mode_reference: 3,
    short_term_history: 4,
    historical_meetings: 5,
    profile_history: 6,
};

const BUDGET_OMIT_REASON: Record<RealtimeContextSource, AnswerDegradedReason> = {
    current_transcript: 'transcript_truncated',
    screen_context: 'screen_context_truncated',
    uploaded_material: 'uploaded_material_context_truncated',
    mode_reference: 'mode_context_truncated',
    short_term_history: 'assistant_history_truncated',
    historical_meetings: 'meeting_history_truncated',
    profile_history: 'meeting_history_truncated',
};

const XML_TAG_BY_SOURCE: Record<RealtimeContextSource, string> = {
    current_transcript: 'current_transcript_context',
    screen_context: 'screen_context',
    uploaded_material: 'uploaded_material_context',
    mode_reference: 'mode_reference_context',
    short_term_history: 'short_term_history_context',
    historical_meetings: 'historical_meetings_context',
    profile_history: 'profile_history_context',
};

function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function contentHash(candidate: RealtimeContextCandidate): string {
    if (candidate.contentHash) return candidate.contentHash;
    return crypto.createHash('sha256').update(normalizeText(candidate.text)).digest('hex');
}

function fingerprint(candidates: RealtimeContextCandidate[]): string {
    const payload = candidates
        .map((candidate) => [
            candidate.source,
            candidate.sourceId,
            candidate.chunkId ?? '',
            candidate.sourceVersion ?? '',
            contentHash(candidate),
        ].join(':'))
        .join('|');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function addUniqueReason(reasons: AnswerDegradedReason[], reason: AnswerDegradedReason): void {
    if (!reasons.includes(reason)) reasons.push(reason);
}

export function buildRealtimeContextPlan(input: RealtimeContextPlanInput): RealtimeContextPlan {
    const degradedReasons = [...(input.degradedReasons ?? [])];
    const omitted: OmittedRealtimeContextCandidate[] = [];
    const bestByHash = new Map<string, RealtimeContextCandidate>();

    const sorted = [...input.candidates].sort((a, b) => {
        const priorityDelta = SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source];
        if (priorityDelta !== 0) return priorityDelta;
        return (b.score ?? 0) - (a.score ?? 0);
    });

    for (const candidate of sorted) {
        const hash = contentHash(candidate);
        if (bestByHash.has(hash)) {
            omitted.push({ ...candidate, reason: 'duplicate_context_dropped' });
            addUniqueReason(degradedReasons, 'duplicate_context_dropped');
            continue;
        }
        bestByHash.set(hash, candidate);
    }

    const injected: RealtimeContextCandidate[] = [];
    let usedTokens = 0;
    for (const candidate of bestByHash.values()) {
        if (usedTokens + candidate.tokenCount > input.tokenBudget && injected.length > 0) {
            const reason = BUDGET_OMIT_REASON[candidate.source];
            omitted.push({ ...candidate, reason });
            addUniqueReason(degradedReasons, reason);
            continue;
        }
        injected.push(candidate);
        usedTokens += candidate.tokenCount;
    }

    if (!input.ragReady) addUniqueReason(degradedReasons, 'rag_unavailable');
    if (!input.embeddingReady) addUniqueReason(degradedReasons, 'embedding_unavailable');
    if (input.ragAttempted && (input.uploadedMaterialHitCount ?? 0) === 0) {
        addUniqueReason(degradedReasons, 'no_relevant_uploaded_material');
    }
    if (input.screenContextStatus === 'failed') addUniqueReason(degradedReasons, 'screen_context_failed');

    return {
        injected,
        omitted,
        sourceStatus: {
            ragAttempted: Boolean(input.ragAttempted),
            ragReady: input.ragReady,
            embeddingReady: input.embeddingReady,
            uploadedMaterialHitCount: input.uploadedMaterialHitCount ?? injected.filter((item) => item.source === 'uploaded_material').length,
            citationCount: injected.filter((item) => item.source === 'uploaded_material').length,
            screenContextStatus: input.screenContextStatus,
        },
        degradedReasons,
        contextFingerprint: fingerprint(injected),
        retrievalTimingMs: input.retrievalTimingMs ?? {},
    };
}

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function formatInjectedContext(plan: RealtimeContextPlan): string {
    return plan.injected
        .map((candidate) => {
            const tag = XML_TAG_BY_SOURCE[candidate.source];
            return [
                `<${tag}>`,
                `  <source id="${escapeXmlText(candidate.sourceId)}">${escapeXmlText(candidate.text)}</source>`,
                `</${tag}>`,
            ].join('\n');
        })
        .join('\n');
}
