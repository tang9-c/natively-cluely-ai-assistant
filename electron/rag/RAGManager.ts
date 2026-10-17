import { readMeetingEditState } from '../../shared/meetingEdits';
import { normalizeMeetingActionItems, formatMeetingActionItem, type MeetingActionItem } from '../../shared/meetingActionItems';
// electron/rag/RAGManager.ts
// Central orchestrator for RAG pipeline
// Coordinates preprocessing, chunking, embedding, and retrieval

import Database from 'better-sqlite3';
import { LLMHelper } from '../LLMHelper';
import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript, formatChunkForContext } from './SemanticChunker';
import { VectorStore, type ScoredChunk } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';
import { RAGRetriever, type QueryIntent } from './RAGRetriever';
import { LiveRAGIndexer, applyLiveSpeakerIdentity } from './LiveRAGIndexer';
import { buildRAGPrompt, NO_CONTEXT_FALLBACK, NO_GLOBAL_CONTEXT_FALLBACK } from './prompts';
import type { ProviderDataScopePolicy } from '../llm/ProviderRouter';
import type { MeetingSearchResult } from '../../shared/meetingSearch';
import type { GlobalMeetingSearchHit } from '../../shared/globalMeetingSearch';
import { fingerprintTranscript, type FingerprintTranscriptRow } from './MeetingTranscriptFingerprint';
import {
    assembleMeetingEvidence,
    expandMeetingRetrievalQuery,
    type MeetingSummaryEvidence,
} from './MeetingEvidenceAssembler';

function readIdentityJson<T>(value?: string | null): T | undefined {
    if (!value) return undefined;
    try { return JSON.parse(value) ?? undefined; } catch { return undefined; }
}

export type MeetingQueryPreparation =
    | {
        status: 'ready';
        meetingId: string;
        query: string;
        formattedContext: string;
        editRevision: string | undefined;
        chunks: ScoredChunk[];
        intent: QueryIntent;
    }
    | Exclude<MeetingSearchResult, { status: 'success' }>;

export interface RAGManagerConfig {
    db: Database.Database;
    dbPath: string;       // Passed to VectorStore so worker can open its own read-only connection
    extPath: string;      // Resolved sqlite-vec extension path (no platform suffix)
    qcloudKey?: string;
    openaiKey?: string;
    geminiKey?: string;
    doubaoKey?: string;
    doubaoEmbeddingModel?: string;
    ollamaUrl?: string;
    providerDataScopes?: ProviderDataScopePolicy;
}

/**
 * RAGManager - Central orchestrator for RAG operations
 * 
 * Lifecycle:
 * 1. Initialize with database and API key
 * 2. When meeting ends: processMeeting() -> chunks + queue embeddings
 * 3. When user queries: query() -> retrieve + stream response
 */
export class RAGManager {
    private db: Database.Database;
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private retriever: RAGRetriever;
    private llmHelper: LLMHelper | null = null;
    private liveIndexer: LiveRAGIndexer;
    private liveRagStartPromise: Promise<void> | null = null;
    private pendingLiveSegments: RawSegment[] = [];
    private disposed = false;
    private ensureMeetingIndexInFlight = new Map<string, Promise<void>>();
    /** Guards against concurrent reprocessMeeting() calls for the same meeting ID. */
    private _reprocessInFlight = new Set<string>();
    private meetingReindexTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(config: RAGManagerConfig) {
        this.db = config.db;
        this.vectorStore = new VectorStore(config.db, config.dbPath, config.extPath);
        this.embeddingPipeline = new EmbeddingPipeline(config.db, this.vectorStore);
        this.retriever = new RAGRetriever(this.vectorStore, this.embeddingPipeline);
        this.liveIndexer = new LiveRAGIndexer(this.vectorStore, this.embeddingPipeline);
        this.embeddingPipeline.onInitialized(() => {
            if (this.disposed) return;
            this._backfillEmbeddingProviderMetadata();
            this.scheduleAutoReindex();
            this.recoverDirtyMeetingIndexes();
        });

        this.embeddingPipeline.configure({
            qcloudKey: config.qcloudKey,
            openaiKey: config.openaiKey,
            geminiKey: config.geminiKey,
            doubaoKey: config.doubaoKey,
            doubaoEmbeddingModel: config.doubaoEmbeddingModel,
            ollamaUrl: config.ollamaUrl,
            providerDataScopes: config.providerDataScopes
        });
        this.recoverDirtyMeetingIndexes();
    }

    /**
     * Set LLM helper for generating responses
     */
    setLLMHelper(llmHelper: LLMHelper): void {
        this.llmHelper = llmHelper;
    }

    getEmbeddingPipeline(): EmbeddingPipeline {
        return this.embeddingPipeline;
    }

    initializeEmbeddings(keys: { qcloudKey?: string, openaiKey?: string, geminiKey?: string, doubaoKey?: string, doubaoEmbeddingModel?: string, ollamaUrl?: string, providerDataScopes?: ProviderDataScopePolicy }): void {
        this.embeddingPipeline.configure(keys);
    }

