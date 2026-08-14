import { VectorStore, ScoredChunk } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import { formatChunkForContext } from './SemanticChunker';
import { keywordCoverage } from './RagLexical';

const HYBRID_LEXICAL_WEIGHT = 0.4;
const HYBRID_VECTOR_WEIGHT = 0.6;

/**
 * Query intent types for biasing retrieval strategy
 * Detected via regex patterns, not LLM
 */
export type QueryIntent =
    | 'decision_recall'   // "What did we decide?"
    | 'speaker_lookup'    // "What did X say?"
    | 'action_items'      // "What are my action items?"
    | 'summary'           // "Summarize..."
    | 'open_question';    // Default fallback

export interface RetrievalOptions {
    meetingId?: string;           // For meeting-scoped queries
    maxTokens?: number;           // Context token budget (default: 1500)
    topK?: number;                // Initial retrieval count (default: 8)
    recencyWeight?: number;       // 0-1, how much to weight recent (default: 0.3)
    intent?: QueryIntent;         // Override detected intent
    recentTranscriptTurns?: string[];
    modeIntent?: string;
    semanticQuery?: string;       // Optional expanded query used only for embeddings
}

export interface RetrievedContext {
    chunks: ScoredChunk[];
    formattedContext: string;
    totalTokens: number;
    meetingIds: string[];
    intent: QueryIntent;          // Detected query intent for prompt hints
    retrievalQuery: string;
    citations: Array<{
        sourceType: 'current_meeting' | 'historical_meeting';
        sourceId: string;
        chunkId: number;
        score: number;
        title?: string;
        timestamp?: number | null;
    }>;
}


/**
 * RAGRetriever - Orchestrates the retrieval pipeline
 * 
 * Flow:
 * 1. Embed user query
 * 2. Retrieve candidate chunks from VectorStore
 * 3. Re-rank by relevance + recency
 * 4. Assemble context within token budget
 */
export class RAGRetriever {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Retrieve relevant context for a query
     */
    async retrieve(
        query: string,
        options: RetrievalOptions = {}
    ): Promise<RetrievedContext> {
        const {
            meetingId,
            maxTokens = 1500,
            topK = 8,
            recencyWeight = 0.3,
            intent: overrideIntent
        } = options;

        // Detect query intent (can be overridden)
        const intent = overrideIntent || this.detectIntent(query);
        const retrievalQuery = options.semanticQuery?.trim() || this.buildRetrievalQuery(query, {
            recentTranscriptTurns: options.recentTranscriptTurns,
            modeIntent: options.modeIntent ?? intent,
        });

        // Text retrieval is the baseline for meeting search. Semantic retrieval
        // is an optional recall enhancement and must not make lexical search
        // unavailable when the embedding provider fails.
        const lexicalCandidates = await this.vectorStore.searchLexical(query, {
            meetingId,
            limit: topK * 2,
        });
        let vectorCandidates: ScoredChunk[] = [];

        if (this.embeddingPipeline.isReady()) {
            try {
                const queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(retrievalQuery);
                const spaceKey = this.embeddingPipeline.getActiveSpaceKey();
                vectorCandidates = await this.vectorStore.searchSimilar(queryEmbedding, {
                    meetingId,
                    limit: topK * 2,
                    minSimilarity: 0.25,
                    spaceKey
                });
            } catch {
                console.warn('[RAGRetriever] Semantic retrieval unavailable', {
                    meetingIdPresent: Boolean(meetingId),
                    errorType: 'embedding_query_failed',
                });
            }
        }

        let candidates = this.mergeHybridCandidates(vectorCandidates, lexicalCandidates, query);
        if (meetingId) {
            candidates = candidates.filter(chunk => chunk.meetingId === meetingId);
        }

        if (candidates.length === 0) {
            console.log('[RAGRetriever] No similar chunks found');
            return {
                chunks: [],
                formattedContext: '',
                totalTokens: 0,
                meetingIds: [],
                intent,
                retrievalQuery,
                citations: []
            };
        }

        // 3. Re-rank by relevance + recency
        const now = Date.now();
        candidates = candidates.map(chunk => ({
            ...chunk,
            finalScore: this.computeFinalScore(chunk, now, recencyWeight)
        }));

        candidates.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
        candidates = this.prioritizeExactMatches(candidates, query);

        // 4. Select top-K within token budget
        const selected: ScoredChunk[] = [];
        let totalTokens = 0;

        for (const chunk of candidates) {
            if (totalTokens + chunk.tokenCount > maxTokens) {
                continue;
            }

            selected.push(chunk);
            totalTokens += chunk.tokenCount;

            if (selected.length >= topK) break;
        }

        // 5. Sort selected by timestamp for coherent reading
        selected.sort((a, b) => a.startMs - b.startMs);

        // 6. Format context
        const formattedContext = selected
            .map(chunk => formatChunkForContext(chunk))
            .join('\n\n');

        return {
            chunks: selected,
            formattedContext,
            totalTokens,
            meetingIds: [...new Set(selected.map(c => c.meetingId))],
            intent,
            retrievalQuery,
            citations: this.buildCitations(selected, meetingId ? 'current_meeting' : 'historical_meeting')
        };
    }

