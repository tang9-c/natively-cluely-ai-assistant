import { speakerIdentityPromptLabel } from '../../shared/speakerIdentity';
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

/** Update only explicitly linked raw units; preserve their text and capture source. */
export function applyLiveSpeakerIdentity(segments: RawSegment[], target: RawSegment): boolean {
    const ids = new Set([target.segmentId, ...(target.rawSegmentIds ?? [])].filter(Boolean));
    let changed = false;
    segments.forEach((segment, index) => {
        if (![segment.segmentId, ...(segment.rawSegmentIds ?? [])].some(id => id && ids.has(id))) return;
        const updated = { ...segment, speakerIdentityCorrection: target.speakerIdentityCorrection,
            rawSegmentIds: target.rawSegmentIds, coalescedFromCount: target.coalescedFromCount };
        changed ||= speakerIdentityPromptLabel(segment) !== speakerIdentityPromptLabel(updated);
        segments[index] = updated;
    });
    return changed;
}

export class LiveRAGIndexer {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private meetingId: string | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private allSegments: RawSegment[] = [];
    // Text-only source units let corrections rebuild derived chunks after a tick released its pending prefix.
    private acceptedSegments: RawSegment[] = [];
    private identityRevision = 0;
    private identityRebuildPending = false;
    private chunkCounter = 0;         // Running chunk index
    private indexedChunkCount = 0;    // Total chunks with embeddings
    private processingPromise: Promise<boolean> | null = null;
    private stoppingPromise: Promise<void> | null = null;
    private isActive = false;
    private disposed = false;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Start live indexing for a meeting.
     * Begins a background timer that periodically chunks & embeds new transcript.
     */
    async start(meetingId: string): Promise<void> {
        if (this.disposed) return;
        if (this.isActive || this.stoppingPromise) {
            await this.stop();
        }
        if (this.disposed) return;

        this.meetingId = meetingId;
        this.allSegments = [];
        this.acceptedSegments = [];
        this.identityRevision++;
        this.identityRebuildPending = false;
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
     * Stable raw IDs preserve the link to canonical identity corrections.
     */
    feedSegments(segments: RawSegment[]): void {
        if (!this.isActive || !this.meetingId) return;
        const copies = segments.map(segment => ({ ...segment }));
        this.acceptedSegments.push(...copies);
        this.allSegments.push(...copies);
    }

    correctSpeakerIdentity(segment: RawSegment): void {
        if (!this.isActive || !this.meetingId) return;
        const changed = applyLiveSpeakerIdentity(this.acceptedSegments, segment);
        applyLiveSpeakerIdentity(this.allSegments, segment);
        if (!changed && !this.identityRebuildPending) return;
        this.identityRevision++;
        this.identityRebuildPending = true;
        this.allSegments = this.acceptedSegments.slice();
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        // Invalidate synchronously, before a concurrent query can consume the previous labels.
        this.vectorStore.deleteChunksForMeeting(this.meetingId);
        void (this.processingPromise ?? Promise.resolve()).then(() => this.tick(true)).catch(() => {
            // Remain unavailable until a later tick can rebuild; stale evidence must not be reused.
        });
    }

    getIdentityRevision(): number { return this.identityRevision; }
    hasCurrentIdentity(): boolean { return !this.identityRebuildPending; }

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
        const identityRevision = this.identityRevision;
        let batchProcessed = false;

        try {
            if (this.identityRebuildPending) this.vectorStore.deleteChunksForMeeting(meetingId);
            // 1. Snapshot the current prefix. Segments appended while awaiting
            // embeddings stay beyond batchEnd and are handled by the next tick.
            const newSegments = this.allSegments.slice(0, batchEnd);

            // 2. Preprocess
            const cleaned = preprocessTranscript(newSegments);
            if (cleaned.length === 0) {
                batchProcessed = true;
                this.identityRebuildPending = false;
                return true;
            }

            // 3. Chunk with offset index
            const chunks = chunkTranscript(meetingId, cleaned);
            if (chunks.length === 0) {
                batchProcessed = true;
                this.identityRebuildPending = false;
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
            this.identityRebuildPending = false;

            console.log(`[LiveRAGIndexer] Saved ${indexedChunks.length} chunks (${this.chunkCounter} total) for meeting ${meetingId}`);

            // 5. Embed each chunk (fire-and-forget per chunk, but sequential to avoid rate limits)
            if (this.embeddingPipeline.isReady()) {
                let embeddedCount = 0;
                for (let i = 0; i < chunkIds.length; i++) {
                    try {
                        if (this.disposed || identityRevision !== this.identityRevision) return false;
                        const embedding = await this.embeddingPipeline.getEmbedding(indexedChunks[i].text);
                        if (this.disposed || identityRevision !== this.identityRevision) return false;
                        this.vectorStore.storeEmbedding(chunkIds[i], embedding);
                        embeddedCount++;
                    } catch (err) {
                        if (this.disposed || identityRevision !== this.identityRevision) return false;
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
            if (batchProcessed && identityRevision === this.identityRevision) {
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
        this.acceptedSegments = [];
        this.identityRevision++;
        this.identityRebuildPending = false;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.processingPromise = null;

        console.log(`[LiveRAGIndexer] Stopped for meeting ${meetingId}`);
    }

    /** Quit discards derived work; the durable transcript can rebuild it later. */
    dispose(): void {
        this.disposed = true;
        this.isActive = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.meetingId = null;
        this.allSegments = [];
        this.acceptedSegments = [];
        this.identityRevision++;
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