    private _backfillEmbeddingProviderMetadata(): void {
        const providerName = this.embeddingPipeline.getActiveProviderName();
        const dimensions = this.embeddingPipeline.getActiveDimensions();
        if (providerName && dimensions) {
            // Stamps provider/dims only — NOT embedding_space. Space is owned by the
            // re-index sweep so a NULL-space legacy row can't be mislabeled as the
            // active space (which would skip re-index → silent garbage).
            this.vectorStore.backfillEmbeddingProviderMetadata(providerName, dimensions);
        }
    }

    /**
     * Check if RAG is ready for queries
     */
    isReady(): boolean {
        return (this.embeddingPipeline.isReady() || this.embeddingPipeline.isConfigured()) && this.llmHelper !== null;
    }

    private async ensureMeetingIndex(
        meetingId: string,
        transcriptRows: FingerprintTranscriptRow[]
    ): Promise<void> {
        const transcriptHash = fingerprintTranscript(transcriptRows);
        const isCurrent = () => {
            const state = this.vectorStore.getMeetingChunkState(meetingId);
            return state.indexState === 'complete'
                && state.chunkCount > 0
                && state.transcriptHash === transcriptHash;
        };

        if (isCurrent()) return;

        const existing = this.ensureMeetingIndexInFlight.get(meetingId);
        if (existing) {
            await existing;
            return;
        }

        const buildPromise = Promise.resolve().then(async () => {
            if (this.disposed) return;
            if (isCurrent()) return;

            this.vectorStore.markMeetingIndexState(meetingId, 'building');
            try {
                const rawSegments: RawSegment[] = transcriptRows.map(row => ({
                    speaker: row.speaker ?? '发言人',
                    speakerIdentityCorrection: readIdentityJson(row.speaker_identity_correction_json),
                    speakerVerification: readIdentityJson(row.speaker_verification_json),
                    rawSegmentIds: readIdentityJson(row.raw_segment_ids_json),
                    providerSpeakerId: row.provider_speaker_id ?? undefined,
                    diarizationProvider: row.diarization_provider ?? undefined,
                    text: row.content,
                    timestamp: row.timestampMs,
                }));
                const chunks = chunkTranscript(
                    meetingId,
                    preprocessTranscript(rawSegments)
                );
                if (chunks.length === 0) {
                    throw new Error('No searchable transcript chunks');
                }

                this.vectorStore.replaceMeetingChunksAtomically(
                    meetingId,
                    chunks,
                    transcriptHash
                );
                if (this.embeddingPipeline.isReady()) {
                    await this.embeddingPipeline.queueMeeting(meetingId);
                }
            } catch {
                if (!this.disposed) this.vectorStore.markMeetingIndexState(meetingId, 'failed');
                throw new Error('Meeting index rebuild failed');
            }
        });

        this.ensureMeetingIndexInFlight.set(meetingId, buildPromise);
        try {
            await buildPromise;
        } finally {
            if (this.ensureMeetingIndexInFlight.get(meetingId) === buildPromise) {
                this.ensureMeetingIndexInFlight.delete(meetingId);
            }
        }
    }

    async prepareMeetingQuery(
        meetingId: string,
        query: string
    ): Promise<MeetingQueryPreparation> {
        const meeting = this.db.prepare(`
            SELECT id, summary_json
            FROM meetings
            WHERE id = ?
        `).get(meetingId) as { id: string; summary_json: string | null } | undefined;
        if (!meeting) {
            return { status: 'meeting_not_found', message: '无法找到本次会议。' };
        }

        const editRevision = this.storedMeetingEditRevision(meetingId);
        const transcriptRows = this.db.prepare(`
            SELECT *, timestamp_ms AS timestampMs
            FROM transcripts
            WHERE meeting_id = ?
            ORDER BY timestamp_ms ASC, id ASC
        `).all(meetingId) as FingerprintTranscriptRow[];
        if (!transcriptRows.some(row => row.content?.trim())) {
            return {
                status: 'transcript_unavailable',
                message: '本次会议没有可供搜索的转录内容。',
            };
        }

        try {
            await this.ensureMeetingIndex(meetingId, transcriptRows);
        } catch {
            return {
                status: 'query_failed',
                message: '本次会议搜索暂时不可用，请稍后重试。',
            };
        }

        let summary: MeetingSummaryEvidence = {};
        try {
            const current = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as { edit_state_json?: string } | undefined;
            const editState = readMeetingEditState(current?.edit_state_json);
            if (editState.transcriptRevision > editState.summarySourceRevision) throw new Error('Summary is stale');
            const parsed = JSON.parse(meeting.summary_json || '{}');
            summary = normalizeMeetingActionItems(parsed?.detailedSummary ?? {});
        } catch {
            summary = {};
        }

        const intent = this.retriever.detectIntent(query);
        const retrievalQuery = expandMeetingRetrievalQuery(query, intent, summary);
        let retrieved;
        try {
            retrieved = await this.retriever.retrieve(query, {
                meetingId,
                intent,
                maxTokens: 1500,
                semanticQuery: retrievalQuery,
            });
        } catch {
            return {
                status: 'query_failed',
                message: '本次会议搜索暂时不可用，请稍后重试。',
            };
        }

        if (editRevision !== this.storedMeetingEditRevision(meetingId)) {
            return { status: 'query_failed', message: '会议记录已修改，请重试本次搜索。' };
        }

        const evidenceChunks = retrieved.chunks.filter(chunk => chunk.meetingId === meetingId && this.vectorStore.isCurrentChunk(chunk));
        const assembled = assembleMeetingEvidence({
            meetingId,
            intent,
            summary,
            retrievedChunks: evidenceChunks,
            timelineChunks: this.vectorStore.getChunksForMeeting(meetingId),
            maxTokens: 1500,
        });
        if (assembled.evidence.length === 0) {
            return {
                status: 'no_match',
                message: `本次会议中没有找到与“${query}”相关的内容。`,
            };
        }
        if (!this.llmHelper) {
            return {
                status: 'llm_unavailable',
                message: '会议内容已找到，但当前无法生成回答，请稍后重试。',
            };
        }

        return {
            status: 'ready',
            meetingId,
            query,
            formattedContext: assembled.formattedContext,
            editRevision,
            chunks: evidenceChunks,
            intent,
        };
    }

