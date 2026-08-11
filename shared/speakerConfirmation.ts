export type SpeakerConfirmationSpeaker = 'user' | 'interviewer';

export interface DynamicActionSpeakerConfirmation {
    speaker: SpeakerConfirmationSpeaker;
    timestamp: number;
    text: string;
}

interface SpeakerVerificationLike {
    provider?: string;
    profileId?: string;
    isMe?: boolean;
    confidence?: number;
    threshold?: number;
}

interface SpeakerConfirmationSegmentLike {
    speaker?: string;
    timestamp?: number;
    text?: string;
    speakerVerification?: SpeakerVerificationLike;
}

export interface DynamicActionSpeakerConfirmationInput {
    segment: SpeakerConfirmationSegmentLike;
    hasConsequentialAction: boolean;
}

const NEAR_THRESHOLD_MARGIN = 0.04;
const MIN_MEANINGFUL_CHARACTERS = 2;

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

    const text = String(segment.text || '').trim();
    if (meaningfulCharacterCount(text) < MIN_MEANINGFUL_CHARACTERS) return undefined;

    const verification = segment.speakerVerification;
    if (verification?.provider !== 'local-speaker-verification'
        || verification.profileId !== 'me'
        || typeof verification.isMe !== 'boolean'
        || !Number.isFinite(verification.confidence)
        || !Number.isFinite(verification.threshold)) {
        return undefined;
    }

    const confidence = verification.confidence as number;
    const threshold = verification.threshold as number;
    const verifiedSpeaker: SpeakerConfirmationSpeaker = verification.isMe ? 'user' : 'interviewer';
    const channelConflict = verifiedSpeaker !== segment.speaker;
    const nearThreshold = Math.abs(confidence - threshold) <= NEAR_THRESHOLD_MARGIN;
    if (!channelConflict && !nearThreshold) return undefined;

    return {
        speaker: segment.speaker,
        timestamp: segment.timestamp as number,
        text,
    };
}
