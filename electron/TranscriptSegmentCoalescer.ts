export interface TranscriptCoalescingOptions {
    enabled?: boolean;
    maxGapMs?: number;
    maxMergedChars?: number;
}

export interface CoalescableTranscriptSegment {
    marker?: string;
    speaker: string;
    speakerId?: string;
    speakerLabel?: string;
    providerSpeakerId?: string;
    diarizationProvider?: string;
    text: string;
    timestamp: number;
    final: boolean;
    confidence?: number;
    startTimestampMs?: number;
    endTimestampMs?: number;
    emotion?: string;
    emotionSource?: string;
    speakerVerification?: unknown;
    coalescedFromCount?: number;
    coalescedProvider?: 'post_stt' | 'local_vad';
    rawSegmentIds?: string[];
}

export interface TranscriptCoalescingResult<T extends CoalescableTranscriptSegment> {
    merged: boolean;
    segment: T;
    reason?: string;
}

const DEFAULT_MAX_GAP_MS = 1200;
const DEFAULT_MAX_MERGED_CHARS = 180;

function normalizeText(text: string): string {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function textLengthForLimit(text: string): number {
    return normalizeText(text).length;
}

function endsWithHardBoundary(text: string): boolean {
    return /[。！？!?；;.]$/.test(normalizeText(text));
}

function isMostlyCjk(text: string): boolean {
    const compact = normalizeText(text).replace(/\s+/g, '');
    if (!compact) return false;
    const cjk = compact.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    return cjk / compact.length >= 0.6;
}

function isMostlyLatin(text: string): boolean {
    const compact = normalizeText(text).replace(/\s+/g, '');
    if (!compact) return false;
    const latin = compact.match(/[A-Za-z]/g)?.length ?? 0;
    return latin / compact.length >= 0.7;
}

function isClearLanguageSwitch(a: string, b: string): boolean {
    const left = normalizeText(a);
    const right = normalizeText(b);
    if (left.length < 10 || right.length < 10) return false;
    return (isMostlyCjk(left) && isMostlyLatin(right)) || (isMostlyLatin(left) && isMostlyCjk(right));
}

function sameOptionalValue(a: unknown, b: unknown): boolean {
    return (a ?? '') === (b ?? '');
}

function sameJsonValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function segmentEndMs(segment: CoalescableTranscriptSegment): number {
    return segment.endTimestampMs ?? segment.timestamp;
}

function segmentStartMs(segment: CoalescableTranscriptSegment): number {
    return segment.startTimestampMs ?? segment.timestamp;
}

function joinTranscriptText(a: string, b: string): string {
    const left = normalizeText(a);
    const right = normalizeText(b);
    if (!left) return right;
    if (!right) return left;
    if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) return `${left} ${right}`;
    return `${left}${right}`;
}

function rawSegmentIdsFor(a: CoalescableTranscriptSegment, b: CoalescableTranscriptSegment): string[] | undefined {
    const ids = [
        ...(Array.isArray(a.rawSegmentIds) ? a.rawSegmentIds : []),
        a.marker,
        ...(Array.isArray(b.rawSegmentIds) ? b.rawSegmentIds : []),
        b.marker,
    ].filter((id): id is string => Boolean(id));
    return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
}

export class TranscriptSegmentCoalescer {
    private readonly enabled: boolean;
    private readonly maxGapMs: number;
    private readonly maxMergedChars: number;

    constructor(options: TranscriptCoalescingOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;
        this.maxMergedChars = options.maxMergedChars ?? DEFAULT_MAX_MERGED_CHARS;
    }

    tryMerge<T extends CoalescableTranscriptSegment>(
        previous: T | undefined,
        next: T,
    ): TranscriptCoalescingResult<T> {
        if (!this.enabled || !previous) return { merged: false, segment: next, reason: 'disabled_or_missing_previous' };
        if (!previous.final || !next.final) return { merged: false, segment: next, reason: 'non_final' };
        if (!normalizeText(previous.text) || !normalizeText(next.text)) return { merged: false, segment: next, reason: 'empty_text' };

        if (!sameOptionalValue(previous.speaker, next.speaker)) return { merged: false, segment: next, reason: 'speaker_changed' };
        if (!sameOptionalValue(previous.speakerId, next.speakerId)) return { merged: false, segment: next, reason: 'speaker_id_changed' };
        if (!sameOptionalValue(previous.speakerLabel, next.speakerLabel)) return { merged: false, segment: next, reason: 'speaker_label_changed' };
        if (!sameOptionalValue(previous.providerSpeakerId, next.providerSpeakerId)) return { merged: false, segment: next, reason: 'provider_speaker_changed' };
        if (!sameOptionalValue(previous.diarizationProvider, next.diarizationProvider)) return { merged: false, segment: next, reason: 'provider_changed' };
        if (!sameOptionalValue(previous.emotion, next.emotion)) return { merged: false, segment: next, reason: 'emotion_changed' };
        if (!sameOptionalValue(previous.emotionSource, next.emotionSource)) return { merged: false, segment: next, reason: 'emotion_source_changed' };
        if (!sameJsonValue(previous.speakerVerification, next.speakerVerification)) return { merged: false, segment: next, reason: 'speaker_verification_changed' };

        const gapMs = segmentStartMs(next) - segmentEndMs(previous);
        if (gapMs < 0 || gapMs > this.maxGapMs) return { merged: false, segment: next, reason: 'gap_too_large' };
        if (endsWithHardBoundary(previous.text)) return { merged: false, segment: next, reason: 'hard_sentence_boundary' };
        if (isClearLanguageSwitch(previous.text, next.text)) return { merged: false, segment: next, reason: 'language_switch' };

        const mergedText = joinTranscriptText(previous.text, next.text);
        if (textLengthForLimit(mergedText) > this.maxMergedChars) {
            return { merged: false, segment: next, reason: 'merged_text_too_long' };
        }

        const rawSegmentIds = rawSegmentIdsFor(previous, next);
        const mergedSegment = {
            ...previous,
            text: mergedText,
            timestamp: previous.timestamp,
            startTimestampMs: previous.startTimestampMs ?? previous.timestamp,
            endTimestampMs: next.endTimestampMs ?? next.timestamp,
            confidence: Math.min(previous.confidence ?? 1, next.confidence ?? 1),
            coalescedFromCount: (previous.coalescedFromCount ?? 1) + (next.coalescedFromCount ?? 1),
            coalescedProvider: 'post_stt' as const,
            ...(rawSegmentIds ? { rawSegmentIds } : {}),
        } as T;

        return { merged: true, segment: mergedSegment };
    }
}