    async *streamMeetingAnswer(
        prepared: Extract<MeetingQueryPreparation, { status: 'ready' }>,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }
        const isCurrent = () => prepared.editRevision === this.storedMeetingEditRevision(prepared.meetingId)
            && prepared.chunks.every(chunk => this.vectorStore.isCurrentChunk(chunk));
        if (!isCurrent()) throw new Error('STALE_MEETING_EVIDENCE');
        const prompt = buildRAGPrompt(
            prepared.query,
            prepared.formattedContext,
            'meeting',
            prepared.intent
        );
        const stream = this.llmHelper.streamChatWithGemini(
            prompt,
            undefined,
            undefined,
            true
        );
        for await (const chunk of stream) {
            if (abortSignal?.aborted || !isCurrent()) return;
            yield chunk;
        }
    }

    /**
     * Process a meeting after it ends
     * Creates chunks and queues them for embedding
     */
    async processMeeting(
        meetingId: string,
        transcript: RawSegment[],
        summary?: string
    ): Promise<{ chunkCount: number }> {
        if (this.disposed) return { chunkCount: 0 };
        console.log(`[RAGManager] Processing meeting ${meetingId} with ${transcript.length} segments`);

        // 1. Preprocess transcript
        const cleaned = preprocessTranscript(transcript);
        console.log(`[RAGManager] Preprocessed to ${cleaned.length} cleaned segments`);

        // 2. Chunk the transcript
        const chunks = chunkTranscript(meetingId, cleaned);
        console.log(`[RAGManager] Created ${chunks.length} chunks`);

        if (chunks.length === 0) {
            console.log(`[RAGManager] No chunks to save for meeting ${meetingId}`);
            return { chunkCount: 0 };
        }

        // 3. Save chunks to database
        this.vectorStore.saveChunks(chunks);

        // 4. Save summary if provided
        if (summary) {
            this.vectorStore.saveSummary(meetingId, summary);
        }

        // 5. Queue for embedding (background processing)
        if (this.embeddingPipeline.isReady()) {
            await this.embeddingPipeline.queueMeeting(meetingId);
        } else {
            console.log(`[RAGManager] Embeddings not ready, chunks saved without embeddings`);
        }

        return { chunkCount: chunks.length };
    }

    /**
     * Query meeting with RAG
     * Returns streaming generator for response
     */
    async *queryMeeting(
        meetingId: string,
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        const liveMeeting = this.liveIndexer.getActiveMeetingId() === meetingId;
        const liveIdentityRevision = liveMeeting ? this.liveIndexer.getIdentityRevision() : undefined;
        const storedIdentityRevision = liveMeeting ? undefined : this.storedMeetingEditRevision(meetingId);
        if (liveMeeting && !this.liveIndexer.hasCurrentIdentity()) throw new Error('LIVE_TRANSCRIPT_CHANGED');
        if (!liveMeeting && !this.isStoredMeetingIdentityCurrent(meetingId)) throw new Error('STALE_MEETING_IDENTITY');
        // Check if meeting has embeddings (post-meeting RAG)
        const hasEmbeddings = this.vectorStore.hasEmbeddings(meetingId);

        if (!hasEmbeddings) {
            // JIT RAG: Check if live indexer has chunks for this meeting
            const isLiveMeeting = this.liveIndexer.getActiveMeetingId() === meetingId;
            if (isLiveMeeting && this.liveIndexer.hasIndexedChunks()) {
                console.log(`[RAGManager] Using JIT RAG for live meeting ${meetingId} (${this.liveIndexer.getIndexedChunkCount()} chunks)`);
                // Fall through to retrieval — VectorStore already has the JIT chunks
            } else {
                // No embeddings at all — trigger wrapper fallback
                throw new Error('NO_MEETING_EMBEDDINGS');
            }
        }

        // Retrieve relevant context
        const context = await this.retriever.retrieve(query, { meetingId });
        if (liveMeeting && (liveIdentityRevision !== this.liveIndexer.getIdentityRevision() || !this.liveIndexer.hasCurrentIdentity())) {
            throw new Error('LIVE_TRANSCRIPT_CHANGED');
        }

        if (!liveMeeting && (storedIdentityRevision !== this.storedMeetingEditRevision(meetingId) || !this.isStoredMeetingIdentityCurrent(meetingId))) {
            throw new Error('STALE_MEETING_IDENTITY');
        }

        if (context.chunks.some(chunk => !this.vectorStore.isCurrentChunk(chunk))) throw new Error('STALE_MEETING_EVIDENCE');
        if (context.chunks.length === 0) {
            // No context relevant to query - trigger wrapper fallback to use context window
            throw new Error('NO_RELEVANT_CONTEXT_FOUND');
        }

        // Build prompt with intent hint
        const prompt = buildRAGPrompt(query, context.formattedContext, 'meeting', context.intent);

        // Stream response
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true);

        for await (const chunk of stream) {
            if (abortSignal?.aborted || context.chunks.some(chunk => !this.vectorStore.isCurrentChunk(chunk)) || (liveMeeting
                ? liveIdentityRevision !== this.liveIndexer.getIdentityRevision()
                : storedIdentityRevision !== this.storedMeetingEditRevision(meetingId))) break;
            yield chunk;
        }
    }

    private storedMeetingEditRevision(meetingId: string): string | undefined {
        const row = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as { edit_state_json?: string } | undefined;
        return row ? row.edit_state_json ?? '' : undefined;
    }

    private isStoredMeetingIdentityCurrent(meetingId: string): boolean {
        try {
            const rows = this.db.prepare(`SELECT *, timestamp_ms AS timestampMs FROM transcripts
                WHERE meeting_id = ? ORDER BY timestamp_ms ASC, id ASC`).all(meetingId) as FingerprintTranscriptRow[];
            if (!rows.length) return false;
            const state = this.vectorStore.getMeetingChunkState(meetingId);
            const meeting = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as { edit_state_json?: string } | undefined;
            return !readMeetingEditState(meeting?.edit_state_json).indexDirty && state.indexState === 'complete' && state.transcriptHash === fingerprintTranscript(rows);
        } catch { return false; }
    }

    /**
     * Query across all meetings (global search)
     */
    async *queryGlobal(
        query: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        if (!this.llmHelper) {
            throw new Error('LLM helper not initialized');
        }

        // Retrieve from all meetings
        const context = await this.retriever.retrieveGlobal(query);

        const currentMeetings = new Map(context.meetingIds.map(id => [id, this.isStoredMeetingIdentityCurrent(id)]));
        const safeChunks = context.chunks.filter(chunk => currentMeetings.get(chunk.meetingId) && this.vectorStore.isCurrentChunk(chunk));
        if (safeChunks.length === 0) {
            yield NO_GLOBAL_CONTEXT_FALLBACK;
            return;
        }

        const revisions = new Map([...new Set(safeChunks.map(chunk => chunk.meetingId))]
            .map(id => [id, this.storedMeetingEditRevision(id)]));
        // Build prompt with intent hint
        const prompt = buildRAGPrompt(query, safeChunks.map(chunk => `--- Meeting ${chunk.meetingId} ---\n${formatChunkForContext(chunk)}`).join('\n\n'), 'global', context.intent);

        // Stream response
        const stream = this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true);

        for await (const chunk of stream) {
            if (abortSignal?.aborted || safeChunks.some(chunk => !this.vectorStore.isCurrentChunk(chunk))
                || [...revisions].some(([id, revision]) => revision !== this.storedMeetingEditRevision(id))) break;
            yield chunk;
        }
    }

    async searchGlobalMeetings(query: string, limit = 5): Promise<GlobalMeetingSearchHit[]> {
        const normalizedLimit = Math.max(1, Math.min(20, Math.floor(limit)));
        const candidates = await this.retriever.searchGlobalMeetings(query, { limit: normalizedLimit });
        const readMeeting = this.db.prepare(`
            SELECT id, title, start_time
            FROM meetings
            WHERE id = ?
        `);
        return candidates.flatMap((candidate) => {
            if (!this.isStoredMeetingIdentityCurrent(candidate.meetingId) || !this.vectorStore.isCurrentChunk(candidate)) return [];
            const meeting = readMeeting.get(candidate.meetingId) as {
                id: string;
                title: string | null;
                start_time: number | null;
            } | undefined;
            if (!meeting) return [];
            return [{
                meetingId: candidate.meetingId,
                title: meeting.title?.trim() || '未命名会议',
                startTimeMs: typeof meeting.start_time === 'number' ? meeting.start_time : null,
                snippet: candidate.text.trim().slice(0, 280),
                score: candidate.finalScore ?? candidate.similarity ?? 0,
            }];
        });
    }

    /**
     * Smart query - auto-detects scope
     */
    async *query(
        query: string,
        currentMeetingId?: string,
        abortSignal?: AbortSignal
    ): AsyncGenerator<string, void, unknown> {
        const scope = this.retriever.detectScope(query, currentMeetingId);

        if (scope === 'meeting' && currentMeetingId) {
            yield* this.queryMeeting(currentMeetingId, query, abortSignal);
        } else {
            yield* this.queryGlobal(query, abortSignal);
        }
    }

    /**
     * Get embedding queue status
     */
    getQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        return this.embeddingPipeline.getQueueStatus();
    }

    getRuntimeStats(): { pending: number; processing: number; completed: number; failed: number; embeddingBatches: number } {
        return {
            ...this.embeddingPipeline.getQueueStatus(),
            ...this.embeddingPipeline.getRuntimeStats(),
        };
    }

    /**
     * Retry pending embeddings
     */
    async retryPendingEmbeddings(): Promise<void> {
        this.recoverDirtyMeetingIndexes();
        await this.embeddingPipeline.processQueue();
    }

    /**
     * Check if a meeting has been processed for RAG
     */
    isMeetingProcessed(meetingId: string): boolean {
        return this.vectorStore.hasEmbeddings(meetingId);
    }

    // ─── JIT RAG: Live Meeting Indexing ──────────────────────────────

    /**
     * Start JIT indexing for a live meeting.
     * Call when a meeting session begins.
     */
    startLiveIndexing(meetingId: string): Promise<void> {
        if (this.disposed) return Promise.resolve();
        if (this.liveRagStartPromise) {
            return this.liveRagStartPromise;
        }

        const starting = this.startLiveIndexingInternal(meetingId);
        this.liveRagStartPromise = starting;
        void starting.then(
            () => {
                if (this.liveRagStartPromise === starting) {
                    this.liveRagStartPromise = null;
                }
            },
            () => {
                if (this.liveRagStartPromise === starting) {
                    this.liveRagStartPromise = null;
                    this.pendingLiveSegments = [];
                }
            }
        );
        return starting;
    }

    private async startLiveIndexingInternal(meetingId: string): Promise<void> {
        await this.embeddingPipeline.ensureInitialized();
        if (this.disposed) return;

        // Ensure meeting row exists in DB to satisfy foreign key constraints for chunks
        try {
            this.db.prepare(`
                INSERT OR IGNORE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed)
                VALUES (?, 'Live Meeting', ?, 0, '{}', ?, 'manual', 0)
            `).run(meetingId, Date.now(), new Date().toISOString());
        } catch (e) {
            console.warn('[RAGManager] Failed to create transient meeting row for live indexing', e);
        }

        await this.liveIndexer.start(meetingId);
        if (this.disposed) return;
        if (this.pendingLiveSegments.length > 0) {
            const pendingSegments = this.pendingLiveSegments;
            this.pendingLiveSegments = [];
            this.liveIndexer.feedSegments(pendingSegments);
        }
    }

    /**
     * Feed new transcript segments to the live indexer.
     * Call whenever new transcript arrives during the meeting.
     */
    feedLiveTranscript(segments: RawSegment[]): void {
        if (this.disposed) return;
        if (this.liveRagStartPromise) {
            this.pendingLiveSegments.push(...segments);
            return;
        }
        this.liveIndexer.feedSegments(segments);
    }

    correctLiveSpeakerIdentity(segment: RawSegment): void {
        if (this.disposed) return;
        applyLiveSpeakerIdentity(this.pendingLiveSegments, segment);
        this.liveIndexer.correctSpeakerIdentity(segment);
    }

    /**
     * Stop JIT indexing (flushes remaining segments).
     * Call when the meeting session ends.
     * NOTE: The post-meeting processMeeting() will later replace JIT chunks
     * with the complete, properly indexed version.
     */
    async stopLiveIndexing(): Promise<void> {
        if (this.disposed) return;
        const starting = this.liveRagStartPromise;
        if (starting) {
            try {
                await starting;
            } catch {
                // A failed start has no live resources, but stop still clears pending input.
            }
        }
        if (this.disposed) return;
        await this.liveIndexer.stop();
        this.pendingLiveSegments = [];
    }

    /**
     * Check if JIT indexing is active for a meeting.
     */
    isLiveIndexingActive(meetingId?: string): boolean {
        if (meetingId) {
            return this.liveIndexer.getActiveMeetingId() === meetingId;
        }
        return this.liveIndexer.isRunning();
    }

    /**
     * Check if JIT indexing has produced at least one queryable (embedded) chunk.
     * Prevents wasted queryMeeting() calls that immediately throw NO_MEETING_EMBEDDINGS.
     */
    hasLiveChunks(): boolean {
        return this.liveIndexer.hasIndexedChunks();
    }

    /**
     * Delete RAG data for a meeting
     */
    deleteMeetingData(meetingId: string): void {
        // 1. Delete from vector store (chunks and summaries)
        this.vectorStore.deleteChunksForMeeting(meetingId);
        
        // 2. Clear embedding queue for this meeting to prevent "Chunk not found" errors on re-processing
        const info = this.db.prepare('DELETE FROM embedding_queue WHERE meeting_id = ?').run(meetingId);
        if (info.changes > 0) {
            console.log(`[RAGManager] Cleared ${info.changes} items from embedding_queue for meeting ${meetingId}`);
        }
        
        // 3. Clean up transient meeting row if it was a live session
        try {
            if (meetingId === 'live-meeting-current') {
                this.db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId);
            }
        } catch (e) {
            console.warn('[RAGManager] Failed to delete transient meeting row', e);
        }
    }

    deleteMeetingCompletely(meetingId: string): boolean {
        try {
            return this.db.transaction(() => {
                this.deleteMeetingData(meetingId);
                return this.db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId).changes > 0;
            })();
        } catch (error) {
            console.warn(`[RAGManager] Failed to delete meeting ${meetingId}`, error);
            return false;
        }
    }

    /**
     * Manually trigger processing for a meeting
     * Useful for demo meetings or reprocessing failed ones
     */
    scheduleMeetingReindex(meetingId: string, retryAttempt = 0): void {
        if (this.disposed) return;
        clearTimeout(this.meetingReindexTimers.get(meetingId));
        this.meetingReindexTimers.set(meetingId, setTimeout(() => {
            this.meetingReindexTimers.delete(meetingId);
            void this.reprocessMeeting(meetingId).catch(() => {
                console.warn('[RAGManager] Edited meeting index refresh failed; latest record retained');
                if (this.disposed) return;
                const latest = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as { edit_state_json?: string } | undefined;
                if (!this.disposed && latest && readMeetingEditState(latest.edit_state_json).indexDirty && !this.meetingReindexTimers.has(meetingId)) {
                    this.scheduleMeetingReindex(meetingId, retryAttempt + 1);
                }
            });
        }, retryAttempt ? Math.min(30_000, 2_000 * Math.pow(2, Math.min(retryAttempt - 1, 4))) : 600));
    }

    recoverDirtyMeetingIndexes(): void {
        const rows = this.db.prepare('SELECT * FROM meetings').all() as Array<{ id: string; edit_state_json?: string }>;
        for (const row of rows) {
            if (readMeetingEditState(row.edit_state_json).indexDirty) this.scheduleMeetingReindex(row.id);
        }
    }

    async reprocessMeeting(meetingId: string): Promise<void> {
        if (this.disposed || this._reprocessInFlight.has(meetingId)) return;
        this._reprocessInFlight.add(meetingId);
        const row = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as { summary_json?: string; edit_state_json?: string } | undefined;
        const state = readMeetingEditState(row?.edit_state_json);
        try {
            if (!row) return;
            const transcriptRows = this.db.prepare(`SELECT *, timestamp_ms AS timestampMs FROM transcripts
                WHERE meeting_id = ? ORDER BY timestamp_ms ASC, id ASC`).all(meetingId) as FingerprintTranscriptRow[];
            const segments: RawSegment[] = transcriptRows.map(t => ({
                speaker: t.speaker ?? '发言人', text: t.content, timestamp: t.timestampMs,
                speakerIdentityCorrection: readIdentityJson(t.speaker_identity_correction_json),
                speakerVerification: readIdentityJson(t.speaker_verification_json),
                rawSegmentIds: readIdentityJson(t.raw_segment_ids_json),
                providerSpeakerId: t.provider_speaker_id ?? undefined,
                diarizationProvider: t.diarization_provider ?? undefined,
            }));
            const saved = JSON.parse(row.summary_json || '{}');
            let summary: string | undefined;
            if (state.summarySourceRevision >= state.transcriptRevision) {
                if (saved.detailedSummary) {
                    summary = [saved.detailedSummary.overview, ...(saved.detailedSummary.keyPoints || []),
                        ...normalizeMeetingActionItems(saved.detailedSummary).actionItemsStructured.map((item: MeetingActionItem) => `Action: ${formatMeetingActionItem(item)}`)].filter(Boolean).join('. ');
                } else summary = saved.legacySummary;
            }
            // Delete the old retrieval copies and rebuild from one current snapshot.
            this.db.transaction(() => {
                this.deleteMeetingData(meetingId);
                const chunks = chunkTranscript(meetingId, preprocessTranscript(segments));
                this.vectorStore.saveChunks(chunks);
                if (summary) this.vectorStore.saveSummary(meetingId, summary);
                this.db.prepare(`UPDATE meetings SET rag_transcript_hash = ?, rag_index_state = 'complete',
                    embedding_provider = NULL, embedding_dimensions = NULL, embedding_space = NULL, edit_state_json = ? WHERE id = ?`)
                    .run(fingerprintTranscript(transcriptRows), JSON.stringify({ ...state, indexRevision: state.meetingRevision }), meetingId);
            })();
            // Persist work even when there is no permitted/available embedding provider.
            await this.embeddingPipeline.queueMeeting(meetingId);
        } finally {
            this._reprocessInFlight.delete(meetingId);
            if (!this.disposed) {
                const latest = this.db.prepare('SELECT edit_state_json FROM meetings WHERE id = ?').get(meetingId) as { edit_state_json?: string } | undefined;
                if (latest && readMeetingEditState(latest.edit_state_json).meetingRevision !== state.meetingRevision) this.scheduleMeetingReindex(meetingId);
            }
        }
    }

    /**
     * Ensure demo meeting is processed
     * Checks if demo meeting exists but has no chunks, then processes it
     */
    async ensureDemoMeetingProcessed(): Promise<void> {
        const demoId = 'demo-meeting'; // Corrected ID to match DatabaseManager

        // Check if demo meeting exists in DB
        const { DatabaseManager } = require('../db/DatabaseManager');
        const meeting = DatabaseManager.getInstance().getMeetingDetails(demoId);

        if (!meeting) {
            // console.log('[RAGManager] Demo meeting not found in DB, skipping RAG processing');
            return;
        }

        // Check if already processed (has embeddings)
        if (this.isMeetingProcessed(demoId)) {
            // console.log('[RAGManager] Demo meeting already processed');
            return;
        }

        // Guard: also check the in-flight set — reprocessMeeting() itself is guarded,
        // but checking here avoids even printing the "Processing now..." log redundantly.
        if (this._reprocessInFlight.has(demoId)) {
            console.log(`[RAGManager] Demo meeting reprocessing already in-flight, skipping`);
            return;
        }

        console.log('[RAGManager] Demo meeting found but not processed. Processing now...');
        await this.reprocessMeeting(demoId);
    }

    /**
     * Cleanup stale queue items for meetings that no longer exist
     */
    public cleanupStaleQueueItems(): void {
        try {
            const info = this.db.prepare(`
                DELETE FROM embedding_queue 
                WHERE meeting_id NOT IN (SELECT id FROM meetings)
            `).run();
            if (info.changes > 0) {
                console.log(`[RAGManager] Cleaned up ${info.changes} stale queue items`);
            }
        } catch (error) {
            console.error('[RAGManager] Failed to cleanup stale queue items:', error);
        }
    }

    /**
     * Manual re-index entry point (settings button / IPC). Delegates to the same
     * guarded routine as the automatic path so the two can't run concurrently and
     * double-clear/double-queue.
     */
    async reindexIncompatibleMeetings(): Promise<void> {
        await this._runReindex();
    }

    /**
     * Automatically re-index meetings whose embedding space differs from the
     * active one (e.g. after the gemini-embedding-001 → gemini-embedding-2 bump).
     *
     * Design:
     *  - Triggered off the incompatible COUNT (not lastSpace != activeSpace) so a
     *    crash mid-reindex resumes next launch.
     *  - Each meeting is cleared AND queued in ONE transaction (requeueMeetingForReindex)
     *    so a crash can never orphan a meeting (cleared vectors but no queue rows).
     *    The durable embedding_queue + the pipeline's startup queue-flush is the
     *    resume mechanism.
     *  - Deferred ~15s so it doesn't compete with cold-start UI/STT.
     *  - Paused while a live meeting indexes (live > backfill), but the pause is
     *    CAPPED so a back-to-back-meetings session can't strand the in-flight flag
     *    or leave the progress toast spinning forever; it bails and retries next launch.
     *  - Idempotent: a second call (auto or manual) while one is in flight is a no-op.
     *  - Search during re-index is empty-not-wrong: a cleared, not-yet-re-embedded
     *    meeting has NULL space and is excluded by the space-filtered search.
     */
    private _reindexInFlight = false;
    private _autoReindexTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly AUTO_REINDEX_DEFER_MS = 15_000;
    private static readonly REINDEX_LIVE_RECHECK_MS = 30_000;
    private static readonly REINDEX_MAX_LIVE_WAITS = 20; // ~10 min cap, then bail + retry next launch
    private static readonly REINDEX_DRAIN_POLL_MS = 2_000;
    private static readonly REINDEX_MAX_DRAIN_POLLS = 900; // ~30 min cap on progress polling

    scheduleAutoReindex(): void {
        const activeSpace = this.embeddingPipeline.getActiveSpaceKey();
        if (!activeSpace) return;
        if (this.vectorStore.getIncompatibleSpaceCount(activeSpace) === 0) return;
        // Defer the kickoff so launch isn't slowed; _runReindex owns the in-flight guard.
        // Track the timer so a re-init (settings change) doesn't stack duplicate timers
        // and so it can be cancelled on teardown.
        if (this._autoReindexTimer) clearTimeout(this._autoReindexTimer);
        this._autoReindexTimer = setTimeout(() => {
            this._autoReindexTimer = null;
            this._runReindex().catch(err => {
                console.error('[RAGManager] Auto-reindex failed (will retry next launch):', err);
            });
        }, RAGManager.AUTO_REINDEX_DEFER_MS);
    }

    /** Cancel any pending deferred auto-reindex (call on teardown/quit). */
    cancelPendingReindex(): void {
        if (this._autoReindexTimer) {
            clearTimeout(this._autoReindexTimer);
            this._autoReindexTimer = null;
        }
    }

    /**
     * Teardown hook for app shutdown: cancels the deferred auto-reindex timer (which
     * could otherwise fire up to ~15s — or the ~30min drain poll — after quit) and
     * terminates the VectorStore worker thread. Call from the before-quit handler.
     */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.cancelPendingReindex();
        for (const timer of this.meetingReindexTimers.values()) clearTimeout(timer);
        this.meetingReindexTimers.clear();
        this.pendingLiveSegments = [];
        this.liveIndexer.dispose();
        this.embeddingPipeline.dispose();
        try { await this.vectorStore.destroy(); } catch (e) {
            console.warn('[RAGManager] dispose: vectorStore.destroy failed (non-fatal):', e);
        }
    }

    /** Shared guarded re-index routine for both the auto and manual paths. */
    private async _runReindex(): Promise<void> {
        if (this.disposed) return;
        if (this._reindexInFlight) {
            console.log('[RAGManager] Re-index already in flight — skipping duplicate trigger.');
            return;
        }
        const activeSpace = this.embeddingPipeline.getActiveSpaceKey();
        if (!activeSpace) {
            console.error('[RAGManager] Cannot re-index: no active embedding provider.');
            return;
        }
        const count = this.vectorStore.getIncompatibleSpaceCount(activeSpace);
        if (count === 0) {
            console.log('[RAGManager] No incompatible meetings to re-index.');
            return;
        }

        this._reindexInFlight = true;
        this._emitReindex('embedding:reindex-started', { count, space: activeSpace });
        console.log(`[RAGManager] Re-indexing ${count} meeting(s) into space ${activeSpace}...`);

        try {
            // ── Phase 1: requeue ── snapshot the worklist; clear+queue each meeting atomically.
            const meetingIds = this.vectorStore.getMeetingIdsNeedingReindex(activeSpace);
            const total = meetingIds.length;

            for (const meetingId of meetingIds) {
                // Pause (capped) if a live meeting is indexing — live work has priority.
                let waits = 0;
                while (this.liveIndexer.isRunning()) {
                    if (waits >= RAGManager.REINDEX_MAX_LIVE_WAITS) {
                        console.warn(`[RAGManager] Re-index pausing exceeded cap (${RAGManager.REINDEX_MAX_LIVE_WAITS} waits) due to continuous live meetings. Bailing; will resume next launch.`);
                        // Bail cleanly so the toast resolves; the count-based trigger
                        // re-fires next launch for whatever remains.
                        this._emitReindex('embedding:reindex-complete', { total, space: activeSpace, partial: true });
                        return;
                    }
                    waits++;
                    await new Promise(r => setTimeout(r, RAGManager.REINDEX_LIVE_RECHECK_MS));
                    if (this.disposed) return;
                }
                // Atomic clear + enqueue (crash-safe — see requeueMeetingForReindex).
                await this.embeddingPipeline.requeueMeetingForReindex(meetingId);
                if (this.disposed) return;
            }

            console.log(`[RAGManager] Re-index: requeued ${total} meeting(s). Awaiting background embedding...`);

            // ── Phase 2: await actual embedding ── the requeue above only QUEUED the work;
            // the meetings have NULL embeddings (excluded from search) until the background
            // processQueue drains. Report TRUE progress off the queue depth so the UI doesn't
            // claim "complete" while past meetings are still unsearchable.
            const initialPending = this.embeddingPipeline.getQueueStatus().pending;
            let polls = 0;
            while (polls < RAGManager.REINDEX_MAX_DRAIN_POLLS) {
                const { pending } = this.embeddingPipeline.getQueueStatus();
                const doneItems = Math.max(0, initialPending - pending);
                this._emitReindex('embedding:reindex-progress', { done: doneItems, total: initialPending, space: activeSpace });
                if (pending === 0) break;
                polls++;
                await new Promise(r => setTimeout(r, RAGManager.REINDEX_DRAIN_POLL_MS));
                if (this.disposed) return;
            }

            const stillPending = this.embeddingPipeline.getQueueStatus().pending;
            // Complete = queue fully drained. If we hit the poll cap with work left
            // (very large corpus / slow API), report partial — it keeps draining in the
            // background and the count-based trigger re-verifies next launch.
            this._emitReindex('embedding:reindex-complete', {
                total,
                space: activeSpace,
                partial: stillPending > 0,
            });
            console.log(`[RAGManager] Re-index ${stillPending > 0 ? 'partially ' : ''}complete (${stillPending} queue item(s) still pending).`);
        } finally {
            this._reindexInFlight = false;
        }
    }

    private _emitReindex(channel: string, payload: Record<string, unknown>): void {
        try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach((win: any) => {
                if (!win.isDestroyed()) win.webContents.send(channel, payload);
            });
        } catch (_) { /* non-fatal — renderer may not be up yet */ }
    }
}
