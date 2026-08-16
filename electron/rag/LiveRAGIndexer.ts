// electron/rag/LiveRAGIndexer.ts
// JIT RAG: Incrementally indexes transcript during a live meeting.
//
// Architecture:
// - Background timer (30s) chunks & embeds NEW transcript segments
// - Embedding is fire-and-forget — never blocks the query path
// - At query time, VectorStore already has indexed chunks for fast search
// - Falls back gracefully if embedding API unavailable

import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript, Chunk } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';

const INDEXING_INTERVAL_MS = 30_000;  // 30 seconds
const MIN_NEW_SEGMENTS = 3;           // Don't chunk unless we have enough new content

export class LiveRAGIndexer {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private meetingId: string | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private allSegments: RawSegment[] = [];
    private chunkCounter = 0;         // Running chunk index
    private indexedChunkCount = 0;    // Total chunks with embeddings
    private processingPromise: Promise<boolean> | null = null;
    private stoppingPromise: Promise<void> | null = null;
    private isActive = false;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Start live indexing for a meeting.
     * Begins a background timer that periodically chunks & embeds new transcript.
     */
    async start(meetingId: string): Promise<void> {
        if (this.isActive || this.stoppingPromise) {
            await this.stop();
        }

        this.meetingId = meetingId;
        this.allSegments = [];
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.processingPromise = null;
        this.isActive = true;

        console.log(`[LiveRAGIndexer] Started for meeting ${meetingId}`);

        this.timer = setInterval(() => {
            this.tick().catch(err => {
                console.error('[LiveRAGIndexer] Tick error:', err);
            });
        }, INDEXING_INTERVAL_MS);
    }

    /**
     * Feed new transcript segments from the live meeting.
     * Called by SessionTracker whenever new transcript arrives.
     * This is append-only — segments are never modified after being fed.
     */
    feedSegments(segments: RawSegment[]): void {
        if (!this.isActive || !this.meetingId) return;
        this.allSegments.push(...segments);
    }

    /**
     * Core indexing tick — processes only NEW segments since last tick.
     * 
     * Flow:
     * 1. Snapshot the pending segment prefix
     * 2. Preprocess (clean, merge speakers)
     * 3. Chunk (semantic boundaries, 200-400 tokens)
     * 4. Save chunks to VectorStore
     * 5. Embed each chunk via Gemini API
     * 6. Release the successfully processed prefix
     */
    private async tick(force = false): Promise<boolean> {
        if (!this.isActive || !this.meetingId) return false;
        if (this.processingPromise) {
            return this.processingPromise;
        }

        const processingPromise = this.processTick(force);
        this.processingPromise = processingPromise;
        try {
            return await processingPromise;
        } finally {
            if (this.processingPromise === processingPromise) {
                this.processingPromise = null;
            }
        }
    }

