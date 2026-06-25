// electron/services/modes/ModeHybridRetriever.ts
// Compatibility adapter for the legacy mode-specific hybrid retrieval API.
// The scoring/fallback implementation lives in MaterialRagRetriever so global
// materials and scene/mode reference files share one RAG quality path.

import { ModeReferenceFile } from '../ModesManager';
import { EmbeddingPipeline } from '../../rag/EmbeddingPipeline';
import { MaterialRagRetriever, type MaterialRagSource } from '../knowledge/MaterialRagRetriever';

export interface ModeRetrievedChunk {
    sourceId: string;
    fileName: string;
    text: string;
    chunkIndex: number;
    score: number;
    ftsScore: number;
    vectorScore: number;
    trustLevel: 'untrusted_reference';
}

export interface ModeRetrievedContext {
    chunks: ModeRetrievedChunk[];
    formattedContext: string;
    usedFallback: boolean;
    usedHybrid: boolean;
}

export class ModeHybridRetriever {
    private retriever: MaterialRagRetriever;

    constructor(_db: unknown, _vectorStore: unknown, embeddingPipeline: EmbeddingPipeline) {
        this.retriever = new MaterialRagRetriever(embeddingPipeline);
    }

    public static __resetFallbackThrottleForTests(): void {
        MaterialRagRetriever.__resetFallbackThrottleForTests();
    }

    public static emitFallbackTelemetryStatic(props: {
        reason: 'embedding_unavailable' | 'hybrid_threw' | 'db_unavailable';
        candidateCount?: number;
        queryTokenCount?: number;
        modeId?: string;
        errorClass?: string;
    }): void {
        MaterialRagRetriever.emitFallbackTelemetryStatic(props);
    }

    async retrieve(params: {
        query: string;
        modeId: string;
        files: ModeReferenceFile[];
        tokenBudget?: number;
        topK?: number;
        hasTranscript?: boolean;
        scenarioType?: string;
    }): Promise<ModeRetrievedContext> {
        const sources: MaterialRagSource[] = params.files
            .filter((file) => file.content.trim())
            .map((file) => ({
                id: file.id,
                title: file.fileName || 'reference',
                text: file.content.trim(),
                scope: 'mode',
                modeId: params.modeId,
                scenarioType: params.scenarioType,
                sourceType: 'mode_reference_file',
                sourcePriority: 1.1,
            }));

        const result = await this.retriever.retrieve({
            query: params.query,
            sources,
            filters: {
                scopes: ['mode'],
                modeId: params.modeId,
                scenarioType: params.scenarioType,
            },
            tokenBudget: params.tokenBudget,
            topK: params.topK,
            hasTranscript: params.hasTranscript,
            format: 'mode_xml',
        });

        return {
            chunks: result.chunks.map((chunk) => ({
                sourceId: chunk.sourceId,
                fileName: chunk.title,
                text: chunk.text,
                chunkIndex: chunk.chunkIndex,
                score: chunk.score,
                ftsScore: chunk.ftsScore,
                vectorScore: chunk.vectorScore,
                trustLevel: 'untrusted_reference',
            })),
            formattedContext: result.formattedContext,
            usedFallback: result.usedFallback,
            usedHybrid: result.usedHybrid,
        };
    }
}
