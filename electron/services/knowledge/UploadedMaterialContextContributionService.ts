import type { AnswerCitationRecord, AnswerDegradedReason, AnswerSourceStatus } from '../../db/DatabaseManager';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import { getDeniedDataScopes } from '../../llm/ProviderRouter';
import { buildUploadedMaterialCitation } from '../context/AnswerCitationResolver';
import {
    buildRealtimeContextPlan,
    type RealtimeContextCandidate,
} from '../context/RealtimeContextOrchestrator';
import {
    formatUploadedMaterialContext,
    type UploadedMaterialContextHit,
} from './UploadedMaterialContextFormatter';

export interface UploadedMaterialSearchResult extends UploadedMaterialContextHit {
    sourceType: 'uploaded_material';
    sourceId: string;
    chunkId: number;
    score: number;
    title: string;
    text: string;
    parentText: string;
    fileHash?: string;
    materialUpdatedAt?: string;
}

export interface UploadedMaterialSearchResponse {
    hits: UploadedMaterialSearchResult[];
    degradedReason?: 'embedding_unavailable' | 'hybrid_threw';
}

export interface UploadedMaterialSearchService {
    searchWithDiagnostics(
        query: string,
        options?: { limit?: number; candidateLimit?: number; hybridTimeoutMs?: number },
    ): Promise<UploadedMaterialSearchResponse>;
}

export interface UploadedMaterialContextContributionInput {
    query: string;
    existingContext?: string;
    scopePolicy?: ProviderDataScopePolicy;
    materialService: UploadedMaterialSearchService;
    ragReady: boolean;
    embeddingReady: boolean;
    deferContextPlan?: boolean;
    tokenBudget?: number;
    limit?: number;
    candidateLimit?: number;
    hybridTimeoutMs?: number;
    surface?: string;
}

export interface UploadedMaterialContextContribution {
    context?: string;
    contextCandidates: RealtimeContextCandidate[];
    degradedReasons: AnswerDegradedReason[];
    sourceStatus: AnswerSourceStatus;
    citations: AnswerCitationRecord[];
    retrievalTimingMs: { uploaded_material?: number };
    usedMaterialContext: boolean;
    uploadedMaterialHitCount: number;
    truncated: boolean;
}

const DEFAULT_TOKEN_BUDGET = 1800;
const DEFAULT_LIMIT = 4;
const DEFAULT_CANDIDATE_LIMIT = 200;

function emptySourceStatus(
    ragReady: boolean,
    embeddingReady: boolean,
    ragAttempted = false,
    uploadedMaterialHitCount = 0,
    citationCount = 0,
): AnswerSourceStatus {
    return {
        ragAttempted,
        ragReady,
        embeddingReady,
        uploadedMaterialHitCount,
        citationCount,
        screenContextStatus: 'not_available',
    };
}

function emptyContribution(input: UploadedMaterialContextContributionInput, degradedReasons: AnswerDegradedReason[] = []): UploadedMaterialContextContribution {
    return {
        context: input.existingContext,
        contextCandidates: [],
        degradedReasons,
        sourceStatus: emptySourceStatus(input.ragReady, input.embeddingReady),
        citations: [],
        retrievalTimingMs: {},
        usedMaterialContext: false,
        uploadedMaterialHitCount: 0,
        truncated: false,
    };
}

export function shouldRequireUploadedMaterialContext(query: string): boolean {
    return /资料|材料|文档|上传|知识库|pdf|docx|pptx|markdown|根据.{0,8}(资料|材料|文档)/i.test(query);
}

