import * as crypto from 'crypto';
import { DatabaseManager, type AnswerCitationRecord } from '../../db/DatabaseManager';
import type { KnowledgeMaterialSearchResult } from '../knowledge/KnowledgeMaterialService';

export type AnswerCitationResolutionStatus =
    | 'ok'
    | 'stale-citation'
    | 'missing-citation'
    | 'unsupported-citation';

export interface AnswerCitationResolution {
    status: AnswerCitationResolutionStatus;
    citation: AnswerCitationRecord;
    chunk: any | null;
    previewText: string | null;
}

function normalizeCitationText(text: unknown): string {
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

export function hashCitationText(text: string): string {
    return crypto.createHash('sha256').update(normalizeCitationText(text)).digest('hex');
}

function createCitationId(
    sourceType: string,
    sourceId: string,
    chunkId: string | number | null | undefined,
    hash: string,
): string {
    return crypto
        .createHash('sha1')
        .update(`${sourceType}:${sourceId}:${chunkId ?? ''}:${hash}`)
        .digest('hex')
        .slice(0, 16);
}

export function buildUploadedMaterialCitation(hit: KnowledgeMaterialSearchResult): AnswerCitationRecord {
    const chunkText = normalizeCitationText(hit.text || hit.parentText);
    const chunkContentHash = hashCitationText(chunkText);
    const sourceVersion = hit.materialUpdatedAt || hit.fileHash || 'unknown';
    return {
        citationId: createCitationId(hit.sourceType, hit.sourceId, hit.chunkId, chunkContentHash),
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
        sourceVersion,
        chunkId: hit.chunkId,
        chunkContentHash,
        sourceFileHash: hit.fileHash ?? null,
        startOffset: null,
        endOffset: null,
        score: hit.score,
        title: hit.title,
        timestamp: null,
    };
}

export function resolveAnswerCitation(
    db: Pick<DatabaseManager, 'getKnowledgeMaterialChunkById'>,
    citation: AnswerCitationRecord,
): AnswerCitationResolution {
    if (citation.sourceType !== 'uploaded_material') {
        return { status: 'unsupported-citation', citation, chunk: null, previewText: null };
    }

    const chunkId = Number(citation.chunkId);
    if (!Number.isFinite(chunkId)) {
        return { status: 'missing-citation', citation, chunk: null, previewText: null };
    }

    const chunk = db.getKnowledgeMaterialChunkById(chunkId);
    if (!chunk) {
        return { status: 'missing-citation', citation, chunk: null, previewText: null };
    }

    const currentText = normalizeCitationText(chunk.cleaned_text || chunk.parent_text);
    const currentHash = hashCitationText(currentText);
    const currentSourceFileHash = chunk.file_hash ?? null;
    const fileHashMatches = !citation.sourceFileHash || citation.sourceFileHash === currentSourceFileHash;

    if (!citation.chunkContentHash || currentHash !== citation.chunkContentHash || !fileHashMatches) {
        return { status: 'stale-citation', citation, chunk: null, previewText: null };
    }

    return {
        status: 'ok',
        citation,
        chunk,
        previewText: normalizeCitationText(chunk.parent_text || chunk.cleaned_text),
    };
}