    private async processTick(force: boolean): Promise<boolean> {
        if (!this.isActive || !this.meetingId) return false;

        const batchEnd = this.allSegments.length;
        if (batchEnd === 0 || (!force && batchEnd < MIN_NEW_SEGMENTS)) return false;

        const meetingId = this.meetingId;
        let batchProcessed = false;

        try {
            // 1. Snapshot the current prefix. Segments appended while awaiting
            // embeddings stay beyond batchEnd and are handled by the next tick.
            const newSegments = this.allSegments.slice(0, batchEnd);

            // 2. Preprocess
            const cleaned = preprocessTranscript(newSegments);
            if (cleaned.length === 0) {
                batchProcessed = true;
                return true;
            }

            // 3. Chunk with offset index
            const chunks = chunkTranscript(meetingId, cleaned);
            if (chunks.length === 0) {
                batchProcessed = true;
                return true;
            }

            // Re-index chunks to continue from where we left off
            const indexedChunks: Chunk[] = chunks.map((chunk, i) => ({
                ...chunk,
                chunkIndex: this.chunkCounter + i,
            }));

            // 4. Save chunks to DB (without embeddings initially)
            const chunkIds = this.vectorStore.saveChunks(indexedChunks);
            this.chunkCounter += indexedChunks.length;
            batchProcessed = true;

            console.log(`[LiveRAGIndexer] Saved ${indexedChunks.length} chunks (${this.chunkCounter} total) for meeting ${meetingId}`);

            // 5. Embed each chunk (fire-and-forget per chunk, but sequential to avoid rate limits)
            if (this.embeddingPipeline.isReady()) {
                let embeddedCount = 0;
                for (let i = 0; i < chunkIds.length; i++) {
                    try {
                        const embedding = await this.embeddingPipeline.getEmbedding(indexedChunks[i].text);
                        this.vectorStore.storeEmbedding(chunkIds[i], embedding);
                        embeddedCount++;
                    } catch (err) {
                        console.warn(`[LiveRAGIndexer] Failed to embed chunk ${chunkIds[i]}:`, err);
                        // Continue with remaining chunks — partial indexing is better than none
                    }
                }
                this.indexedChunkCount += embeddedCount;
                console.log(`[LiveRAGIndexer] Embedded ${embeddedCount}/${chunkIds.length} chunks (${this.indexedChunkCount} total with embeddings)`);

                // Stamp the meeting's embedding space so these live chunks are (a) searchable
                // in-session (search filters on embedding_space) and (b) NOT swept into the
                // "unknown-space" re-index. Only stamps if currently NULL.
                if (embeddedCount > 0) {
                    const providerName = this.embeddingPipeline.getActiveProviderName();
                    const space = this.embeddingPipeline.getActiveSpaceKey();
                    const dims = this.embeddingPipeline.getActiveDimensions();
                    if (providerName && space && dims) {
                        this.vectorStore.stampMeetingSpaceIfUnset(meetingId, providerName, dims, space);
                    }
                }
            } else {
                console.log('[LiveRAGIndexer] Embedding pipeline not ready, chunks saved without embeddings');
            }

            return true;
        } catch (err) {
            console.error('[LiveRAGIndexer] Processing error:', err);
            return false;
        } finally {
            if (batchProcessed) {
                this.allSegments.splice(0, batchEnd);
            }
        }
    }

    /**
     * Stop live indexing. Flushes any remaining segments.
     */
    async stop(): Promise<void> {
        if (this.stoppingPromise) {
            return this.stoppingPromise;
        }
        if (!this.isActive) return;

        const stoppingPromise = this.performStop();
        this.stoppingPromise = stoppingPromise;
        try {
            await stoppingPromise;
        } finally {
            if (this.stoppingPromise === stoppingPromise) {
                this.stoppingPromise = null;
            }
        }
    }

    private async performStop(): Promise<void> {
        if (!this.isActive) return;

        console.log(`[LiveRAGIndexer] Stopping for meeting ${this.meetingId}`);

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Wait for the current batch, then force-flush any tail that arrived
        // during it even when it is below the periodic threshold.
        const inFlight = this.processingPromise;
        if (inFlight) {
            await inFlight;
            if (this.processingPromise === inFlight) {
                this.processingPromise = null;
            }
        }
        while (this.allSegments.length > 0) {
            const madeProgress = await this.tick(true);
            if (!madeProgress) {
                console.warn('[LiveRAGIndexer] Final flush made no progress; deferring to post-meeting indexing.');
                break;
            }
        }

        const meetingId = this.meetingId;
        this.isActive = false;
        this.meetingId = null;
        this.allSegments = [];
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.processingPromise = null;

        console.log(`[LiveRAGIndexer] Stopped for meeting ${meetingId}`);
    }

    /**
     * Check if there are any queryable JIT chunks for the current meeting.
     */
    hasIndexedChunks(): boolean {
        return this.indexedChunkCount > 0;
    }

    /**
     * Get the number of chunks with embeddings (queryable).
     */
    getIndexedChunkCount(): number {
        return this.indexedChunkCount;
    }

    /**
     * Get the meeting ID currently being indexed.
     */
    getActiveMeetingId(): string | null {
        return this.meetingId;
    }

    /**
     * Check if actively indexing.
     */
    isRunning(): boolean {
        return this.isActive;
    }
}