    /**
     * Retrieve with summaries for global search
     * Combines chunk search with meeting summary search
     */
    async retrieveGlobal(
        query: string,
        options: RetrievalOptions = {}
    ): Promise<RetrievedContext> {
        const { maxTokens = 1500, topK = 8 } = options;
        const { orderedCandidates, intent, retrievalQuery } = await this.collectGlobalCandidates(query, options);

        // Select within budget
        const selected: ScoredChunk[] = [];
        let totalTokens = 0;

        for (const chunk of orderedCandidates) {
            if (totalTokens + chunk.tokenCount > maxTokens) {
                continue;
            }

            selected.push(chunk);
            totalTokens += chunk.tokenCount;

            if (selected.length >= topK) break;
        }

        // Group by meeting for coherent output
        const byMeeting = new Map<string, ScoredChunk[]>();
        for (const chunk of selected) {
            if (!byMeeting.has(chunk.meetingId)) {
                byMeeting.set(chunk.meetingId, []);
            }
            byMeeting.get(chunk.meetingId)!.push(chunk);
        }

        // Format with meeting grouping
        const contextParts: string[] = [];
        for (const [meetingId, chunks] of byMeeting) {
            // Sort chunks within meeting by timestamp
            chunks.sort((a, b) => a.startMs - b.startMs);
            const chunkTexts = chunks.map(c => formatChunkForContext(c)).join('\n');
            contextParts.push(`--- Meeting ${meetingId} ---\n${chunkTexts}`);
        }

        return {
            chunks: selected,
            formattedContext: contextParts.join('\n\n'),
            totalTokens,
            meetingIds: [...byMeeting.keys()],
            intent,
            retrievalQuery,
            citations: this.buildCitations(selected, 'historical_meeting')
        };
    }

    async searchGlobalMeetings(
        query: string,
        options: RetrievalOptions & { limit?: number } = {}
    ): Promise<ScoredChunk[]> {
        const limit = Math.max(1, options.limit ?? 5);
        const { orderedCandidates } = await this.collectGlobalCandidates(query, {
            ...options,
            topK: Math.max(options.topK ?? 0, limit * 4),
        });
        const selected: ScoredChunk[] = [];
        const seenMeetingIds = new Set<string>();
        for (const candidate of orderedCandidates) {
            if (seenMeetingIds.has(candidate.meetingId)) continue;
            seenMeetingIds.add(candidate.meetingId);
            selected.push(candidate);
            if (selected.length >= limit) break;
        }
        return selected;
    }

