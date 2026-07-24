import { createHash } from 'crypto';

export interface FingerprintTranscriptRow {
    id: number;
    speaker: string | null;
    timestampMs: number;
    content: string;
}

export function fingerprintTranscript(rows: FingerprintTranscriptRow[]): string {
    const hash = createHash('sha256');
    const canonicalRows = [...rows].sort(
        (left, right) => (left.timestampMs - right.timestampMs) || (left.id - right.id)
    );

    for (const row of canonicalRows) {
        hash.update(
            `${row.speaker ?? ''}\u0000${row.timestampMs}\u0000${row.content}\u0001`,
            'utf8'
        );
    }

    return hash.digest('hex');
}