export async function buildUploadedMaterialContextContribution(
    input: UploadedMaterialContextContributionInput,
): Promise<UploadedMaterialContextContribution> {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) return emptyContribution(input);
    if (input.existingContext?.includes('<uploaded_material_context')) return emptyContribution(input);

    if (getDeniedDataScopes(['reference_files'], input.scopePolicy).length > 0) {
        return emptyContribution(input, ['context_scope_denied']);
    }

    const startedAt = Date.now();
    try {
        const materialSearch = await input.materialService.searchWithDiagnostics(query, {
            limit: input.limit ?? DEFAULT_LIMIT,
            candidateLimit: input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
            hybridTimeoutMs: input.hybridTimeoutMs,
        });
        const hits = materialSearch.hits;
        const retrievalTimingMs = { uploaded_material: Date.now() - startedAt };
        const degradedReasons: AnswerDegradedReason[] = [];
        if (materialSearch.degradedReason) degradedReasons.push('embedding_unavailable');
        if (hits.length === 0) {
            degradedReasons.push('no_relevant_uploaded_material');
            return {
                context: input.existingContext,
                contextCandidates: [],
                degradedReasons,
                sourceStatus: emptySourceStatus(input.ragReady, input.embeddingReady, true, 0, 0),
                citations: [],
                retrievalTimingMs,
                usedMaterialContext: false,
                uploadedMaterialHitCount: 0,
                truncated: false,
            };
        }

        const citations = hits.map((hit) => buildUploadedMaterialCitation(hit));
        const candidates: RealtimeContextCandidate[] = hits.map((hit, index) => ({
            source: 'uploaded_material',
            sourceId: hit.sourceId,
            chunkId: hit.chunkId,
            text: hit.text || hit.parentText || '',
            score: hit.score,
            tokenCount: Math.max(1, Math.ceil(String(hit.text || hit.parentText || '').length / 4)),
            sourceVersion: hit.materialUpdatedAt || hit.fileHash || 'unknown',
            contentHash: citations[index].chunkContentHash,
        }));
        if (input.deferContextPlan) {
            return {
                context: input.existingContext,
                contextCandidates: candidates,
                degradedReasons,
                sourceStatus: emptySourceStatus(input.ragReady, input.embeddingReady, true, hits.length, citations.length),
                citations,
                retrievalTimingMs,
                usedMaterialContext: false,
                uploadedMaterialHitCount: hits.length,
                truncated: false,
            };
        }

        const plan = buildRealtimeContextPlan({
            candidates,
            tokenBudget: input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
            ragAttempted: true,
            ragReady: input.ragReady,
            embeddingReady: input.embeddingReady,
            uploadedMaterialHitCount: hits.length,
            screenContextStatus: 'not_available',
            retrievalTimingMs,
            degradedReasons,
        });
        const injectedKeys = new Set(plan.injected.map((candidate) => `${candidate.sourceId}:${candidate.chunkId ?? ''}`));
        const selectedHits = hits.filter((hit) => injectedKeys.has(`${hit.sourceId}:${hit.chunkId}`));
        const selectedCitations = selectedHits.map((hit) => buildUploadedMaterialCitation(hit));
        const formatted = formatUploadedMaterialContext(selectedHits);
        const allReasons = [...plan.degradedReasons];
        if (formatted.truncated && !allReasons.includes('uploaded_material_context_truncated')) {
            allReasons.push('uploaded_material_context_truncated');
        }
        const materialContext = formatted.text;

        return {
            context: input.existingContext ? `${input.existingContext}\n\n${materialContext}` : materialContext,
            contextCandidates: plan.injected,
            degradedReasons: allReasons,
            sourceStatus: { ...plan.sourceStatus, citationCount: selectedCitations.length },
            citations: selectedCitations,
            retrievalTimingMs,
            usedMaterialContext: selectedHits.length > 0,
            uploadedMaterialHitCount: hits.length,
            truncated: formatted.truncated || plan.degradedReasons.includes('uploaded_material_context_truncated'),
        };
    } catch {
        return {
            context: input.existingContext,
            contextCandidates: [],
            degradedReasons: ['uploaded_material_rag_failed'],
            sourceStatus: emptySourceStatus(input.ragReady, input.embeddingReady, true, 0, 0),
            citations: [],
            retrievalTimingMs: { uploaded_material: Date.now() - startedAt },
            usedMaterialContext: false,
            uploadedMaterialHitCount: 0,
            truncated: false,
        };
    }
}