    private async collectGlobalCandidates(
        query: string,
        options: RetrievalOptions = {}
    ): Promise<{ orderedCandidates: ScoredChunk[]; intent: QueryIntent; retrievalQuery: string }> {
        const topK = options.topK ?? 8;
        const recencyWeight = options.recencyWeight ?? 0.3;
        const intent = options.intent || this.detectIntent(query);
        const retrievalQuery = options.semanticQuery?.trim() || this.buildRetrievalQuery(query, {
            recentTranscriptTurns: options.recentTranscriptTurns,
            modeIntent: options.modeIntent ?? intent,
        });

        let queryEmbedding: number[] | null = null;
        if (this.embeddingPipeline.isReady()) {
            try {
                queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(retrievalQuery);
            } catch {
                console.warn('[RAGRetriever] Semantic global retrieval unavailable', {
                    errorType: 'embedding_query_failed',
                });
            }
        }

        const spaceKey = this.embeddingPipeline.getActiveSpaceKey();
        let vectorChunkResults: ScoredChunk[] = [];
        if (queryEmbedding) {
            try {
                vectorChunkResults = await this.vectorStore.searchSimilar(queryEmbedding, {
                    limit: topK * 2,
                    minSimilarity: 0.25,
                    spaceKey,
                });
            } catch {
                console.warn('[RAGRetriever] Semantic global retrieval unavailable', {
                    errorType: 'vector_search_failed',
                });
            }
        }
        const lexicalChunkResults = await this.vectorStore.searchLexical(query, { limit: topK * 2 });
        const chunkResults = this.mergeHybridCandidates(vectorChunkResults, lexicalChunkResults, query);
        const meetingFallbackResults = await this.vectorStore.searchLexicalMeetings(query, { limit: topK });
        const globalCandidates = this.mergeHybridCandidates(chunkResults, meetingFallbackResults, query);
        const relevantMeetingIds = new Set<string>();
        if (queryEmbedding) {
            try {
                const summaryResults = await this.vectorStore.searchSummaries(queryEmbedding, 5, spaceKey);
                summaryResults.forEach(summary => relevantMeetingIds.add(summary.meetingId));
            } catch {
                console.warn('[RAGRetriever] Semantic global retrieval unavailable', {
                    errorType: 'summary_search_failed',
                });
            }
        }
        const now = Date.now();
        const ranked = globalCandidates.map(chunk => {
            const similarity = relevantMeetingIds.has(chunk.meetingId)
                ? chunk.similarity * 1.2
                : chunk.similarity;
            return {
                ...chunk,
                similarity,
                finalScore: this.computeFinalScore({ ...chunk, similarity }, now, recencyWeight),
            };
        });
        ranked.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
        return {
            orderedCandidates: this.prioritizeExactMatches(ranked, query),
            intent,
            retrievalQuery,
        };
    }

