import type { QueryIntent } from './RAGRetriever';
import type { ScoredChunk, StoredChunk } from './VectorStore';

export interface MeetingSummaryEvidence {
    overview?: string;
    keyPoints?: string[];
    actionItems?: string[];
    decisions?: string[];
}

export interface MeetingEvidence {
    meetingId: string;
    source: 'overview' | 'key_point' | 'action_item' | 'decision' | 'transcript';
    text: string;
    tokenCount: number;
    speaker?: string;
    timestampMs?: number;
}

export interface AssembledMeetingEvidence {
    evidence: MeetingEvidence[];
    formattedContext: string;
    totalTokens: number;
}

const ACTION_RETRIEVAL_TERMS = [
    '行动项',
    '下一步',
    '跟进',
    '负责',
    '截止',
    'action item',
    'next step',
    'follow up',
];

const DECISION_RETRIEVAL_TERMS = [
    '决定',
    '确定',
    '结论',
    '同意',
    'decision',
    'agreed',
];

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function nonEmptyStrings(values: unknown): string[] {
    return Array.isArray(values)
        ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
}

function sampleTimeline(chunks: StoredChunk[], limit: number = 8): StoredChunk[] {
    if (chunks.length <= limit) return chunks;
    return Array.from({ length: limit }, (_, index) => {
        const position = Math.round(index * (chunks.length - 1) / (limit - 1));
        return chunks[position];
    });
}

function transcriptEvidence(
    meetingId: string,
    chunks: Array<ScoredChunk | StoredChunk>
): MeetingEvidence[] {
    return chunks
        .filter(chunk => chunk.meetingId === meetingId && chunk.text.trim().length > 0)
        .map(chunk => ({
            meetingId,
            source: 'transcript' as const,
            text: chunk.text.trim(),
            tokenCount: chunk.tokenCount,
            speaker: chunk.speaker,
            timestampMs: chunk.startMs,
        }));
}

function formatEvidence(item: MeetingEvidence): string {
    switch (item.source) {
        case 'overview':
            return `[会议概览] ${item.text}`;
        case 'key_point':
            return `[会议要点] ${item.text}`;
        case 'action_item':
            return `[行动项] ${item.text}`;
        case 'decision':
            return `[决策] ${item.text}`;
        case 'transcript': {
            const timestampMs = item.timestampMs ?? 0;
            const minutes = Math.floor(timestampMs / 60000);
            const seconds = Math.floor((timestampMs % 60000) / 1000);
            return `[${minutes}:${seconds.toString().padStart(2, '0')}] ${item.speaker ?? '发言人'}: ${item.text}`;
        }
    }
}

export function expandMeetingRetrievalQuery(
    query: string,
    intent: QueryIntent,
    summary: MeetingSummaryEvidence
): string {
    if (intent === 'action_items' && nonEmptyStrings(summary.actionItems).length === 0) {
        return `${query}\n${ACTION_RETRIEVAL_TERMS.join(' ')}`;
    }
    if (intent === 'decision_recall' && nonEmptyStrings(summary.decisions).length === 0) {
        return `${query}\n${DECISION_RETRIEVAL_TERMS.join(' ')}`;
    }
    return query;
}

export function assembleMeetingEvidence(input: {
    meetingId: string;
    intent: QueryIntent;
    summary: MeetingSummaryEvidence;
    retrievedChunks: ScoredChunk[];
    timelineChunks: StoredChunk[];
    maxTokens?: number;
}): AssembledMeetingEvidence {
    const maxTokens = input.maxTokens ?? 1500;
    const candidates: MeetingEvidence[] = [];
    const summary = input.summary ?? {};

    if (input.intent === 'summary') {
        const overview = typeof summary.overview === 'string' ? summary.overview.trim() : '';
        const keyPoints = nonEmptyStrings(summary.keyPoints);
        if (overview) {
            candidates.push({
                meetingId: input.meetingId,
                source: 'overview',
                text: overview,
                tokenCount: estimateTokens(overview),
            });
        }
        for (const text of keyPoints) {
            candidates.push({
                meetingId: input.meetingId,
                source: 'key_point',
                text,
                tokenCount: estimateTokens(text),
            });
        }
        if (!overview && keyPoints.length === 0) {
            candidates.push(
                ...transcriptEvidence(
                    input.meetingId,
                    sampleTimeline(
                        input.timelineChunks.filter(chunk => chunk.meetingId === input.meetingId)
                    )
                )
            );
        }
    } else if (input.intent === 'action_items') {
        for (const text of nonEmptyStrings(summary.actionItems)) {
            candidates.push({
                meetingId: input.meetingId,
                source: 'action_item',
                text,
                tokenCount: estimateTokens(text),
            });
        }
    } else if (input.intent === 'decision_recall') {
        for (const text of nonEmptyStrings(summary.decisions)) {
            candidates.push({
                meetingId: input.meetingId,
                source: 'decision',
                text,
                tokenCount: estimateTokens(text),
            });
        }
    }

    candidates.push(...transcriptEvidence(input.meetingId, input.retrievedChunks));

    const selected: MeetingEvidence[] = [];
    const seen = new Set<string>();
    let totalTokens = 0;
    for (const evidence of candidates) {
        const dedupeKey = `${evidence.source}\u0000${evidence.text}`;
        if (seen.has(dedupeKey)) continue;
        if (totalTokens + evidence.tokenCount > maxTokens) continue;
        seen.add(dedupeKey);
        selected.push(evidence);
        totalTokens += evidence.tokenCount;
    }

    return {
        evidence: selected,
        formattedContext: selected.map(formatEvidence).join('\n\n'),
        totalTokens,
    };
}
