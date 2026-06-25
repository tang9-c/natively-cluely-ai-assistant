import type { DoubaoAucUtterance } from './doubaoAucClient';

export interface AlignedDiarizedUtterance extends DoubaoAucUtterance {
    speakerId: string;
    speakerLabel: string;
}

export interface SpeakerDiarizationAlignInput {
    utterances: DoubaoAucUtterance[];
    emitAfterMs: number;
}

interface SpeakerHistoryItem {
    speakerId: string;
    startMs?: number;
    endMs?: number;
}

type SpeakerChannel = 'interviewer' | 'user';

const CONTINUITY_GAP_MS = 1500;

export class SpeakerDiarizationAligner {
    private readonly channel: SpeakerChannel;
    private nextSpeakerNumber = 1;
    private history: SpeakerHistoryItem[] = [];
    private lastEmitted: SpeakerHistoryItem | null = null;

    constructor(channel: SpeakerChannel) {
        this.channel = channel;
    }

    align(input: SpeakerDiarizationAlignInput): AlignedDiarizedUtterance[] {
        const batchProviderMap = new Map<string, string>();
        const aligned: AlignedDiarizedUtterance[] = [];

        for (const utterance of input.utterances) {
            const speakerId = this.resolveSpeakerId(utterance, input.emitAfterMs, batchProviderMap);
            const withSpeaker = {
                ...utterance,
                speakerId,
                speakerLabel: this.labelFor(speakerId),
            };

            this.remember(withSpeaker);

            if (this.isOverlapOnly(utterance, input.emitAfterMs)) {
                continue;
            }

            aligned.push(withSpeaker);
            this.lastEmitted = {
                speakerId,
                startMs: utterance.startMs,
                endMs: utterance.endMs,
            };
        }

        return aligned;
    }

    private resolveSpeakerId(
        utterance: DoubaoAucUtterance,
        emitAfterMs: number,
        batchProviderMap: Map<string, string>,
    ): string {
        const providerSpeakerId = utterance.providerSpeakerId;
        if (providerSpeakerId && batchProviderMap.has(providerSpeakerId)) {
            return batchProviderMap.get(providerSpeakerId)!;
        }

        const overlapMatch = this.findOverlapMatch(utterance, emitAfterMs);
        if (overlapMatch) {
            if (providerSpeakerId) batchProviderMap.set(providerSpeakerId, overlapMatch);
            return overlapMatch;
        }

        const continuityMatch = this.findContinuityMatch(utterance, batchProviderMap);
        if (continuityMatch) {
            if (providerSpeakerId) batchProviderMap.set(providerSpeakerId, continuityMatch);
            return continuityMatch;
        }

        const allocated = this.allocateSpeakerId();
        if (providerSpeakerId) batchProviderMap.set(providerSpeakerId, allocated);
        return allocated;
    }

    private findOverlapMatch(utterance: DoubaoAucUtterance, emitAfterMs: number): string | null {
        if (utterance.startMs == null || utterance.endMs == null) return null;
        if (utterance.startMs >= emitAfterMs) return null;

        const overlapBySpeaker = new Map<string, number>();
        for (const item of this.history) {
            if (item.startMs == null || item.endMs == null) continue;
            const overlap = Math.max(0, Math.min(utterance.endMs, item.endMs) - Math.max(utterance.startMs, item.startMs));
            if (overlap <= 0) continue;
            overlapBySpeaker.set(item.speakerId, (overlapBySpeaker.get(item.speakerId) || 0) + overlap);
        }

        let bestSpeaker: string | null = null;
        let bestOverlap = 0;
        for (const [speakerId, overlap] of overlapBySpeaker) {
            if (overlap > bestOverlap) {
                bestSpeaker = speakerId;
                bestOverlap = overlap;
            }
        }

        return bestSpeaker;
    }

    private findContinuityMatch(utterance: DoubaoAucUtterance, batchProviderMap: Map<string, string>): string | null {
        if (utterance.providerSpeakerId && batchProviderMap.size > 0 && !batchProviderMap.has(utterance.providerSpeakerId)) {
            return null;
        }
        if (!this.lastEmitted || this.lastEmitted.endMs == null || utterance.startMs == null) return null;
        const gap = utterance.startMs - this.lastEmitted.endMs;
        if (gap < 0 || gap > CONTINUITY_GAP_MS) return null;
        return this.lastEmitted.speakerId;
    }

    private remember(utterance: AlignedDiarizedUtterance): void {
        this.history.push({
            speakerId: utterance.speakerId,
            startMs: utterance.startMs,
            endMs: utterance.endMs,
        });
        if (this.history.length > 100) {
            this.history = this.history.slice(-100);
        }
    }

    private isOverlapOnly(utterance: DoubaoAucUtterance, emitAfterMs: number): boolean {
        return utterance.endMs != null && utterance.endMs <= emitAfterMs;
    }

    private allocateSpeakerId(): string {
        const id = `${this.channel}-${this.nextSpeakerNumber}`;
        this.nextSpeakerNumber += 1;
        return id;
    }

    private labelFor(speakerId: string): string {
        const [, number] = speakerId.split('-');
        return this.channel === 'user' ? `Me ${number}` : `Interviewer ${number}`;
    }
}
