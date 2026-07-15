export type SttSegmentationMode = 'full' | 'chunks' | 'overlap';
export type SttSegmentProviderStatus = 'ok' | 'failed' | 'blocked' | 'skipped';

export interface SttSegmentPlanInput {
    mode: SttSegmentationMode;
    sourceStartSec: number;
    sourceDurationSec: number;
    segmentDurationSec: number;
    overlapSec: number;
    preRollSec?: number;
    postRollSec?: number;
}

export interface SttSegment {
    id: string;
    startSec: number;
    durationSec: number;
    audioStartSec: number;
    audioDurationSec: number;
    overlapBeforeSec: number;
    overlapAfterSec: number;
}

export interface SttSegmentPlan {
    mode: SttSegmentationMode;
    sourceStartSec: number;
    sourceDurationSec: number;
    segmentDurationSec: number;
    overlapSec: number;
    preRollSec: number;
    postRollSec: number;
    segments: SttSegment[];
}

export interface SttSegmentTranscript {
    segmentId: string;
    provider: string;
    text: string;
    normalizedText: string;
    transcribeLatencyMs: number;
    providerStatus: SttSegmentProviderStatus;
}

export interface SttSegmentationDiagnosticsInput {
    mode: SttSegmentationMode;
    overlapSec: number;
    rawText: string;
    dedupedText: string;
    segmentCount: number;
    failedSegmentCount: number;
}

export interface SttSegmentationDiagnostics {
    rawText: string;
    dedupedText: string;
    segmentCount: number;
    overlapSec: number;
    rawChars: number;
    dedupedChars: number;
    removedDuplicateChars: number;
    suspectedBoundaryLoss: boolean;
    warnings: string[];
}

function assertFiniteNonNegative(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${name} must be a finite non-negative number`);
    }
}

function normalizeTranscriptText(text: string): string {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function visibleLength(text: string): number {
    return normalizeTranscriptText(text).replace(/\s+/g, '').length;
}

export function buildSttSegmentPlan(input: SttSegmentPlanInput): SttSegmentPlan {
    assertFiniteNonNegative('sourceStartSec', input.sourceStartSec);
    assertFiniteNonNegative('sourceDurationSec', input.sourceDurationSec);
    assertFiniteNonNegative('segmentDurationSec', input.segmentDurationSec);
    assertFiniteNonNegative('overlapSec', input.overlapSec);
    const preRollSec = input.preRollSec ?? 0;
    const postRollSec = input.postRollSec ?? 0;
    assertFiniteNonNegative('preRollSec', preRollSec);
    assertFiniteNonNegative('postRollSec', postRollSec);
    if (input.sourceDurationSec <= 0) throw new Error('sourceDurationSec must be greater than 0');
    if (input.segmentDurationSec <= 0) throw new Error('segmentDurationSec must be greater than 0');
    if (input.mode !== 'full' && input.overlapSec >= input.segmentDurationSec) {
        throw new Error('overlapSec must be smaller than segmentDurationSec');
    }

    if (input.mode === 'full') {
        return {
            mode: 'full',
            sourceStartSec: input.sourceStartSec,
            sourceDurationSec: input.sourceDurationSec,
            segmentDurationSec: input.sourceDurationSec,
            overlapSec: 0,
            preRollSec: 0,
            postRollSec: 0,
            segments: [{
                id: 'segment-001',
                startSec: input.sourceStartSec,
                durationSec: input.sourceDurationSec,
                audioStartSec: input.sourceStartSec,
                audioDurationSec: input.sourceDurationSec,
                overlapBeforeSec: 0,
                overlapAfterSec: 0,
            }],
        };
    }

    const step = input.mode === 'overlap'
        ? input.segmentDurationSec - input.overlapSec
        : input.segmentDurationSec;
    const endSec = input.sourceStartSec + input.sourceDurationSec;
    const segments: SttSegment[] = [];
    let cursor = input.sourceStartSec;

    while (cursor < endSec) {
        const durationSec = Math.min(input.segmentDurationSec, endSec - cursor);
        const audioStartSec = Math.max(input.sourceStartSec, cursor - preRollSec);
        const audioEndSec = Math.min(endSec, cursor + durationSec + postRollSec);
        const index = segments.length + 1;
        segments.push({
            id: `segment-${String(index).padStart(3, '0')}`,
            startSec: cursor,
            durationSec,
            audioStartSec,
            audioDurationSec: audioEndSec - audioStartSec,
            overlapBeforeSec: input.mode === 'overlap' && index > 1 ? input.overlapSec : 0,
            overlapAfterSec: input.mode === 'overlap' && cursor + durationSec < endSec ? input.overlapSec : 0,
        });
        cursor += step;
    }

    return {
        mode: input.mode,
        sourceStartSec: input.sourceStartSec,
        sourceDurationSec: input.sourceDurationSec,
        segmentDurationSec: input.segmentDurationSec,
        overlapSec: input.mode === 'overlap' ? input.overlapSec : 0,
        preRollSec,
        postRollSec,
        segments,
    };
}

function findSuffixPrefixOverlap(left: string, right: string): number {
    const max = Math.min(left.length, right.length, 80);
    for (let size = max; size >= 2; size -= 1) {
        if (left.slice(-size) === right.slice(0, size)) return size;
    }
    return 0;
}

export function dedupeOverlappedTranscript(parts: string[]): string {
    let merged = '';
    for (const rawPart of parts) {
        const part = normalizeTranscriptText(rawPart);
        if (!part) continue;
        if (!merged) {
            merged = part;
            continue;
        }
        const overlap = findSuffixPrefixOverlap(merged, part);
        if (overlap > 0) {
            merged = `${merged}${part.slice(overlap)}`;
            continue;
        }
        const needsSpace = /[A-Za-z0-9]$/.test(merged) && /^[A-Za-z0-9]/.test(part);
        merged = `${merged}${needsSpace ? ' ' : ''}${part}`;
    }
    return merged;
}

export function mergeSegmentTranscripts(parts: SttSegmentTranscript[]): string {
    return parts
        .filter((part) => part.providerStatus === 'ok')
        .map((part) => part.normalizedText || normalizeTranscriptText(part.text))
        .filter(Boolean)
        .join(' ');
}

export function buildSegmentationDiagnostics(input: SttSegmentationDiagnosticsInput): SttSegmentationDiagnostics {
    const rawChars = visibleLength(input.rawText);
    const dedupedChars = visibleLength(input.dedupedText);
    const warnings: string[] = [];
    if (input.failedSegmentCount > 0) warnings.push('partial_segment_failure');
    if (input.mode !== 'full' && dedupedChars > 0 && rawChars > 0 && dedupedChars / rawChars < 0.5) {
        warnings.push('dedupe_removed_more_than_half_raw_text');
    }
    return {
        rawText: input.rawText,
        dedupedText: input.dedupedText,
        segmentCount: input.segmentCount,
        overlapSec: input.overlapSec,
        rawChars,
        dedupedChars,
        removedDuplicateChars: Math.max(0, rawChars - dedupedChars),
        suspectedBoundaryLoss: input.mode !== 'full' && input.failedSegmentCount > 0,
        warnings,
    };
}
