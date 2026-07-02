import type { AnswerDegradedReason } from '../../db/DatabaseManager';
import type { TranscriptTurn } from '../../llm/transcriptCleaner';
import type { SpeakerVerificationMetadata } from '../speaker/speakerVerificationTypes';

export interface SpeakerContextTrace {
    speakerMetadataUsed: boolean;
    localVerificationUsed: boolean;
    diarizationUsed: boolean;
    degraded: boolean;
    confidenceSummary: {
        verifiedMeCount: number;
        lowConfidenceCount: number;
        unknownCount: number;
        minConfidence: number | null;
        maxConfidence: number | null;
    };
    sources: Array<'local-speaker-verification' | 'doubao-auc'>;
}

export interface SpeakerContextPolicyResult {
    turns: TranscriptTurn[];
    trace: SpeakerContextTrace;
    degradedReasons: AnswerDegradedReason[];
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isUsableLocalVerification(value: unknown): value is SpeakerVerificationMetadata {
    const metadata = value as Partial<SpeakerVerificationMetadata> | undefined;
    return metadata?.provider === 'local-speaker-verification' &&
        metadata.profileId === 'me' &&
        typeof metadata.isMe === 'boolean' &&
        isFiniteNumber(metadata.confidence) &&
        isFiniteNumber(metadata.threshold);
}

function isHighConfidenceLocalMe(metadata: SpeakerVerificationMetadata): boolean {
    return metadata.provider === 'local-speaker-verification' &&
        metadata.isMe === true &&
        metadata.confidence >= metadata.threshold;
}

function addReason(reasons: AnswerDegradedReason[], reason: AnswerDegradedReason): void {
    if (!reasons.includes(reason)) reasons.push(reason);
}

export function evaluateSpeakerContextForAnswer(turns: TranscriptTurn[]): SpeakerContextPolicyResult {
    const degradedReasons: AnswerDegradedReason[] = [];
    const sources = new Set<'local-speaker-verification' | 'doubao-auc'>();
    let speakerMetadataUsed = false;
    let localVerificationUsed = false;
    let diarizationUsed = false;
    let verifiedMeCount = 0;
    let lowConfidenceCount = 0;
    let unknownCount = 0;
    let minConfidence: number | null = null;
    let maxConfidence: number | null = null;

    const recordConfidence = (confidence: number): void => {
        minConfidence = minConfidence === null ? confidence : Math.min(minConfidence, confidence);
        maxConfidence = maxConfidence === null ? confidence : Math.max(maxConfidence, confidence);
    };

    const sanitizedTurns = turns.map((turn) => {
        let speakerVerification = turn.speakerVerification;

        if (turn.diarizationProvider === 'doubao-auc' || turn.providerSpeakerId) {
            diarizationUsed = true;
            sources.add('doubao-auc');
        }

        if (speakerVerification !== undefined) {
            speakerMetadataUsed = true;

            if (isUsableLocalVerification(speakerVerification)) {
                localVerificationUsed = true;
                sources.add('local-speaker-verification');
                recordConfidence(speakerVerification.confidence);

                if (isHighConfidenceLocalMe(speakerVerification)) {
                    verifiedMeCount += 1;
                } else {
                    lowConfidenceCount += 1;
                    addReason(degradedReasons, 'speaker_metadata_low_confidence');
                    speakerVerification = undefined;
                }
            } else {
                unknownCount += 1;
                addReason(degradedReasons, 'speaker_metadata_unavailable');
                speakerVerification = undefined;
            }
        }

        return speakerVerification === turn.speakerVerification
            ? turn
            : { ...turn, speakerVerification };
    });

    return {
        turns: sanitizedTurns,
        trace: {
            speakerMetadataUsed,
            localVerificationUsed,
            diarizationUsed,
            degraded: degradedReasons.length > 0,
            confidenceSummary: {
                verifiedMeCount,
                lowConfidenceCount,
                unknownCount,
                minConfidence,
                maxConfidence,
            },
            sources: Array.from(sources),
        },
        degradedReasons,
    };
}
