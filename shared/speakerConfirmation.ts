import { resolveSpeakerIdentity, type SpeakerIdentitySegmentLike } from './speakerIdentity';
export type SpeakerConfirmationSpeaker = 'user' | 'interviewer';

export interface DynamicActionSpeakerConfirmation {
    speaker: SpeakerConfirmationSpeaker;
    timestamp: number;
    text: string;
    segmentId?: string;
    sessionGeneration?: string;
    rawSegmentIds?: string[];
    coalescedFromCount?: number;
}

interface SpeakerVerificationLike {
    provider?: string;
    profileId?: string;
    isMe?: boolean;
    confidence?: number;
    threshold?: number;
}

interface SpeakerConfirmationSegmentLike extends SpeakerIdentitySegmentLike {
    segmentId?: string;
    sessionGeneration?: string;
    speaker?: string;
    timestamp?: number;
    text?: string;
    speakerVerification?: SpeakerVerificationLike;
}

export interface DynamicActionSpeakerConfirmationInput {
    segment: SpeakerConfirmationSegmentLike;
    hasConsequentialAction: boolean;
}

const MIN_MEANINGFUL_CHARACTERS = 2;

function normalizeSegmentText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function sameSpeakerConfirmationSegment(
    left: DynamicActionSpeakerConfirmation,
    right: DynamicActionSpeakerConfirmation,
): boolean {
    return left.speaker === right.speaker
        && left.timestamp === right.timestamp
        && normalizeSegmentText(left.text) === normalizeSegmentText(right.text);
}

function meaningfulCharacterCount(text: string): number {
    return [...text.replace(/[\s\p{P}\p{S}]/gu, '')].length;
}

export function buildDynamicActionSpeakerConfirmation(
    input: DynamicActionSpeakerConfirmationInput,
): DynamicActionSpeakerConfirmation | undefined {
    if (!input.hasConsequentialAction) return undefined;

    const { segment } = input;
    if (segment.speaker !== 'user' && segment.speaker !== 'interviewer') return undefined;
    if (!Number.isFinite(segment.timestamp)) return undefined;

    const text = normalizeSegmentText(String(segment.text || ''));
    if (meaningfulCharacterCount(text) < MIN_MEANINGFUL_CHARACTERS) return undefined;

    const identity = resolveSpeakerIdentity(segment);
    if (identity.identity === 'me' || identity.identity === 'other') return undefined;

    return {
        ...(segment.segmentId ? { segmentId: segment.segmentId, sessionGeneration: segment.sessionGeneration } : {}),
        ...((segment.rawSegmentIds?.length ?? 0) > 1 ? { rawSegmentIds: segment.rawSegmentIds } : {}),
        ...((segment.coalescedFromCount ?? 0) > 1 ? { coalescedFromCount: segment.coalescedFromCount } : {}),
        speaker: segment.speaker,
        timestamp: segment.timestamp as number,
        text,
    };
}
