import { createHash } from 'crypto';

export interface FingerprintTranscriptRow {
    id: number;
    speaker: string | null;
    timestampMs: number;
    content: string;
    speaker_identity_correction_json?: string | null;
    speaker_verification_json?: string | null;
    raw_segment_ids_json?: string | null;
    provider_speaker_id?: string | null;
    diarization_provider?: string | null;
}

export function fingerprintTranscript(rows: FingerprintTranscriptRow[]): string {
    const hash = createHash('sha256');
    hash.update('speaker-identity-v1\u0000');
    const canonicalRows = [...rows].sort(
        (left, right) => (left.timestampMs - right.timestampMs) || (left.id - right.id)
    );

    for (const row of canonicalRows) {
        hash.update(JSON.stringify([row.speaker_identity_correction_json ?? null, row.speaker_verification_json ?? null,
            row.raw_segment_ids_json ?? null, row.provider_speaker_id ?? null, row.diarization_provider ?? null]));
        hash.update(
            `${row.speaker ?? ''}\u0000${row.timestampMs}\u0000${row.content}\u0001`,
            'utf8'
        );
    }

    return hash.digest('hex');
}