    private prioritizeExactMatches(candidates: ScoredChunk[], query: string): ScoredChunk[] {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) return candidates;
        const exactCandidates = candidates.filter(candidate =>
            candidate.text.toLocaleLowerCase().includes(normalizedQuery)
        );
        const exactIds = new Set(exactCandidates.map(candidate => candidate.id));
        return [
            ...exactCandidates,
            ...candidates.filter(candidate => !exactIds.has(candidate.id)),
        ];
    }

    buildRetrievalQuery(
        userQuestion: string,
        context: { recentTranscriptTurns?: string[]; modeIntent?: string } = {}
    ): string {
        const parts = [
            userQuestion,
            context.modeIntent ? `intent:${context.modeIntent}` : '',
            ...(context.recentTranscriptTurns ?? []).slice(-3),
        ]
            .map((part) => (part || '').trim())
            .filter(Boolean);
        return [...new Set(parts)].join('\n');
    }

    private mergeHybridCandidates(
        vectorCandidates: ScoredChunk[],
        lexicalCandidates: ScoredChunk[],
        retrievalQuery: string,
    ): ScoredChunk[] {
        const merged = new Map<number, ScoredChunk>();
        for (const chunk of vectorCandidates) {
            merged.set(chunk.id, {
                ...chunk,
                vectorScore: chunk.similarity,
                lexicalScore: keywordCoverage(retrievalQuery, chunk.text),
            });
        }
        for (const chunk of lexicalCandidates) {
            const existing = merged.get(chunk.id);
            if (existing) {
                existing.lexicalScore = Math.max(existing.lexicalScore ?? 0, chunk.lexicalScore ?? chunk.similarity);
                existing.vectorScore = existing.vectorScore ?? 0;
                merged.set(chunk.id, existing);
            } else {
                merged.set(chunk.id, {
                    ...chunk,
                    similarity: 0,
                    vectorScore: 0,
                    lexicalScore: chunk.lexicalScore ?? chunk.similarity,
                });
            }
        }
        return [...merged.values()].map((chunk) => ({
            ...chunk,
            similarity: (HYBRID_LEXICAL_WEIGHT * (chunk.lexicalScore ?? 0))
                + (HYBRID_VECTOR_WEIGHT * (chunk.vectorScore ?? chunk.similarity ?? 0)),
        }));
    }

    /**
     * Compute final score combining relevance and recency
     */
    private computeFinalScore(
        chunk: ScoredChunk,
        now: number,
        recencyWeight: number
    ): number {
        const absoluteStartMs = chunk.absoluteStartMs
            ?? (typeof chunk.meetingStartTimeMs === 'number' ? chunk.meetingStartTimeMs + chunk.startMs : null)
            ?? chunk.meetingCreatedAtMs
            ?? null;
        // Recency: decay over 7 days (half-life). Use meeting wall-clock time
        // plus chunk offset; chunk offset alone is not an absolute timestamp.
        const ageMs = typeof absoluteStartMs === 'number' ? Math.max(0, now - absoluteStartMs) : 0;
        const ageHours = ageMs / (1000 * 60 * 60);
        const recencyScore = typeof absoluteStartMs === 'number'
            ? Math.exp(-ageHours / 168)
            : 0.5;

        // Combined score
        const relevanceWeight = 1 - recencyWeight;
        return (relevanceWeight * chunk.similarity) + (recencyWeight * recencyScore);
    }

    private buildCitations(
        chunks: ScoredChunk[],
        sourceType: 'current_meeting' | 'historical_meeting',
    ): RetrievedContext['citations'] {
        return chunks.map((chunk) => ({
            sourceType,
            sourceId: chunk.meetingId,
            chunkId: chunk.id,
            score: Number((chunk.finalScore ?? chunk.similarity ?? 0).toFixed(4)),
            timestamp: chunk.absoluteStartMs ?? chunk.startMs ?? null,
        }));
    }

    /**
     * Detect query intent for biasing retrieval strategy
     * Uses regex patterns, not LLM - fast and deterministic
     */
    detectIntent(query: string): QueryIntent {
        const lower = query.toLowerCase();

        // Decision patterns
        if (/\b(decide|decision|agreed|conclusion|settled|determined|resolved)\b/.test(lower) ||
            /what did we (decide|agree|conclude)/.test(lower) ||
            /did we (decide|agree|settle)/.test(lower) ||
            /(决定|确定|结论|同意|最终.{0,6}(定|选))/.test(query)) {
            return 'decision_recall';
        }

        // Speaker lookup patterns
        if (/\b(said|mentioned|told|asked|suggested|proposed|pointed out)\b/.test(lower) &&
            /\b(he|she|they|\w+)\s+(said|mentioned|told|asked)/.test(lower)) {
            return 'speaker_lookup';
        }
        if (/what did (\w+|he|she|they) say/.test(lower) ||
            /who said/.test(lower) ||
            /(谁说|谁提到|谁建议|谁提出|说了什么|提到什么)/.test(query)) {
            return 'speaker_lookup';
        }

        // Action items patterns
        if (/\b(action|task|todo|to-do|follow[- ]?up|next step|assigned|deadline)\b/.test(lower) ||
            /what (are|were) (my|the|our) (action|task|todo)/.test(lower) ||
            /what (do i|should i|need to) do/.test(lower) ||
            /(行动项|下一步|跟进|负责|截止|要做什么|需要做什么)/.test(query)) {
            return 'action_items';
        }

        // Summary patterns
        if (/\b(summar|overview|recap|highlights?|key points?)\b/.test(lower) ||
            /^(summarize|recap|give me a summary)/.test(lower) ||
            /(总结|概括|回顾|要点|重点)/.test(query)) {
            return 'summary';
        }

        return 'open_question';
    }

    /**
     * Detect if query is meeting-scoped or global
     */
    detectScope(query: string, currentMeetingId?: string): 'meeting' | 'global' {
        const lower = query.toLowerCase();

        // Meeting-scoped patterns
        const meetingPatterns = [
            'this meeting',
            'this call',
            'just now',
            'earlier',
            'they said',
            'he said',
            'she said',
            'did they',
            'did he',
            'did she',
            'what did'
        ];

        // Global patterns
        const globalPatterns = [
            'all meetings',
            'any meeting',
            'ever discuss',
            'find',
            'search',
            'when did we',
            'have we ever',
            'last time'
        ];

        // Check patterns
        for (const pattern of meetingPatterns) {
            if (lower.includes(pattern)) return 'meeting';
        }

        for (const pattern of globalPatterns) {
            if (lower.includes(pattern)) return 'global';
        }

        // Default based on context
        return currentMeetingId ? 'meeting' : 'global';
    }
}
