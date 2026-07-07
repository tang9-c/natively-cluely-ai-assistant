
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';
import * as crypto from 'crypto';
import * as sqliteVec from 'sqlite-vec';
import { buildLegacySpaceCaseSql } from '../rag/embeddingSpace';
import {
    DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE,
    type IntentKeywordConfig,
} from '../llm/IntentKeywordDefaults';
import { DEFAULT_MODE_CUSTOM_CONTEXT_BY_TEMPLATE } from '../services/ModeDefaultContexts';
import type { ResumeNode, UserProfileRecord } from '../services/profile/types';
import type { SpeakerVerificationMetadata } from '../services/speaker/speakerVerificationTypes';

// Interfaces for our data objects
export interface CompanyResearchCacheRow {
    dossier_json: string;
    expires_at: string;
    schema_version: string;
}

export interface Meeting {
    id: string;
    title: string;
    date: string; // ISO string
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
        schemaVersion?: number;
        actionItemsStructured?: Array<{ id: string; text: string; owner?: string; deadline?: string; sourceTimestamp?: number }>;
        followUpDraft?: string;
        coachingInsights?: Array<{ id: string; type: string; title: string; detail: string; severity: 'info' | 'opportunity' | 'warning'; evidence?: string }>;
    };
    transcript?: Array<{
        speaker: string;
        speakerId?: string;
        speakerLabel?: string;
        providerSpeakerId?: string;
        diarizationProvider?: 'doubao-auc';
        text: string;
        timestamp: number;
        startTimestampMs?: number;
        endTimestampMs?: number;
        speakerVerification?: SpeakerVerificationMetadata;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    calendarEventId?: string;
    source?: 'manual' | 'calendar';
    isProcessed?: boolean;
}

export type AnswerQualityEventType = 'shown' | 'copied' | 'accepted' | 'ignored' | 'regenerated';

export type AnswerDegradedReason =
    | 'transcript_truncated'
    | 'assistant_history_truncated'
    | 'assistant_history_dropped'
    | 'meeting_history_truncated'
    | 'meeting_history_dropped'
    | 'uploaded_material_context_truncated'
    | 'uploaded_material_context_dropped'
    | 'uploaded_material_rag_failed'
    | 'no_relevant_uploaded_material'
    | 'business_system_context_dropped'
    | 'business_system_not_configured'
    | 'business_system_unavailable'
    | 'business_system_error'
    | 'business_system_auth_failed'
    | 'business_system_timeout'
    | 'business_system_no_result'
    | 'business_system_ambiguous'
    | 'business_system_missing_query_anchor'
    | 'business_system_unsupported_operation'
    | 'screen_context_failed'
    | 'screen_context_scope_blocked'
    | 'screen_context_no_vision_provider'
    | 'screen_context_truncated'
    | 'screen_context_dropped'
    | 'mode_context_truncated'
    | 'mode_context_dropped'
    | 'rag_unavailable'
    | 'embedding_unavailable'
    | 'speaker_separation_unavailable'
    | 'speaker_metadata_low_confidence'
    | 'speaker_metadata_unavailable'
    | 'stt_user_failed'
    | 'stt_interviewer_failed'
    | 'context_scope_denied'
    | 'duplicate_context_dropped';

export interface AnswerContextUsed {
    currentTranscript: boolean;
    shortTermHistory: boolean;
    uploadedDocumentRag: boolean;
    historicalMeetings: boolean;
    longTermMemory: boolean;
    enterpriseKnowledge: boolean;
    businessSystemContext: boolean;
    screenContext: boolean;
}

export interface AnswerSourceStatus {
    ragAttempted: boolean;
    ragReady: boolean;
    embeddingReady: boolean;
    uploadedMaterialHitCount: number;
    citationCount: number;
    screenContextStatus: 'not_available' | 'available' | 'failed';
    businessSystemStatus?: 'not_requested' | 'available' | 'not_configured' | 'missing_query_anchor' | 'auth_failed' | 'timeout' | 'no_result' | 'ambiguous' | 'unsupported_operation' | 'unavailable' | 'error';
    businessSystemSourceName?: string;
    sttUserStatus?: 'connected' | 'reconnecting' | 'failed';
    sttInterviewerStatus?: 'connected' | 'reconnecting' | 'failed';
    speakerSeparationStatus?: 'off' | 'on' | 'unavailable';
}

export interface AnswerCitationRecord {
    citationId?: string;
    sourceType: 'current_meeting' | 'historical_meeting' | 'uploaded_material' | 'long_term_memory' | 'enterprise_knowledge' | 'screen_context';
    sourceId: string;
    sourceVersion?: string;
    chunkId?: string | number | null;
    chunkContentHash?: string;
    sourceFileHash?: string | null;
    startOffset?: number | null;
    endOffset?: number | null;
    score?: number | null;
    title?: string | null;
    timestamp?: number | string | null;
}

export interface AnswerContextTraceInput {
    answerId: string;
    meetingId?: string | null;
    interactionId?: number | null;
    answerType?: string;
    surface?: string;
    provider?: string | null;
    model?: string | null;
    latencyMs?: number | null;
    contextUsed: AnswerContextUsed;
    sourceStatus: AnswerSourceStatus;
    citations?: AnswerCitationRecord[];
    degradedReason?: string | null;
    status?: string;
    traceId?: string;
    observability?: Record<string, unknown>;
}

export interface AnswerQualityMetrics {
    shownCount: number;
    copiedCount: number;
    acceptedCount: number;
    ignoredCount: number;
    regeneratedCount: number;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
    citationHitRate: number;
    userAcceptanceRate: number;
    regenerationRate: number;
    ragHitRate: number;
    noContextAnswerRate: number;
}

export interface RealtimeDiagnosticsAggregate {
    metrics: AnswerQualityMetrics;
    degradedReasons: Record<string, number>;
    sourceStatusCounts: Record<string, number>;
    traceSampleSize: number;
    eventSampleSize: number;
}

export interface KnowledgeMaterialInput {
    id: string;
    fileName: string;
    title?: string | null;
    mimeOrExt: string;
    fileHash: string;
    status?: 'queued' | 'indexing' | 'complete' | 'failed' | 'deleted';
    errorCode?: string | null;
    errorMessage?: string | null;
}

export interface KnowledgeMaterialChunkInput {
    materialId: string;
    chunkIndex: number;
    parentChunkIndex?: number | null;
    cleanedText: string;
    parentText?: string | null;
    tokenCount: number;
    embedding?: number[] | null;
    metadata?: Record<string, unknown>;
}

function cryptoRandomId(): string {
    return crypto.randomBytes(8).toString('hex');
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

function normalizeAnswerContextUsed(input?: Partial<AnswerContextUsed> | null): AnswerContextUsed {
    return {
        currentTranscript: Boolean(input?.currentTranscript),
        shortTermHistory: Boolean(input?.shortTermHistory),
        uploadedDocumentRag: Boolean(input?.uploadedDocumentRag),
        historicalMeetings: Boolean(input?.historicalMeetings),
        longTermMemory: Boolean(input?.longTermMemory),
        enterpriseKnowledge: Boolean(input?.enterpriseKnowledge),
        businessSystemContext: Boolean(input?.businessSystemContext),
        screenContext: Boolean(input?.screenContext),
    };
}

function normalizeStatusValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? value as T : fallback;
}

function normalizeAnswerSourceStatus(input?: Partial<AnswerSourceStatus> | null): AnswerSourceStatus {
    return {
        ragAttempted: Boolean(input?.ragAttempted),
        ragReady: Boolean(input?.ragReady),
        embeddingReady: Boolean(input?.embeddingReady),
        uploadedMaterialHitCount: Number.isFinite(input?.uploadedMaterialHitCount) ? Number(input?.uploadedMaterialHitCount) : 0,
        citationCount: Number.isFinite(input?.citationCount) ? Number(input?.citationCount) : 0,
        screenContextStatus: normalizeStatusValue(input?.screenContextStatus, ['not_available', 'available', 'failed'] as const, 'not_available'),
        businessSystemStatus: input?.businessSystemStatus
            ? normalizeStatusValue(input.businessSystemStatus, ['not_requested', 'available', 'not_configured', 'missing_query_anchor', 'auth_failed', 'timeout', 'no_result', 'ambiguous', 'unsupported_operation', 'unavailable', 'error'] as const, 'not_requested')
            : undefined,
        businessSystemSourceName: typeof input?.businessSystemSourceName === 'string' ? input.businessSystemSourceName : undefined,
        sttUserStatus: input?.sttUserStatus
            ? normalizeStatusValue(input.sttUserStatus, ['connected', 'reconnecting', 'failed'] as const, 'failed')
            : undefined,
        sttInterviewerStatus: input?.sttInterviewerStatus
            ? normalizeStatusValue(input.sttInterviewerStatus, ['connected', 'reconnecting', 'failed'] as const, 'failed')
            : undefined,
        speakerSeparationStatus: input?.speakerSeparationStatus
            ? normalizeStatusValue(input.speakerSeparationStatus, ['off', 'on', 'unavailable'] as const, 'unavailable')
            : undefined,
    };
}

const KNOWN_DEGRADED_REASONS = new Set<string>([
    'transcript_truncated',
    'assistant_history_truncated',
    'assistant_history_dropped',
    'meeting_history_truncated',
    'meeting_history_dropped',
    'uploaded_material_context_truncated',
    'uploaded_material_context_dropped',
    'uploaded_material_rag_failed',
    'no_relevant_uploaded_material',
    'business_system_context_dropped',
    'business_system_not_configured',
    'business_system_unavailable',
    'business_system_error',
    'business_system_auth_failed',
    'business_system_timeout',
    'business_system_no_result',
    'business_system_ambiguous',
    'business_system_missing_query_anchor',
    'business_system_unsupported_operation',
    'screen_context_failed',
    'screen_context_scope_blocked',
    'screen_context_no_vision_provider',
    'screen_context_truncated',
    'screen_context_dropped',
    'mode_context_truncated',
    'mode_context_dropped',
    'rag_unavailable',
    'embedding_unavailable',
    'speaker_separation_unavailable',
    'speaker_metadata_low_confidence',
    'speaker_metadata_unavailable',
    'stt_user_failed',
    'stt_interviewer_failed',
    'context_scope_denied',
    'duplicate_context_dropped',
]);

function incrementCount(counts: Record<string, number>, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1;
}

function countKnownDegradedReason(counts: Record<string, number>, reason?: string | null): void {
    if (!reason) return;
    incrementCount(counts, KNOWN_DEGRADED_REASONS.has(reason) ? reason : 'unknown_degraded_reason');
}

function countAnswerSourceStatus(counts: Record<string, number>, sourceStatus: AnswerSourceStatus, citationCount: number): void {
    if (!sourceStatus.ragAttempted) {
        incrementCount(counts, 'rag.not_attempted');
    } else if (sourceStatus.uploadedMaterialHitCount > 0) {
        incrementCount(counts, 'rag.hit');
    } else if (sourceStatus.ragReady) {
        incrementCount(counts, 'rag.miss');
    } else {
        incrementCount(counts, 'rag.failed');
    }

    if (sourceStatus.embeddingReady) incrementCount(counts, 'embedding.ready');
    else incrementCount(counts, 'embedding.unavailable');

    const screenStatus = sourceStatus.screenContextStatus;
    if (screenStatus === 'available') incrementCount(counts, 'screen.available');
    else if (screenStatus === 'failed') incrementCount(counts, 'screen.failed');
    else incrementCount(counts, 'screen.not_used');

    const businessStatus = sourceStatus.businessSystemStatus ?? 'not_requested';
    if (businessStatus === 'available') incrementCount(counts, 'business_system.available');
    else if (businessStatus === 'no_result') incrementCount(counts, 'business_system.no_result');
    else if (businessStatus === 'auth_failed') incrementCount(counts, 'business_system.auth_failed');
    else if (businessStatus === 'timeout') incrementCount(counts, 'business_system.timeout');
    else if (businessStatus === 'unavailable') incrementCount(counts, 'business_system.unavailable');
    else if (businessStatus === 'error') incrementCount(counts, 'business_system.error');
    else incrementCount(counts, 'business_system.not_used');

    incrementCount(counts, citationCount > 0 ? 'citations.present' : 'citations.missing');
}

export class DatabaseManager {
    private static instance: DatabaseManager;
    private db: Database.Database | null = null;
    private dbPath: string;
    private resolvedExtPath: string = '';
    private initError: Error | null = null;

    private constructor() {
        const userDataPath = app.getPath('userData');
        this.dbPath = path.join(userDataPath, 'natively.db');
        // IMPORTANT: never throw out of the constructor. If init() throws and
        // escapes, `DatabaseManager.instance` is never assigned — so every
        // subsequent getInstance() call re-enters the constructor and re-emits
        // the identical failure (this is why a single dlopen error used to print
        // as a wall of ~dozens of identical stack traces across seed-demo,
        // get-recent-meetings, modes:get-active, etc.). Instead we capture the
        // error once and degrade to db: null; every public method already guards
        // with `if (!this.db)`, so callers get empty/null results, not throws.
        try {
            this.init();
        } catch (error) {
            this.initError = error as Error;
            this.reportInitFailure(error);
        }
    }

    public static getInstance(): DatabaseManager {
        if (!DatabaseManager.instance) {
            DatabaseManager.instance = new DatabaseManager();
        }
        return DatabaseManager.instance;
    }

    /** True when the underlying SQLite database opened successfully. */
    public isAvailable(): boolean {
        return this.db !== null;
    }

    /**
     * The error that caused initialization to fail, if any. Lets the app surface
     * a single user-facing banner (e.g. "Local database unavailable — meeting
     * history disabled") instead of relying on log scraping.
     */
    public getInitError(): Error | null {
        return this.initError;
    }

    /**
     * Task 4: expose better-sqlite3 transactions so callers (e.g.
     * ProfileDatabase.saveResumeToMaster) can wrap multi-step writes
     * atomically. Returns a no-op wrapper when the database failed to open,
     * matching the existing `if (!this.db) return null` pattern used
     * throughout this class — callers get "best effort" semantics and never
     * see a crash from a missing db.
     */
    public transaction<T extends (...args: any[]) => unknown>(fn: T): T {
        if (!this.db) {
            // db unavailable — best-effort: still run fn once, no rollback safety
            return ((...args: any[]) => fn(...args)) as unknown as T;
        }
        // better-sqlite3's transaction() returns the same callable wrapped in
        // a Transaction object, but the runtime shape is still T-compatible.
        return this.db.transaction(fn) as unknown as T;
    }

    /**
     * Translate an init failure into a single, actionable log line. The most
     * common fatal cause is a native-module architecture mismatch (an x86_64
     * better-sqlite3 binary loaded under the arm64 Electron runtime, typically
     * produced by an `npm install` that ran under a Rosetta shell).
     */
    private reportInitFailure(error: unknown): void {
        const err = error as NodeJS.ErrnoException;
        const msg = err?.message || String(error);
        const isArchMismatch =
            err?.code === 'ERR_DLOPEN_FAILED' ||
            /incompatible architecture|ERR_DLOPEN_FAILED|mach-o|was compiled against a different Node.js version|ABI|NODE_MODULE_VERSION/i.test(msg);

        if (isArchMismatch) {
            console.error(
                '[DatabaseManager] FATAL: native module (better-sqlite3) failed to load — the compiled ' +
                'binary does not match the Electron runtime (architecture or Node ABI mismatch). Local database is DISABLED ' +
                '(meeting history, modes, and notes will not persist this session).\n' +
                '  Fix: run `npm run rebuild:native`, then restart the app.'
            );
        } else {
            console.error(
                '[DatabaseManager] FATAL: database initialization failed. Local database is DISABLED ' +
                '(meeting history, modes, and notes will not persist this session).',
                error
            );
        }
    }

    private init() {
        try {
            console.log(`[DatabaseManager] Initializing database at ${this.dbPath}`);
            // Ensure directory exists (though userData usually does)
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[DatabaseManager] Created directory: ${dir}`);
            } else {
                console.log(`[DatabaseManager] Directory exists: ${dir}`);
                try {
                    const files = fs.readdirSync(dir);
                    console.log(`[DatabaseManager] Directory contents:`, files);
                    const dbExists = fs.existsSync(this.dbPath);
                    if (dbExists) {
                        const stats = fs.statSync(this.dbPath);
                        console.log(`[DatabaseManager] Found existing DB. Size: ${stats.size} bytes`);
                    } else {
                        console.log(`[DatabaseManager] No existing DB found at ${this.dbPath}. Creating new one.`);
                    }
                } catch (e) {
                    console.error('[DatabaseManager] Error checking directory/file:', e);
                }
            }

            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');

            // Load sqlite-vec extension for native vector search
            try {
                // 1. sqlite-vec's getLoadablePath() returns a path inside app.asar
                //    (e.g. .../app.asar/node_modules/sqlite-vec-darwin-arm64/vec0.dylib)
                //    but dlopen() needs real files on disk, not files inside the asar archive.
                //    electron-builder's asarUnpack puts them in app.asar.unpacked instead.
                // 2. better-sqlite3's loadExtension() auto-appends the platform extension
                //    (.dylib/.so/.dll), so we strip it to avoid vec0.dylib.dylib.
                let extPath = sqliteVec.getLoadablePath();
                extPath = extPath.replace('app.asar', 'app.asar.unpacked');
                extPath = extPath.replace(/\.(dylib|so|dll)$/, '');
                this.db.loadExtension(extPath);
                this.resolvedExtPath = extPath; // Store for worker thread access
                console.log('[DatabaseManager] sqlite-vec extension loaded successfully');
            } catch (extErr) {
                console.error('[DatabaseManager] Failed to load sqlite-vec extension:', extErr);
                console.warn('[DatabaseManager] Vector search will fall back to JS cosine similarity');
            }

            this.runMigrations();
        } catch (error) {
            console.error('[DatabaseManager] Failed to initialize database:', error);
            throw error;
        }
    }

    // ============================================
    // PRAGMA user_version Migration System
    // ============================================
    // Each version is applied exactly once, in order.
    // New migrations append a new `if (version < N)` block.
    // ============================================

    private runMigrations() {
        if (!this.db) return;

        const version = (this.db.pragma('user_version', { simple: true }) as number) || 0;
        console.log(`[DatabaseManager] Current schema version: ${version}`);

        // Version 0 → 1: Initial schema (all core tables)
        if (version < 1) {
            console.log('[DatabaseManager] Applying migration v0 → v1: Initial schema');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    start_time INTEGER,
                    duration_ms INTEGER,
                    summary_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    calendar_event_id TEXT,
                    source TEXT,
                    is_processed INTEGER DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS transcripts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    speaker TEXT,
                    speaker_id TEXT,
                    speaker_label TEXT,
                    provider_speaker_id TEXT,
                    diarization_provider TEXT,
                    content TEXT,
                    timestamp_ms INTEGER,
                    start_timestamp_ms INTEGER,
                    end_timestamp_ms INTEGER,
                    speaker_verification_json TEXT,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS ai_interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT,
                    type TEXT,
                    timestamp INTEGER,
                    user_query TEXT,
                    ai_response TEXT,
                    metadata_json TEXT,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    speaker TEXT,
                    start_timestamp_ms INTEGER,
                    end_timestamp_ms INTEGER,
                    cleaned_text TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    embedding BLOB,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS chunk_summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL UNIQUE,
                    summary_text TEXT NOT NULL,
                    embedding BLOB,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS embedding_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meeting_id TEXT NOT NULL,
                    chunk_id INTEGER,
                    status TEXT DEFAULT 'pending',
                    retry_count INTEGER DEFAULT 0,
                    error_message TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    processed_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON chunks(meeting_id);

                CREATE TABLE IF NOT EXISTS user_profile (
                    id INTEGER PRIMARY KEY,
                    structured_json TEXT NOT NULL,
                    compact_persona TEXT NOT NULL,
                    intro_short TEXT,
                    intro_interview TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS resume_nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT,
                    title TEXT,
                    organization TEXT,
                    start_date TEXT,
                    end_date TEXT,
                    duration_months INTEGER,
                    text_content TEXT,
                    tags TEXT,
                    embedding BLOB
                );
            `);
            this.db.pragma('user_version = 1');
        }

        // Version 1 → 2: Add columns for existing installs (safe for fresh installs too)
        if (version < 2) {
            console.log('[DatabaseManager] Applying migration v1 → v2: Add meetings columns');
            // For fresh installs these columns already exist from v1, so we guard with try/catch.
            // Unlike the old code, these are versioned and run exactly once.
            const columnsToAdd = [
                "ALTER TABLE meetings ADD COLUMN calendar_event_id TEXT",
                "ALTER TABLE meetings ADD COLUMN source TEXT",
                "ALTER TABLE meetings ADD COLUMN is_processed INTEGER DEFAULT 1"
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Column already exists from v1 CREATE */ }
            }
            this.db.pragma('user_version = 2');
        }

        // Version 2 → 3: sqlite-vec virtual tables for native vector search
        if (version < 3) {
            console.log('[DatabaseManager] Applying migration v2 → v3: vec0 virtual tables');
            try {
                // Create vec0 virtual table for chunk embeddings (dynamic dimension)
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                // Create vec0 virtual table for summary embeddings (dynamic dimension)
                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                // Migrate existing chunk embeddings from BLOB column to vec0 table
                this.migrateExistingEmbeddings();

                console.log('[DatabaseManager] vec0 virtual tables created successfully');
            } catch (e) {
                console.error('[DatabaseManager] vec0 migration failed (sqlite-vec may not be loaded):', e);
                console.warn('[DatabaseManager] VectorStore will fall back to JS cosine similarity');
            }
            this.db.pragma('user_version = 3');
        }

        // Version 3 → 4: Drop strict 768-dim vec0 tables to allow flexible embedding dimensions
        if (version < 4) {
            console.log('[DatabaseManager] Applying migration v3 → v4: Drop strict dimension vec0 tables');
            try {
                this.db.exec('DROP TABLE IF EXISTS vec_chunks;');
                this.db.exec('DROP TABLE IF EXISTS vec_summaries;');

                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                        chunk_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                this.db.exec(`
                    CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries USING vec0(
                        summary_id INTEGER PRIMARY KEY,
                        embedding float
                    );
                `);

                this.migrateExistingEmbeddings();
                console.log('[DatabaseManager] vec0 virtual tables recreated for flexible dimensions');
            } catch (e) {
                console.error('[DatabaseManager] vec0 migration v4 failed:', e);
            }
            this.db.pragma('user_version = 4');
        }

        // Version 4 → 5: Add embedding provider and dimensions columns
        if (version < 5) {
            console.log('[DatabaseManager] Applying migration v4 → v5: Add embedding provider/dimensions columns');
            const columnsToAdd = [
                "ALTER TABLE meetings ADD COLUMN embedding_provider TEXT",
                "ALTER TABLE meetings ADD COLUMN embedding_dimensions INTEGER"
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Column already exists */ }
            }
            this.db.pragma('user_version = 5');
        }

        // Version 5 → 6: Add app_state table for KV storage (Ollama pull state, etc)
        if (version < 6) {
            console.log('[DatabaseManager] Applying migration v5 → v6: Add app_state table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);
            this.db.pragma('user_version = 6');
        }

        // Version 6 → 7: Add indexes on transcripts and ai_interactions meeting_id
        // (Previously missing — causes O(N) full-table scans when fetching meeting details)
        if (version < 7) {
            console.log('[DatabaseManager] Applying migration v6 → v7: Add meeting_id indexes');
            try {
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);');
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_ai_interactions_meeting ON ai_interactions(meeting_id, timestamp);');
                console.log('[DatabaseManager] Meeting ID indexes created successfully');
            } catch (e) {
                console.error('[DatabaseManager] Failed to create indexes (non-fatal):', e);
            }
            this.db.pragma('user_version = 7');
        }

        // Version 7 → 8: Provision per-dimension vec0 tables (NOTE: this v8 ran in two broken
        // iterations for some users — first with float[1536] single table, then with correct per-dim
        // tables. The v9 migration below corrects any v8 that used the old broken schema.)
        if (version < 8) {
            console.log('[DatabaseManager] Applying migration v7 → v8: Provision per-dimension vec0 tables');
            // Drop the legacy single-dim tables from v3/v4 if they exist and are unusable
            try { this.db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
            try { this.db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

            for (const dim of DatabaseManager.KNOWN_DIMS) {
                this.ensureVecTableForDim(dim);
            }
            console.log('[DatabaseManager] v8 migration: per-dimension vec0 tables provisioned');
            this.db.pragma('user_version = 8');
        }

        // Version 8 → 9: Ensure per-dimension tables exist.
        // Required for DBs already at v8 but with the old broken float[1536] single-table schema,
        // or with the first incorrect v8 migration that didn't provision KNOWN_DIMS tables.
        if (version < 9) {
            console.log('[DatabaseManager] Applying migration v8 → v9: Ensure per-dimension vec0 tables exist');
            // Drop old single-dim orphan tables if they exist (float[1536] schema)
            try { this.db.exec('DROP TABLE IF EXISTS vec_chunks;'); } catch (_) {}
            try { this.db.exec('DROP TABLE IF EXISTS vec_summaries;'); } catch (_) {}

            let allOk = true;
            for (const dim of DatabaseManager.KNOWN_DIMS) {
                this.ensureVecTableForDim(dim);
                // Verify the table actually exists after provisioning
                try {
                    this.db.prepare(`SELECT count(*) FROM vec_chunks_${dim} LIMIT 1`).get();
                } catch (e) {
                    console.error(`[DatabaseManager] v9: vec_chunks_${dim} still missing after provisioning:`, e);
                    allOk = false;
                }
            }
            if (allOk) {
                console.log('[DatabaseManager] v9 migration: all per-dimension vec0 tables verified ✓');
            } else {
                console.warn('[DatabaseManager] v9 migration: some tables missing — sqlite-vec extension may not be loaded');
            }
            this.db.pragma('user_version = 9');
        }

        // Version 9 → 10: Add UNIQUE constraint on embedding_queue(meeting_id, chunk_id).
        // This enables INSERT OR IGNORE in EmbeddingPipeline.queueMeeting() to silently
        // skip duplicate rows when queueMeeting() is called more than once for the same meeting.
        // SQLite doesn't support ADD CONSTRAINT on existing tables, so we recreate the table
        // using the standard rename-create-copy-drop pattern.
        if (version < 10) {
            console.log('[DatabaseManager] Applying migration v9 → v10: Add UNIQUE constraint to embedding_queue');
            try {
                // Wrap all steps in an explicit better-sqlite3 transaction for atomicity.
                // If any step throws, the entire migration is rolled back cleanly —
                // preventing the dangerous half-renamed table state that a bare exec() chain would leave.
                const migrate = this.db.transaction(() => {
                    // Step 1: Rename the existing table to a temp name
                    this.db!.exec('ALTER TABLE embedding_queue RENAME TO embedding_queue_old;');

                    // Step 2: Recreate with the UNIQUE(meeting_id, chunk_id) constraint
                    this.db!.exec(`
                        CREATE TABLE embedding_queue (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            meeting_id TEXT NOT NULL,
                            chunk_id INTEGER,
                            status TEXT DEFAULT 'pending',
                            retry_count INTEGER DEFAULT 0,
                            error_message TEXT,
                            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                            processed_at TEXT,
                            UNIQUE(meeting_id, chunk_id)
                        );
                    `);

                    // Step 3: Copy rows; INSERT OR IGNORE silently drops any pre-existing duplicates
                    this.db!.exec(`
                        INSERT OR IGNORE INTO embedding_queue
                            (id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at)
                        SELECT id, meeting_id, chunk_id, status, retry_count, error_message, created_at, processed_at
                        FROM embedding_queue_old;
                    `);

                    // Step 4: Drop the backup
                    this.db!.exec('DROP TABLE embedding_queue_old;');
                });
                migrate();
                console.log('[DatabaseManager] v10 migration: embedding_queue UNIQUE constraint added ✓');
            } catch (e) {
                console.error('[DatabaseManager] v10 migration failed — table structure unchanged:', e);
                // user_version still advances. We do NOT retry — a failed rename leaves
                // embedding_queue_old behind; retrying would cause "table already exists".
                // In the failure case, INSERT OR IGNORE in queueMeeting() will still work
                // for natural uniqueness (same meeting queued twice picks up existing rows),
                // just without DB-enforced deduplication.
            }
            this.db.pragma('user_version = 10');
        }

        // Version 10 → 11: Add modes, mode_reference_files, and mode_note_sections tables
        if (version < 11) {
            console.log('[DatabaseManager] Applying migration v10 → v11: Add modes tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS modes (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    template_type TEXT NOT NULL DEFAULT 'general',
                    custom_context TEXT NOT NULL DEFAULT '',
                    is_active INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS mode_reference_files (
                    id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS mode_note_sections (
                    id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );
            `);
            // Seed a default "General" mode as active
            const defaultModeId = 'mode_general_default';
            this.db.prepare(`
                INSERT OR IGNORE INTO modes (id, name, template_type, custom_context, is_active)
                VALUES (?, ?, ?, ?, 1)
            `).run(defaultModeId, 'General', 'general', '');
            this.db.pragma('user_version = 11');
        }

        // Version 11 → 12: Seed note sections for the default General mode if missing
        if (version < 12) {
            console.log('[DatabaseManager] Applying migration v11 → v12: Seed default General mode note sections');
            const defaultModeId = 'mode_general_default';
            const modeExists = this.db.prepare('SELECT id FROM modes WHERE id = ?').get(defaultModeId);
            const existing = modeExists
                ? this.db.prepare('SELECT id FROM mode_note_sections WHERE mode_id = ?').get(defaultModeId)
                : null;
            if (modeExists && !existing) {
                const defaultSections = [
                    { title: '摘要',      description: '对话的高级摘要。' },
                    { title: '行动项', description: '识别出的任务和后续跟进。' },
                    { title: '要点',   description: '讨论中的重要观点。' },
                ];
                const insertSection = this.db.prepare(
                    'INSERT OR IGNORE INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
                );
                defaultSections.forEach((s, i) => {
                    insertSection.run(`ns_general_${i}`, defaultModeId, s.title, s.description, i);
                });
            }
            this.db.pragma('user_version = 12');
        }

        // Version 12 → 13: Backfill note sections for any mode instance that has none
        if (version < 13) {
            console.log('[DatabaseManager] Applying migration v12 → v13: Backfill missing mode note sections');
            const BACKFILL_SECTIONS: Record<string, Array<{ title: string; description: string }>> = {
                general: [
                    { title: '摘要',      description: '对话的高级摘要。' },
                    { title: '行动项', description: '识别出的任务和后续跟进。' },
                    { title: '要点',   description: '讨论中的重要观点。' },
                ],
                'looking-for-work': [
                    { title: '后续行动',       description: '下一步面试安排，或我承诺会发送的额外材料。' },
                    { title: '概览',                description: '面试、公司和整体流程的概览。' },
                    { title: '问题与回答',  description: '面试中问到的所有问题以及我给出的回答。' },
                    { title: '改进空间',        description: '我在面试中可以做得更好的地方。' },
                    { title: '岗位细节',            description: '关于职位、薪资期望等讨论到的任何内容。' },
                ],
                sales: [
                    { title: '行动项',         description: '我在会议后需要完成的所有行动项。' },
                    { title: '结果',              description: '是否成交以及对话的结果。' },
                    { title: '客户背景',   description: '我向其销售的对象的背景信息。' },
                    { title: '需求发现',             description: '客户在需求发现阶段说了什么。' },
                    { title: '产品',             description: '我是如何介绍产品的，以及客户的反应。' },
                    { title: '异议',             description: '客户提出的任何异议。' },
                ],
                recruiting: [
                    { title: '行动项',          description: '我在会议后必须完成的所有行动项。' },
                    { title: '经验与技能',  description: '讨论到的候选人的先前工作经验和技能。' },
                    { title: '回答质量',   description: '如果有提问，候选人每个问题回答得有多好、多准确。' },
                    { title: '对公司的兴趣',    description: '候选人对其公司兴趣的描述。' },
                    { title: '岗位期望',      description: '关于职位、薪资期望等讨论到的任何内容。' },
                ],
                'team-meet': [
                    { title: '行动项',           description: '我在会议后需要完成的所有行动项。' },
                    { title: '公告',           description: '会议中的任何团队公告。' },
                    { title: '团队更新',            description: '每位团队成员的进展、成果和当前重点。' },
                    { title: '挑战或阻塞',  description: '任何可能影响进展的问题或障碍。' },
                    { title: '已做决策',         description: '会议中达成的关键决策或共识。' },
                ],
                lecture: [
                    { title: '后续作业',  description: '课后阅读、作业或需要完成的任务。' },
                    { title: '主题',           description: '讲座的主要科目或主题。' },
                    { title: '核心概念',    description: '涵盖的核心思想或框架。' },
                    { title: '内容',           description: '讲座的全部内容，用非常详细的要点笔记记录。' },
                ],
                'technical-interview': [
                    { title: '覆盖的问题',  description: '每个被问到的问题、使用的方法和结果。' },
                    { title: '考察的概念',   description: '涉及的关键算法、数据结构或系统设计概念。' },
                    { title: '表现出色之处',    description: '哪些方法或解释效果不错。' },
                    { title: '待学习领域',    description: '识别出的需要更多准备的主题或知识缺口。' },
                    { title: '行动项',      description: '后续步骤——例如发送代码、学习特定主题、等待下一轮。' },
                ],
            };

            const allModes = this.db.prepare('SELECT id, template_type FROM modes').all() as Array<{ id: string; template_type: string }>;
            const insertSection = this.db.prepare(
                'INSERT OR IGNORE INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
            );
            for (const mode of allModes) {
                const hasSection = this.db.prepare('SELECT id FROM mode_note_sections WHERE mode_id = ? LIMIT 1').get(mode.id);
                if (!hasSection) {
                    const sections = BACKFILL_SECTIONS[mode.template_type] ?? [];
                    sections.forEach((s, i) => {
                        insertSection.run(`ns_bf_${mode.id}_${i}`, mode.id, s.title, s.description, i);
                    });
                    if (sections.length > 0) {
                        console.log(`[DatabaseManager] Backfilled ${sections.length} sections for mode "${mode.id}" (${mode.template_type})`);
                    }
                }
            }
            this.db.pragma('user_version = 13');
        }

        // Version 13 → 14: Add profile_custom_notes table
        if (version < 14) {
            console.log('[DatabaseManager] Applying migration v13 → v14: Add profile_custom_notes table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_custom_notes (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_custom_notes (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 14');
        }

        // Version 14 → 15: Add profile_persona table
        if (version < 15) {
            console.log('[DatabaseManager] Applying migration v14 → v15: Add profile_persona table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_persona (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT OR IGNORE INTO profile_persona (id, content) VALUES (1, '');
            `);
            this.db.pragma('user_version = 15');
        }

        // Version 15 → 16: Add embedding_space identity column + backfill.
        // The previous re-index compatibility check keyed on `embedding_provider`
        // (name only, e.g. 'gemini'), which CANNOT distinguish two models with the
        // same provider+dimensions but incompatible vector spaces (e.g.
        // gemini-embedding-001 768d vs gemini-embedding-2 768d). embedding_space is
        // the composite `${name}:${model}:${dims}` identity that fixes this.
        //
        // Backfill synthesizes the v1 space for each legacy row from its existing
        // provider+dims so it correctly DIFFERS from any new model's space. The
        // model strings below must match each provider's shipped default at the
        // time legacy rows were written (see electron/rag/embeddingSpace.ts:legacySpaceForProvider).
        if (version < 16) {
            console.log('[DatabaseManager] Applying migration v15 → v16: Add embedding_space column + backfill');
            try { this.db.exec('ALTER TABLE meetings ADD COLUMN embedding_space TEXT'); } catch (e) { /* column already exists */ }
            try {
                // Build the CASE arms from the SAME shared map legacySpaceForProvider uses,
                // so the migration backfill and the runtime space key can never drift apart.
                const caseArms = buildLegacySpaceCaseSql();
                this.db.exec(`
                    UPDATE meetings
                    SET embedding_space =
                        embedding_provider || ':' ||
                        CASE embedding_provider
                          ${caseArms}
                          ELSE 'unknown'
                        END || ':' ||
                        COALESCE(CAST(embedding_dimensions AS TEXT), 'unknown')
                    WHERE embedding_provider IS NOT NULL
                      AND embedding_space IS NULL;
                `);
                this.db.exec('CREATE INDEX IF NOT EXISTS idx_meetings_embedding_space ON meetings(embedding_space);');
                console.log('[DatabaseManager] v16 migration: embedding_space backfilled + indexed ✓');
            } catch (e) {
                console.error('[DatabaseManager] v16 migration backfill failed (non-fatal):', e);
            }
            this.db.pragma('user_version = 16');
        }

        // Version 16 -> 17: Add profile_jds table for job description storage.
        if (version < 17) {
            console.log('[DatabaseManager] Applying migration v16 -> v17: Add profile_jds table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_jds (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    raw_text TEXT NOT NULL,
                    parsed_json TEXT NOT NULL,
                    file_hash TEXT,
                    created_at INTEGER NOT NULL
                );
            `);
            this.db.pragma('user_version = 17');
        }

        // Version 17 -> 18: Add generalized profile master + scenario metadata for mode reference files.
        if (version < 18) {
            console.log('[DatabaseManager] Applying migration v17 -> v18: Add profile master + mode reference metadata');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS profile_master (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    display_name TEXT,
                    headline TEXT,
                    summary TEXT NOT NULL DEFAULT '',
                    contact_info_json TEXT NOT NULL DEFAULT '{}',
                    experience_json TEXT NOT NULL DEFAULT '[]',
                    skills_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                INSERT OR IGNORE INTO profile_master (id, summary) VALUES (1, '');

                CREATE TABLE IF NOT EXISTS mode_reference_file_metadata (
                    reference_file_id TEXT PRIMARY KEY,
                    scenario_type TEXT NOT NULL,
                    doc_subtype TEXT NOT NULL,
                    parsed_json TEXT,
                    file_hash TEXT,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY(reference_file_id) REFERENCES mode_reference_files(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_mode_ref_meta_scenario
                    ON mode_reference_file_metadata (scenario_type, doc_subtype);
            `);
            this.db.pragma('user_version = 18');
        }

        // Version 18 -> 19: Migrate user_profile to profile_master, drop legacy tables.
        // user_profile.structured_json (raw ResumeParsed) was the only consumer of
        // getUserProfile(). ScenarioContextService now reads profile_master, so we
        // fold any pre-existing structured_json into profile_master (only when the
        // master is still empty so we never clobber user edits) and drop both legacy
        // tables. resume_nodes has been dead since the original orchestrator work;
        // its embedding BLOB column was never written.
        if (version < 19) {
            console.log('[DatabaseManager] Applying migration v18 -> v19: Drop legacy user_profile + resume_nodes');

            try {
                const old = this.db.prepare(
                    'SELECT structured_json FROM user_profile WHERE id = 1'
                ).get() as { structured_json: string } | undefined;

                const master = this.db.prepare(
                    'SELECT display_name, headline, summary FROM profile_master WHERE id = 1'
                ).get() as { display_name?: string | null; headline?: string | null; summary?: string | null } | undefined;

                const masterIsEmpty = !master
                    || (!master.display_name && !master.headline && !(master.summary && master.summary.length > 0));

                if (old?.structured_json && masterIsEmpty) {
                    try {
                        const parsed = JSON.parse(old.structured_json);
                        this.db.prepare(
                            `UPDATE profile_master
                                SET display_name = ?,
                                    headline = ?,
                                    summary = ?,
                                    contact_info_json = ?,
                                    experience_json = ?,
                                    skills_json = ?,
                                    updated_at = datetime('now')
                              WHERE id = 1`
                        ).run(
                            parsed?.identity?.name ?? null,
                            parsed?.identity?.role ?? null,
                            parsed?.summary ?? '',
                            JSON.stringify(parsed?.identity?.contact ?? {}),
                            JSON.stringify(parsed?.experience ?? []),
                            JSON.stringify(parsed?.skills ?? []),
                        );
                        console.log('[DatabaseManager] v19: migrated user_profile.structured_json to profile_master');
                    } catch (parseErr) {
                        console.warn('[DatabaseManager] v19: structured_json parse failed, skipping data migration', parseErr);
                    }
                }
            } catch (e) {
                // user_profile may already be absent (fresh install or earlier manual cleanup)
                console.warn('[DatabaseManager] v19: user_profile migration step skipped', e);
            }

            try {
                this.db.exec('DROP TABLE IF EXISTS user_profile');
            } catch (e) {
                console.warn('[DatabaseManager] v19: DROP user_profile failed', e);
            }
            try {
                this.db.exec('DROP TABLE IF EXISTS resume_nodes');
            } catch (e) {
                console.warn('[DatabaseManager] v19: DROP resume_nodes failed', e);
            }

            this.db.pragma('user_version = 19');
        }

        // Version 19 -> 20: Add company_research_cache table for the Research Pipeline.
        // Caches generated company dossiers keyed by company name with 24h TTL.
        // company_name is the normalized cache key; company_name_display preserves the user's original casing.
        // generated_at / expires_at: ISO 8601 UTC strings (Date.toISOString()).
        if (version < 20) {
            console.log('[DatabaseManager] Applying migration v19 -> v20: Add company_research_cache table');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS company_research_cache (
                    company_name TEXT PRIMARY KEY,
                    company_name_display TEXT NOT NULL,
                    dossier_json TEXT NOT NULL,
                    generated_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    schema_version TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_company_research_expires
                    ON company_research_cache(expires_at);
            `);
            this.db.pragma('user_version = 20');
        }

        // Version 20 -> 21: Translate all mode note sections to Chinese.
        // This overwrites every section belonging to a template mode with the
        // current Chinese defaults, regardless of whether the user previously
        // customized them.
        if (version < 21) {
            console.log('[DatabaseManager] Applying migration v20 -> v21: Translate mode note sections to Chinese');
            const chineseSections: Record<string, Array<{ title: string; description: string }>> = {
                general: [
                    { title: '摘要', description: '对话的高级摘要。' },
                    { title: '行动项', description: '识别出的任务和后续跟进。' },
                    { title: '要点', description: '讨论中的重要观点。' },
                ],
                'looking-for-work': [
                    { title: '后续行动', description: '下一步面试安排，或我承诺会发送的额外材料。' },
                    { title: '概览', description: '面试、公司和整体流程的概览。' },
                    { title: '问题与回答', description: '面试中问到的所有问题以及我给出的回答。' },
                    { title: '改进空间', description: '我在面试中可以做得更好的地方。' },
                    { title: '岗位细节', description: '关于职位、薪资期望等讨论到的任何内容。' },
                ],
                sales: [
                    { title: '行动项', description: '我在会议后需要完成的所有行动项。' },
                    { title: '结果', description: '是否成交以及对话的结果。' },
                    { title: '客户背景', description: '我向其销售的对象的背景信息。' },
                    { title: '需求发现', description: '客户在需求发现阶段说了什么。' },
                    { title: '产品', description: '我是如何介绍产品的，以及客户的反应。' },
                    { title: '异议', description: '客户提出的任何异议。' },
                ],
                recruiting: [
                    { title: '行动项', description: '我在会议后必须完成的所有行动项。' },
                    { title: '经验与技能', description: '讨论到的候选人的先前工作经验和技能。' },
                    { title: '回答质量', description: '如果有提问，候选人每个问题回答得有多好、多准确。' },
                    { title: '对公司的兴趣', description: '候选人对其公司兴趣的描述。' },
                    { title: '岗位期望', description: '关于职位、薪资期望等讨论到的任何内容。' },
                ],
                'team-meet': [
                    { title: '行动项', description: '我在会议后需要完成的所有行动项。' },
                    { title: '公告', description: '会议中的任何团队公告。' },
                    { title: '团队更新', description: '每位团队成员的进展、成果和当前重点。' },
                    { title: '挑战或阻塞', description: '任何可能影响进展的问题或障碍。' },
                    { title: '已做决策', description: '会议中达成的关键决策或共识。' },
                ],
                lecture: [
                    { title: '后续作业', description: '课后阅读、作业或需要完成的任务。' },
                    { title: '主题', description: '讲座的主要科目或主题。' },
                    { title: '核心概念', description: '涵盖的核心思想或框架。' },
                    { title: '内容', description: '讲座的全部内容，用非常详细的要点笔记记录。' },
                ],
                'technical-interview': [
                    { title: '覆盖的问题', description: '每个被问到的问题、使用的方法和结果。' },
                    { title: '考察的概念', description: '涉及的关键算法、数据结构或系统设计概念。' },
                    { title: '表现出色之处', description: '哪些方法或解释效果不错。' },
                    { title: '待学习领域', description: '识别出的需要更多准备的主题或知识缺口。' },
                    { title: '行动项', description: '后续步骤——例如发送代码、学习特定主题、等待下一轮。' },
                ],
            };

            const modes = this.db.prepare('SELECT id, template_type FROM modes').all() as Array<{ id: string; template_type: string }>;
            const deleteSections = this.db.prepare('DELETE FROM mode_note_sections WHERE mode_id = ?');
            const insertSection = this.db.prepare(
                'INSERT INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
            );

            for (const mode of modes) {
                const sections = chineseSections[mode.template_type] ?? [];
                if (sections.length === 0) continue;

                deleteSections.run(mode.id);
                sections.forEach((s, i) => {
                    insertSection.run(`ns_cn_${mode.id}_${i}`, mode.id, s.title, s.description, i);
                });
                console.log(`[DatabaseManager] Translated ${sections.length} sections for mode "${mode.id}" (${mode.template_type})`);
            }

            this.db.pragma('user_version = 21');
        }

        // Version 21 -> 22: Seed the FDE template mode and its note sections for existing databases.
        if (version < 22) {
            console.log('[DatabaseManager] Applying migration v21 -> v22: Seed FDE mode for existing databases');
            const defaultFdeModeId = 'mode_fde_default';
            const fdeSections = [
                { title: '客户目标', description: '客户想达成的业务结果、成功指标和决策背景。' },
                { title: '现场工作流', description: '客户当前如何完成这件事，涉及哪些角色、输入、输出和交接。' },
                { title: '痛点与阻塞', description: '重复劳动、系统限制、数据缺口、流程摩擦和失败成本。' },
                { title: '系统与数据约束', description: '集成系统、API、权限、SSO、数据源、安全和合规约束。' },
                { title: '方案假设', description: '现场形成的技术方案、原型方向、待验证假设和成功门槛。' },
                { title: '风险与未知项', description: '尚未确认、可能影响交付、范围或上线计划的事项。' },
                { title: '行动项', description: '会后要推进的负责人、截止时间、所需资料和交付物。' },
            ];

            const existingFdeMode = this.db.prepare(
                'SELECT id FROM modes WHERE template_type = ? LIMIT 1'
            ).get('fde') as { id: string } | undefined;

            if (!existingFdeMode) {
                this.db.prepare(`
                    INSERT OR IGNORE INTO modes (id, name, template_type, custom_context, is_active)
                    VALUES (?, ?, ?, ?, 0)
                `).run(defaultFdeModeId, 'FDE', 'fde', '');
            }

            const fdeMode = this.db.prepare(
                'SELECT id FROM modes WHERE template_type = ? LIMIT 1'
            ).get('fde') as { id: string } | undefined;

            if (fdeMode) {
                const hasSection = this.db.prepare(
                    'SELECT id FROM mode_note_sections WHERE mode_id = ? LIMIT 1'
                ).get(fdeMode.id);

                if (!hasSection) {
                    const insertSection = this.db.prepare(
                        'INSERT OR IGNORE INTO mode_note_sections (id, mode_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)'
                    );

                    fdeSections.forEach((section, index) => {
                        insertSection.run(`ns_fde_${fdeMode.id}_${index}`, fdeMode.id, section.title, section.description, index);
                    });
                    console.log(`[DatabaseManager] Seeded ${fdeSections.length} FDE sections for mode "${fdeMode.id}"`);
                }
            }

            this.db.pragma('user_version = 22');
        }

        // Version 22 -> 23: Store per-mode intent keyword defaults for editable mode settings.
        if (version < 23) {
            console.log('[DatabaseManager] Applying migration v22 -> v23: Add mode intent keyword settings');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS mode_intent_keywords (
                    id TEXT PRIMARY KEY,
                    mode_id TEXT NOT NULL,
                    intent TEXT NOT NULL,
                    keywords_csv TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(mode_id, intent),
                    FOREIGN KEY(mode_id) REFERENCES modes(id) ON DELETE CASCADE
                );
            `);

            const modes = this.db.prepare('SELECT id, template_type FROM modes').all() as Array<{ id: string; template_type: string }>;
            const insertKeyword = this.db.prepare(`
                INSERT OR IGNORE INTO mode_intent_keywords
                    (id, mode_id, intent, keywords_csv, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `);
            for (const mode of modes) {
                const defaults = DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE[mode.template_type] ?? DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE.general;
                for (const row of defaults) {
                    insertKeyword.run(`ik_${mode.id}_${row.intent}`, mode.id, row.intent, row.keywordsCsv);
                }
            }
            this.db.pragma('user_version = 23');
        }

        // Version 23 -> 24: Preserve optional speaker diarization metadata on transcripts.
        if (version < 24) {
            console.log('[DatabaseManager] Applying migration v23 -> v24: Add speaker diarization transcript columns');
            const columnsToAdd = [
                'ALTER TABLE transcripts ADD COLUMN speaker_id TEXT',
                'ALTER TABLE transcripts ADD COLUMN speaker_label TEXT',
                'ALTER TABLE transcripts ADD COLUMN provider_speaker_id TEXT',
                'ALTER TABLE transcripts ADD COLUMN diarization_provider TEXT',
                'ALTER TABLE transcripts ADD COLUMN start_timestamp_ms INTEGER',
                'ALTER TABLE transcripts ADD COLUMN end_timestamp_ms INTEGER',
            ];
            for (const sql of columnsToAdd) {
                try { this.db.exec(sql); } catch (e) { /* Column already exists */ }
            }
            this.db.pragma('user_version = 24');
        }

        // Version 24 -> 25: Answer context visibility and local quality events.
        if (version < 25) {
            console.log('[DatabaseManager] Applying migration v24 -> v25: Add answer context trace tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS answer_context_traces (
                    id TEXT PRIMARY KEY,
                    answer_id TEXT NOT NULL UNIQUE,
                    meeting_id TEXT,
                    interaction_id INTEGER,
                    answer_type TEXT NOT NULL DEFAULT 'what_to_say',
                    surface TEXT NOT NULL DEFAULT 'overlay',
                    provider TEXT,
                    model TEXT,
                    latency_ms INTEGER,
                    context_used_json TEXT NOT NULL DEFAULT '{}',
                    citations_json TEXT NOT NULL DEFAULT '[]',
                    degraded_reason TEXT,
                    status TEXT NOT NULL DEFAULT 'generated',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
                );

                CREATE INDEX IF NOT EXISTS idx_answer_context_traces_answer_id
                    ON answer_context_traces(answer_id);
                CREATE INDEX IF NOT EXISTS idx_answer_context_traces_meeting_id
                    ON answer_context_traces(meeting_id);

                CREATE TABLE IF NOT EXISTS answer_quality_events (
                    id TEXT PRIMARY KEY,
                    answer_id TEXT NOT NULL,
                    meeting_id TEXT,
                    event_type TEXT NOT NULL CHECK(event_type IN ('shown', 'copied', 'accepted', 'ignored', 'regenerated')),
                    surface TEXT NOT NULL DEFAULT 'overlay',
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(answer_id) REFERENCES answer_context_traces(answer_id) ON DELETE CASCADE,
                    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
                );

                CREATE INDEX IF NOT EXISTS idx_answer_quality_events_answer_id
                    ON answer_quality_events(answer_id);
                CREATE INDEX IF NOT EXISTS idx_answer_quality_events_type
                    ON answer_quality_events(event_type);
                CREATE INDEX IF NOT EXISTS idx_answer_quality_events_meeting_id
                    ON answer_quality_events(meeting_id);
            `);
            this.db.pragma('user_version = 25');
        }

        // Version 25 -> 26: Unified local material library for uploaded-document RAG.
        if (version < 26) {
            console.log('[DatabaseManager] Applying migration v25 -> v26: Add knowledge material tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS knowledge_materials (
                    id TEXT PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    title TEXT,
                    mime_or_ext TEXT NOT NULL,
                    file_hash TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'indexing', 'complete', 'failed', 'deleted')),
                    error_code TEXT,
                    error_message TEXT,
                    source_type TEXT NOT NULL DEFAULT 'upload',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_knowledge_materials_status
                    ON knowledge_materials(status);
                CREATE INDEX IF NOT EXISTS idx_knowledge_materials_file_hash
                    ON knowledge_materials(file_hash);

                CREATE TABLE IF NOT EXISTS knowledge_material_chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    material_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    parent_chunk_index INTEGER,
                    cleaned_text TEXT NOT NULL,
                    parent_text TEXT,
                    token_count INTEGER NOT NULL,
                    embedding BLOB,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(material_id, chunk_index),
                    FOREIGN KEY(material_id) REFERENCES knowledge_materials(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_knowledge_material_chunks_material
                    ON knowledge_material_chunks(material_id, chunk_index);

                CREATE TABLE IF NOT EXISTS material_embedding_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    material_chunk_id INTEGER NOT NULL UNIQUE,
                    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    processed_at TEXT,
                    FOREIGN KEY(material_chunk_id) REFERENCES knowledge_material_chunks(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_material_embedding_queue_status
                    ON material_embedding_queue(status);
            `);
            this.db.pragma('user_version = 26');
        }

        // Version 26 -> 27: Backfill shipped default custom contexts for blank built-in modes.
        if (version < 27) {
            console.log('[DatabaseManager] Applying migration v26 -> v27: Backfill default mode custom contexts');
            const builtInModeTemplateTypes: Array<keyof typeof DEFAULT_MODE_CUSTOM_CONTEXT_BY_TEMPLATE> = [
                'general',
                'sales',
                'fde',
                'recruiting',
                'team-meet',
                'looking-for-work',
                'technical-interview',
                'lecture',
            ];
            const updateBlankCustomContext = this.db.prepare(`
                UPDATE modes SET custom_context = ?
                WHERE template_type = ?
                  AND (custom_context IS NULL OR TRIM(custom_context) = '')
            `);
            for (const templateType of builtInModeTemplateTypes) {
                updateBlankCustomContext.run(
                    DEFAULT_MODE_CUSTOM_CONTEXT_BY_TEMPLATE[templateType],
                    templateType,
                );
            }
            this.db.pragma('user_version = 27');
        }

        // Version 27 -> 28: Local speaker verification profile tables.
        if (version < 28) {
            console.log('[DatabaseManager] Applying migration v27 -> v28: Local speaker verification profile tables');
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS speaker_profiles (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    embedding_dim INTEGER NOT NULL,
                    extractor_model TEXT NOT NULL,
                    extractor_version TEXT NOT NULL,
                    threshold REAL NOT NULL,
                    enrolled_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    device_fingerprint TEXT,
                    sample_count INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS speaker_profile_stats (
                    profile_id TEXT PRIMARY KEY,
                    total_verifications INTEGER NOT NULL DEFAULT 0,
                    positive_verifications INTEGER NOT NULL DEFAULT 0,
                    last_verified_at INTEGER
                );
            `);
            this.db.pragma('user_version = 28');
        }

        // Version 28 -> 29: Preserve local speaker verification metadata on transcripts.
        if (version < 29) {
            console.log('[DatabaseManager] Applying migration v28 -> v29: Add speaker verification transcript metadata');
            try { this.db.exec('ALTER TABLE transcripts ADD COLUMN speaker_verification_json TEXT'); } catch (e) { /* Column already exists */ }
            this.db.pragma('user_version = 29');
        }

        console.log('[DatabaseManager] Migrations completed.');
    }

    private vectorToBlob(vector: number[]): Buffer {
        const buffer = Buffer.alloc(vector.length * 4);
        vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
        return buffer;
    }

    public saveAnswerContextTrace(input: AnswerContextTraceInput): any | null {
        if (!this.db) return null;
        const id = `act_${Date.now()}_${cryptoRandomId()}`;
        const contextPayload = {
            ...normalizeAnswerContextUsed(input.contextUsed),
            sourceStatus: normalizeAnswerSourceStatus(input.sourceStatus),
            traceId: input.traceId ?? input.answerId,
            observability: input.observability ?? {},
        };
        const row = {
            id,
            answer_id: input.answerId,
            meeting_id: input.meetingId ?? null,
            interaction_id: input.interactionId ?? null,
            answer_type: input.answerType ?? 'what_to_say',
            surface: input.surface ?? 'overlay',
            provider: input.provider ?? null,
            model: input.model ?? null,
            latency_ms: Number.isFinite(input.latencyMs) ? input.latencyMs : null,
            context_used_json: JSON.stringify(contextPayload),
            citations_json: JSON.stringify(input.citations ?? []),
            degraded_reason: input.degradedReason ?? null,
            status: input.status ?? 'generated',
        };
        this.db.prepare(`
            INSERT INTO answer_context_traces
                (id, answer_id, meeting_id, interaction_id, answer_type, surface, provider, model, latency_ms, context_used_json, citations_json, degraded_reason, status)
            VALUES
                (@id, @answer_id, @meeting_id, @interaction_id, @answer_type, @surface, @provider, @model, @latency_ms, @context_used_json, @citations_json, @degraded_reason, @status)
            ON CONFLICT(answer_id) DO UPDATE SET
                meeting_id = excluded.meeting_id,
                interaction_id = excluded.interaction_id,
                answer_type = excluded.answer_type,
                surface = excluded.surface,
                provider = excluded.provider,
                model = excluded.model,
                latency_ms = excluded.latency_ms,
                context_used_json = excluded.context_used_json,
                citations_json = excluded.citations_json,
                degraded_reason = excluded.degraded_reason,
                status = excluded.status
        `).run(row);
        return this.getAnswerContextTrace(input.answerId);
    }

    public getAnswerContextTrace(answerId: string): any | null {
        if (!this.db) return null;
        const row = this.db.prepare('SELECT * FROM answer_context_traces WHERE answer_id = ?').get(answerId) as any;
        if (!row) return null;
        const contextPayload = safeJson(row.context_used_json, {});
        return {
            ...row,
            contextUsed: normalizeAnswerContextUsed(contextPayload),
            sourceStatus: normalizeAnswerSourceStatus((contextPayload as any).sourceStatus),
            traceId: (contextPayload as any).traceId ?? row.answer_id,
            observability: (contextPayload as any).observability ?? {},
            citations: safeJson(row.citations_json, []),
        };
    }

    public trackAnswerQualityEvent(input: {
        answerId: string;
        eventType: AnswerQualityEventType;
        surface?: string;
        metadata?: Record<string, unknown>;
    }): { success: boolean; id?: string; error?: string } {
        if (!this.db) return { success: false, error: 'database_unavailable' };
        const trace = this.getAnswerContextTrace(input.answerId);
        if (!trace) return { success: false, error: 'answer_id_not_found' };
        const id = `aqe_${Date.now()}_${cryptoRandomId()}`;
        this.db.prepare(`
            INSERT INTO answer_quality_events
                (id, answer_id, meeting_id, event_type, surface, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.answerId,
            trace.meeting_id ?? null,
            input.eventType,
            input.surface ?? 'overlay',
            JSON.stringify(input.metadata ?? {}),
        );
        return { success: true, id };
    }

    public getAnswerQualityMetrics(input?: { sinceMs?: number; mode?: string }): AnswerQualityMetrics {
        const emptyMetrics: AnswerQualityMetrics = {
            shownCount: 0,
            copiedCount: 0,
            acceptedCount: 0,
            ignoredCount: 0,
            regeneratedCount: 0,
            averageLatencyMs: null,
            p95LatencyMs: null,
            citationHitRate: 0,
            userAcceptanceRate: 0,
            regenerationRate: 0,
            ragHitRate: 0,
            noContextAnswerRate: 0,
        };
        if (!this.db) return emptyMetrics;

        const filters: string[] = [];
        const params: any[] = [];
        if (Number.isFinite(input?.sinceMs)) {
            filters.push("created_at >= datetime(? / 1000, 'unixepoch')");
            params.push(input?.sinceMs);
        }
        if (input?.mode) {
            filters.push('answer_type = ?');
            params.push(input.mode);
        }
        const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
        const traces = this.db.prepare(`
            SELECT *
            FROM answer_context_traces
            ${whereClause}
        `).all(...params) as any[];
        if (traces.length === 0) return emptyMetrics;

        const traceIds = traces.map((trace) => trace.answer_id).filter(Boolean);
        const eventRows = traceIds.length > 0
            ? this.db.prepare(`
                SELECT answer_id, event_type, surface, metadata_json, created_at
                FROM answer_quality_events
                WHERE answer_id IN (${traceIds.map(() => '?').join(',')})
            `).all(...traceIds) as Array<{ answer_id: string; event_type: AnswerQualityEventType; surface: string; metadata_json: string; created_at: string }>
            : [];
        const dedupedEvents = new Map<string, { answer_id: string; event_type: AnswerQualityEventType; surface: string }>();
        for (const event of eventRows) {
            dedupedEvents.set(`${event.answer_id}:${event.event_type}:${event.surface}`, event);
        }

        const eventCounts = {
            shown: 0,
            copied: 0,
            accepted: 0,
            ignored: 0,
            regenerated: 0,
        };
        for (const event of dedupedEvents.values()) {
            eventCounts[event.event_type] += 1;
        }

        const latencies = traces
            .map((trace) => Number(trace.latency_ms))
            .filter((latency) => Number.isFinite(latency) && latency >= 0)
            .sort((a, b) => a - b);
        const averageLatencyMs = latencies.length > 0
            ? Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length)
            : null;
        const p95LatencyMs = latencies.length > 0
            ? latencies[Math.floor((latencies.length - 1) * 0.95)]
            : null;

        let citationHits = 0;
        let ragAttempts = 0;
        let ragHits = 0;
        let noContextAnswers = 0;
        for (const trace of traces) {
            const contextPayload = safeJson<Record<string, unknown>>(trace.context_used_json, {});
            const contextUsed = normalizeAnswerContextUsed(contextPayload);
            const sourceStatus = normalizeAnswerSourceStatus((contextPayload as any).sourceStatus);
            const citations = safeJson<unknown[]>(trace.citations_json, []);
            const citationCount = Math.max(sourceStatus.citationCount, citations.length);
            if (citationCount > 0) citationHits += 1;
            if (sourceStatus.ragAttempted) ragAttempts += 1;
            if (sourceStatus.ragAttempted && (sourceStatus.uploadedMaterialHitCount > 0 || contextUsed.uploadedDocumentRag)) {
                ragHits += 1;
            }
            const onlyCurrentTranscript = contextUsed.currentTranscript
                && !contextUsed.shortTermHistory
                && !contextUsed.uploadedDocumentRag
                && !contextUsed.historicalMeetings
                && !contextUsed.longTermMemory
                && !contextUsed.enterpriseKnowledge
                && !contextUsed.screenContext;
            if (onlyCurrentTranscript && citationCount === 0) noContextAnswers += 1;
        }

        const denominator = eventCounts.shown;
        if (denominator === 0) {
            return {
                shownCount: 0,
                copiedCount: eventCounts.copied,
                acceptedCount: eventCounts.accepted,
                ignoredCount: eventCounts.ignored,
                regeneratedCount: eventCounts.regenerated,
                averageLatencyMs,
                p95LatencyMs,
                citationHitRate: 0,
                userAcceptanceRate: 0,
                regenerationRate: 0,
                ragHitRate: ragAttempts > 0 ? ragHits / ragAttempts : 0,
                noContextAnswerRate: 0,
            };
        }
        return {
            shownCount: eventCounts.shown,
            copiedCount: eventCounts.copied,
            acceptedCount: eventCounts.accepted,
            ignoredCount: eventCounts.ignored,
            regeneratedCount: eventCounts.regenerated,
            averageLatencyMs,
            p95LatencyMs,
            citationHitRate: citationHits / denominator,
            userAcceptanceRate: eventCounts.accepted / denominator,
            regenerationRate: eventCounts.regenerated / denominator,
            ragHitRate: ragAttempts > 0 ? ragHits / ragAttempts : 0,
            noContextAnswerRate: noContextAnswers / denominator,
        };
    }

    public getRealtimeDiagnosticsAggregate(input?: { sinceMs?: number; mode?: string }): RealtimeDiagnosticsAggregate {
        const metrics = this.getAnswerQualityMetrics(input);
        const emptyAggregate: RealtimeDiagnosticsAggregate = {
            metrics,
            degradedReasons: {},
            sourceStatusCounts: {},
            traceSampleSize: 0,
            eventSampleSize: metrics.shownCount,
        };
        if (!this.db) return emptyAggregate;

        const filters: string[] = [];
        const params: any[] = [];
        if (Number.isFinite(input?.sinceMs)) {
            filters.push("created_at >= datetime(? / 1000, 'unixepoch')");
            params.push(input?.sinceMs);
        }
        if (input?.mode) {
            filters.push('answer_type = ?');
            params.push(input.mode);
        }
        const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
        const traces = this.db.prepare(`
            SELECT answer_id, context_used_json, citations_json, degraded_reason
            FROM answer_context_traces
            ${whereClause}
        `).all(...params) as Array<{
            answer_id: string;
            context_used_json: string;
            citations_json: string;
            degraded_reason: string | null;
        }>;

        const degradedReasons: Record<string, number> = {};
        const sourceStatusCounts: Record<string, number> = {};

        for (const trace of traces) {
            const contextPayload = safeJson<Record<string, unknown>>(trace.context_used_json, {});
            const sourceStatus = normalizeAnswerSourceStatus((contextPayload as any).sourceStatus);
            const citations = safeJson<unknown[]>(trace.citations_json, []);
            const citationCount = Math.max(sourceStatus.citationCount, citations.length);
            countKnownDegradedReason(degradedReasons, trace.degraded_reason);
            countAnswerSourceStatus(sourceStatusCounts, sourceStatus, citationCount);
        }

        return {
            metrics,
            degradedReasons,
            sourceStatusCounts,
            traceSampleSize: traces.length,
            eventSampleSize: metrics.shownCount,
        };
    }

    public upsertKnowledgeMaterial(input: KnowledgeMaterialInput): any | null {
        if (!this.db) return null;
        this.db.prepare(`
            INSERT INTO knowledge_materials
                (id, file_name, title, mime_or_ext, file_hash, status, error_code, error_message, updated_at)
            VALUES
                (@id, @fileName, @title, @mimeOrExt, @fileHash, @status, @errorCode, @errorMessage, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                file_name = excluded.file_name,
                title = excluded.title,
                mime_or_ext = excluded.mime_or_ext,
                file_hash = excluded.file_hash,
                status = excluded.status,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                updated_at = excluded.updated_at
        `).run({
            id: input.id,
            fileName: input.fileName,
            title: input.title ?? input.fileName,
            mimeOrExt: input.mimeOrExt,
            fileHash: input.fileHash,
            status: input.status ?? 'queued',
            errorCode: input.errorCode ?? null,
            errorMessage: input.errorMessage ?? null,
        });
        return this.getKnowledgeMaterial(input.id);
    }

    public updateKnowledgeMaterialStatus(
        id: string,
        status: 'queued' | 'indexing' | 'complete' | 'failed' | 'deleted',
        error?: { code?: string | null; message?: string | null },
    ): void {
        if (!this.db) return;
        this.db.prepare(`
            UPDATE knowledge_materials
            SET status = ?, error_code = ?, error_message = ?, updated_at = datetime('now')
            WHERE id = ? AND (status != 'deleted' OR ? = 'deleted')
        `).run(status, error?.code ?? null, error?.message ?? null, id, status);
    }

    public markKnowledgeMaterialEmbeddingsFailed(materialId: string, message?: string | null): void {
        if (!this.db) return;
        this.db.prepare(`
            UPDATE material_embedding_queue
            SET status = 'failed', error_message = ?, processed_at = datetime('now')
            WHERE material_chunk_id IN (
                SELECT id FROM knowledge_material_chunks WHERE material_id = ?
            )
        `).run(message ?? 'embedding_failed', materialId);
    }

    public replaceKnowledgeMaterialChunks(materialId: string, chunks: KnowledgeMaterialChunkInput[]): number[] {
        if (!this.db) return [];
        const ids: number[] = [];
        const txn = this.db.transaction(() => {
            this.db!.prepare('DELETE FROM material_embedding_queue WHERE material_chunk_id IN (SELECT id FROM knowledge_material_chunks WHERE material_id = ?)').run(materialId);
            this.db!.prepare('DELETE FROM knowledge_material_chunks WHERE material_id = ?').run(materialId);
            const insertChunk = this.db!.prepare(`
                INSERT INTO knowledge_material_chunks
                    (material_id, chunk_index, parent_chunk_index, cleaned_text, parent_text, token_count, embedding, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insertQueue = this.db!.prepare(`
                INSERT OR IGNORE INTO material_embedding_queue (material_chunk_id, status)
                VALUES (?, ?)
            `);
            for (const chunk of chunks) {
                const result = insertChunk.run(
                    materialId,
                    chunk.chunkIndex,
                    chunk.parentChunkIndex ?? null,
                    chunk.cleanedText,
                    chunk.parentText ?? null,
                    chunk.tokenCount,
                    chunk.embedding ? this.vectorToBlob(chunk.embedding) : null,
                    JSON.stringify(chunk.metadata ?? {}),
                );
                const chunkId = result.lastInsertRowid as number;
                ids.push(chunkId);
                insertQueue.run(chunkId, chunk.embedding ? 'completed' : 'pending');
            }
        });
        txn();
        return ids;
    }

    public setKnowledgeMaterialChunkEmbedding(chunkId: number, embedding: number[]): void {
        if (!this.db) return;
        this.db.prepare('UPDATE knowledge_material_chunks SET embedding = ? WHERE id = ?').run(this.vectorToBlob(embedding), chunkId);
        this.db.prepare(`
            UPDATE material_embedding_queue
            SET status = 'completed', processed_at = datetime('now'), error_message = NULL
            WHERE material_chunk_id = ?
        `).run(chunkId);
    }

    public listKnowledgeMaterials(): any[] {
        if (!this.db) return [];
        return this.db.prepare(`
            SELECT *
            FROM knowledge_materials
            WHERE status != 'deleted'
            ORDER BY updated_at DESC, created_at DESC
        `).all();
    }

    public getKnowledgeMaterial(id: string): any | null {
        if (!this.db) return null;
        return this.db.prepare('SELECT * FROM knowledge_materials WHERE id = ? AND status != \'deleted\'').get(id) ?? null;
    }

    public deleteKnowledgeMaterial(id: string): void {
        if (!this.db) return;
        const txn = this.db.transaction(() => {
            this.db!.prepare('DELETE FROM material_embedding_queue WHERE material_chunk_id IN (SELECT id FROM knowledge_material_chunks WHERE material_id = ?)').run(id);
            this.db!.prepare('DELETE FROM knowledge_material_chunks WHERE material_id = ?').run(id);
            this.db!.prepare(`
                UPDATE knowledge_materials
                SET status = 'deleted', updated_at = datetime('now')
                WHERE id = ?
            `).run(id);
        });
        txn();
    }

    public getKnowledgeMaterialChunks(options: { withEmbeddingsOnly?: boolean } = {}): any[] {
        if (!this.db) return [];
        const embeddingClause = options.withEmbeddingsOnly ? 'AND c.embedding IS NOT NULL' : '';
        return this.db.prepare(`
            SELECT
                c.*,
                m.file_name,
                m.title,
                m.file_hash,
                m.created_at AS material_created_at,
                m.updated_at AS material_updated_at
            FROM knowledge_material_chunks c
            JOIN knowledge_materials m ON m.id = c.material_id
            WHERE m.status = 'complete' ${embeddingClause}
            ORDER BY m.updated_at DESC, c.chunk_index ASC
        `).all();
    }

    public getKnowledgeMaterialChunkById(chunkId: number): any | null {
        if (!this.db) return null;
        return this.db.prepare(`
            SELECT
                c.*,
                m.file_name,
                m.title,
                m.file_hash,
                m.updated_at AS material_updated_at
            FROM knowledge_material_chunks c
            JOIN knowledge_materials m ON m.id = c.material_id
            WHERE c.id = ? AND m.status = 'complete'
        `).get(chunkId) ?? null;
    }

    public getMaterialQueueStatus(): { pending: number; processing: number; completed: number; failed: number } {
        if (!this.db) return { pending: 0, processing: 0, completed: 0, failed: 0 };
        const rows = this.db.prepare(`
            SELECT status, COUNT(*) AS count
            FROM material_embedding_queue
            GROUP BY status
        `).all() as Array<{ status: string; count: number }>;
        const status = { pending: 0, processing: 0, completed: 0, failed: 0 };
        for (const row of rows) {
            if (row.status in status) {
                (status as any)[row.status] = row.count;
            }
        }
        return status;
    }

    // ============================================
    // Profile Custom Notes
    // ============================================

    public getCustomNotes(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_custom_notes WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getCustomNotes failed:', e);
            return '';
        }
    }

    public saveCustomNotes(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_custom_notes (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] saveCustomNotes failed:', e);
        }
    }

    public getPersona(): string {
        if (!this.db) return '';
        try {
            const row = this.db.prepare('SELECT content FROM profile_persona WHERE id = 1').get() as { content: string } | undefined;
            return row?.content ?? '';
        } catch (e) {
            console.error('[DatabaseManager] getPersona failed:', e);
            return '';
        }
    }

    public savePersona(content: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_persona (id, content, updated_at) VALUES (1, ?, datetime(\'now\')) ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
            ).run(content);
        } catch (e) {
            console.error('[DatabaseManager] savePersona failed:', e);
        }
    }

    public clearProfilePersona(): void {
        if (!this.db) return;
        try {
            this.db.prepare('UPDATE profile_persona SET content = \'\', updated_at = datetime(\'now\') WHERE id = 1').run();
        } catch (e) {
            console.error('[DatabaseManager] clearProfilePersona failed:', e);
        }
    }

    // ============================================
    // Profile Intelligence
    // ============================================

    public getUserProfile(): UserProfileRecord | null {
        if (!this.db) return null;
        try {
            return this.db.prepare('SELECT * FROM user_profile WHERE id = 1').get() as UserProfileRecord | null;
        } catch (e) {
            console.error('[DatabaseManager] getUserProfile failed:', e);
            return null;
        }
    }

    public saveUserProfile(structuredJson: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                `INSERT INTO user_profile (id, structured_json, compact_persona, created_at)
                 VALUES (1, ?, '', ?)
                 ON CONFLICT(id) DO UPDATE SET
                   structured_json = excluded.structured_json,
                   compact_persona = COALESCE(user_profile.compact_persona, excluded.compact_persona),
                   created_at = excluded.created_at`
            ).run(structuredJson, Date.now());
        } catch (e) {
            console.error('[DatabaseManager] saveUserProfile failed:', e);
        }
    }

    public clearUserProfile(): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM user_profile WHERE id = 1').run();
        } catch (e) {
            console.error('[DatabaseManager] clearUserProfile failed:', e);
        }
    }

    public getResumeNodes(category?: string): any[] {
        if (!this.db) return [];
        try {
            if (category) {
                return this.db.prepare('SELECT * FROM resume_nodes WHERE category = ?').all(category);
            }
            return this.db.prepare('SELECT * FROM resume_nodes').all();
        } catch (e) {
            console.error('[DatabaseManager] getResumeNodes failed:', e);
            return [];
        }
    }

    public upsertResumeNodes(nodes: ResumeNode[]): void {
        if (!this.db || nodes.length === 0) return;
        try {
            const insert = this.db.prepare(`
                INSERT INTO resume_nodes (category, title, organization, start_date, end_date, duration_months, text_content, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const tx = this.db.transaction(() => {
                for (const node of nodes) {
                    insert.run(
                        node.category,
                        node.title ?? null,
                        node.organization ?? null,
                        node.startDate ?? null,
                        node.endDate ?? null,
                        node.durationMonths ?? null,
                        node.textContent ?? null,
                        node.tags ?? null,
                    );
                }
            });
            tx();
        } catch (e) {
            console.error('[DatabaseManager] upsertResumeNodes failed:', e);
        }
    }

    public clearResumeNodes(): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM resume_nodes').run();
        } catch (e) {
            console.error('[DatabaseManager] clearResumeNodes failed:', e);
        }
    }

    public getActiveJD(): any | null {
        if (!this.db) return null;
        try {
            return this.db.prepare('SELECT * FROM profile_jds WHERE id = 1').get() as any | null;
        } catch (e) {
            console.error('[DatabaseManager] getActiveJD failed:', e);
            return null;
        }
    }

    public saveActiveJD(rawText: string, parsedJson: string, fileHash?: string): void {
        if (!this.db) return;
        try {
            this.db.prepare(
                'INSERT INTO profile_jds (id, raw_text, parsed_json, file_hash, created_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET raw_text = excluded.raw_text, parsed_json = excluded.parsed_json, file_hash = excluded.file_hash, created_at = excluded.created_at'
            ).run(rawText, parsedJson, fileHash ?? null, Date.now());
        } catch (e) {
            console.error('[DatabaseManager] saveActiveJD failed:', e);
        }
    }

    public clearActiveJD(): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM profile_jds WHERE id = 1').run();
        } catch (e) {
            console.error('[DatabaseManager] clearActiveJD failed:', e);
        }
    }

    public getProfileMaster(): any | null {
        if (!this.db) return null;
        try {
            return this.db.prepare('SELECT * FROM profile_master WHERE id = 1').get() as any | null;
        } catch (e) {
            console.error('[DatabaseManager] getProfileMaster failed:', e);
            return null;
        }
    }

    public updateProfileMaster(input: {
        displayName?: string | null;
        headline?: string | null;
        summary?: string;
        contactInfoJson?: string;
        experienceJson?: string;
        skillsJson?: string;
    }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO profile_master
                    (id, display_name, headline, summary, contact_info_json, experience_json, skills_json, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    headline = excluded.headline,
                    summary = excluded.summary,
                    contact_info_json = excluded.contact_info_json,
                    experience_json = excluded.experience_json,
                    skills_json = excluded.skills_json,
                    updated_at = excluded.updated_at
            `).run(
                input.displayName ?? null,
                input.headline ?? null,
                input.summary ?? '',
                input.contactInfoJson ?? '{}',
                input.experienceJson ?? '[]',
                input.skillsJson ?? '[]',
            );
        } catch (e) {
            console.error('[DatabaseManager] updateProfileMaster failed:', e);
            throw e;
        }
    }

    // ============================================
    // Modes CRUD
    // ============================================

    public getModes(): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare('SELECT * FROM modes ORDER BY created_at ASC').all();
        } catch (e) {
            console.error('[DatabaseManager] getModes failed:', e);
            return [];
        }
    }

    public getActiveMode(): any | null {
        if (!this.db) return null;
        try {
            return this.db.prepare('SELECT * FROM modes WHERE is_active = 1 LIMIT 1').get() ?? null;
        } catch (e) {
            console.error('[DatabaseManager] getActiveMode failed:', e);
            return null;
        }
    }

    public createMode(mode: { id: string; name: string; templateType: string; customContext: string }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO modes (id, name, template_type, custom_context, is_active)
                VALUES (?, ?, ?, ?, 0)
            `).run(mode.id, mode.name, mode.templateType, mode.customContext);
        } catch (e) {
            console.error('[DatabaseManager] createMode failed:', e);
        }
    }

    public updateMode(id: string, updates: { name?: string; templateType?: string; customContext?: string }): void {
        if (!this.db) return;
        try {
            if (updates.name !== undefined) {
                this.db.prepare('UPDATE modes SET name = ? WHERE id = ?').run(updates.name, id);
            }
            if (updates.templateType !== undefined) {
                this.db.prepare('UPDATE modes SET template_type = ? WHERE id = ?').run(updates.templateType, id);
            }
            if (updates.customContext !== undefined) {
                this.db.prepare('UPDATE modes SET custom_context = ? WHERE id = ?').run(updates.customContext, id);
            }
        } catch (e) {
            console.error('[DatabaseManager] updateMode failed:', e);
        }
    }

    public getIntentKeywords(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare(
                'SELECT * FROM mode_intent_keywords WHERE mode_id = ? ORDER BY created_at ASC, intent ASC'
            ).all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getIntentKeywords failed:', e);
            return [];
        }
    }

    public upsertIntentKeywords(modeId: string, rows: IntentKeywordConfig[]): void {
        if (!this.db) return;
        try {
            const txn = this.db.transaction(() => {
                this.db!.prepare('DELETE FROM mode_intent_keywords WHERE mode_id = ?').run(modeId);
                const insert = this.db!.prepare(`
                    INSERT INTO mode_intent_keywords
                        (id, mode_id, intent, keywords_csv, updated_at)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `);
                for (const row of rows) {
                    insert.run(`ik_${modeId}_${row.intent}`, modeId, row.intent, row.keywordsCsv);
                }
            });
            txn();
        } catch (e) {
            console.error('[DatabaseManager] upsertIntentKeywords failed:', e);
        }
    }

    public seedDefaultIntentKeywordsForMode(modeId: string, templateType: string): void {
        if (!this.db) return;
        try {
            const defaults = DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE[templateType] ?? DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE.general;
            const insert = this.db.prepare(`
                INSERT OR IGNORE INTO mode_intent_keywords
                    (id, mode_id, intent, keywords_csv, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `);
            for (const row of defaults) {
                insert.run(`ik_${modeId}_${row.intent}`, modeId, row.intent, row.keywordsCsv);
            }
        } catch (e) {
            console.error('[DatabaseManager] seedDefaultIntentKeywordsForMode failed:', e);
        }
    }

    public resetIntentKeywords(modeId: string, templateType: string): void {
        const defaults = DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE[templateType] ?? DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE.general;
        this.upsertIntentKeywords(modeId, defaults);
    }

    public deleteMode(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM modes WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteMode failed:', e);
        }
    }

    public setActiveMode(id: string | null): void {
        if (!this.db) return;
        try {
            const txn = this.db.transaction(() => {
                this.db!.prepare('UPDATE modes SET is_active = 0').run();
                if (id) {
                    const result = this.db!.prepare('UPDATE modes SET is_active = 1 WHERE id = ?').run(id);
                    if (result.changes === 0) {
                        console.warn(`[DatabaseManager] setActiveMode: no mode found with id "${id}" — active mode cleared`);
                    }
                }
            });
            txn();
        } catch (e) {
            console.error('[DatabaseManager] setActiveMode failed:', e);
        }
    }

    public getReferenceFiles(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare('SELECT * FROM mode_reference_files WHERE mode_id = ? ORDER BY created_at ASC').all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getReferenceFiles failed:', e);
            return [];
        }
    }

    public addReferenceFile(file: { id: string; modeId: string; fileName: string; content: string }): void {
        if (!this.db) throw new Error('Database not initialized');
        try {
            this.db.prepare(`
                INSERT INTO mode_reference_files (id, mode_id, file_name, content)
                VALUES (?, ?, ?, ?)
            `).run(file.id, file.modeId, file.fileName, file.content);
        } catch (e) {
            console.error('[DatabaseManager] addReferenceFile failed:', e);
            throw e;
        }
    }

    public deleteReferenceFile(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_reference_files WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteReferenceFile failed:', e);
        }
    }

    public upsertModeReferenceFileMetadata(input: {
        referenceFileId: string;
        scenarioType: string;
        docSubtype: string;
        parsedJson?: string | null;
        fileHash?: string | null;
    }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO mode_reference_file_metadata
                    (reference_file_id, scenario_type, doc_subtype, parsed_json, file_hash, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(reference_file_id) DO UPDATE SET
                    scenario_type = excluded.scenario_type,
                    doc_subtype = excluded.doc_subtype,
                    parsed_json = excluded.parsed_json,
                    file_hash = excluded.file_hash,
                    updated_at = excluded.updated_at
            `).run(
                input.referenceFileId,
                input.scenarioType,
                input.docSubtype,
                input.parsedJson ?? null,
                input.fileHash ?? null,
            );
        } catch (e) {
            console.error('[DatabaseManager] upsertModeReferenceFileMetadata failed:', e);
            throw e;
        }
    }

    public getModeReferenceFileMetadata(referenceFileId: string): any | null {
        if (!this.db) return null;
        try {
            return this.db.prepare(
                'SELECT * FROM mode_reference_file_metadata WHERE reference_file_id = ?'
            ).get(referenceFileId) ?? null;
        } catch (e) {
            console.error('[DatabaseManager] getModeReferenceFileMetadata failed:', e);
            return null;
        }
    }

    public getModeReferenceFileMetadataForMode(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare(`
                SELECT m.*
                FROM mode_reference_file_metadata m
                INNER JOIN mode_reference_files f ON f.id = m.reference_file_id
                WHERE f.mode_id = ?
                ORDER BY f.created_at ASC
            `).all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getModeReferenceFileMetadataForMode failed:', e);
            return [];
        }
    }

    // ── Note Sections ─────────────────────────────────────────────

    public getNoteSections(modeId: string): any[] {
        if (!this.db) return [];
        try {
            return this.db.prepare(
                'SELECT * FROM mode_note_sections WHERE mode_id = ? ORDER BY sort_order ASC, created_at ASC'
            ).all(modeId);
        } catch (e) {
            console.error('[DatabaseManager] getNoteSections failed:', e);
            return [];
        }
    }

    public addNoteSection(section: { id: string; modeId: string; title: string; description: string; sortOrder: number }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO mode_note_sections (id, mode_id, title, description, sort_order)
                VALUES (?, ?, ?, ?, ?)
            `).run(section.id, section.modeId, section.title, section.description, section.sortOrder);
        } catch (e) {
            console.error('[DatabaseManager] addNoteSection failed:', e);
        }
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string; sortOrder?: number }): void {
        if (!this.db) return;
        try {
            if (updates.title !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET title = ? WHERE id = ?').run(updates.title, id);
            }
            if (updates.description !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET description = ? WHERE id = ?').run(updates.description, id);
            }
            if (updates.sortOrder !== undefined) {
                this.db.prepare('UPDATE mode_note_sections SET sort_order = ? WHERE id = ?').run(updates.sortOrder, id);
            }
        } catch (e) {
            console.error('[DatabaseManager] updateNoteSection failed:', e);
        }
    }

    public deleteNoteSection(id: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_note_sections WHERE id = ?').run(id);
        } catch (e) {
            console.error('[DatabaseManager] deleteNoteSection failed:', e);
        }
    }

    public deleteAllNoteSections(modeId: string): void {
        if (!this.db) return;
        try {
            this.db.prepare('DELETE FROM mode_note_sections WHERE mode_id = ?').run(modeId);
        } catch (e) {
            console.error('[DatabaseManager] deleteAllNoteSections failed:', e);
        }
    }

    // ============================================
    // System KV Store (app_state)
    // ============================================

    public getAppState(key: string): string | null {
        if (!this.db) return null;
        try {
            const stmt = this.db.prepare('SELECT value FROM app_state WHERE key = ?');
            const row = stmt.get(key) as { value: string } | undefined;
            return row ? row.value : null;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to get app_state for key: ${key}`, error);
            return null;
        }
    }

    public setAppState(key: string, value: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)');
            stmt.run(key, value);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to set app_state for key: ${key}`, error);
        }
    }

    public deleteAppState(key: string): void {
        if (!this.db) return;
        try {
            const stmt = this.db.prepare('DELETE FROM app_state WHERE key = ?');
            stmt.run(key);
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete app_state for key: ${key}`, error);
        }
    }

    // ============================================
    // Company Research Cache (Research Pipeline)
    // ============================================

    public upsertCompanyResearchCache(row: {
        companyName: string;
        companyNameDisplay: string;
        dossierJson: string;
        generatedAt: string;
        expiresAt: string;
        source: string;
        schemaVersion: string;
    }): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT OR REPLACE INTO company_research_cache
                    (company_name, company_name_display, dossier_json,
                     generated_at, expires_at, source, schema_version)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                row.companyName,
                row.companyNameDisplay,
                row.dossierJson,
                row.generatedAt,
                row.expiresAt,
                row.source,
                row.schemaVersion,
            );
        } catch (error) {
            console.error(`[DatabaseManager] upsertCompanyResearchCache failed for "${row.companyName}":`, error);
            throw error;
        }
    }

    public getCompanyResearchCache(companyName: string): CompanyResearchCacheRow | null {
        if (!this.db) return null;
        try {
            const row = this.db.prepare(`
                SELECT dossier_json, expires_at, schema_version
                FROM company_research_cache
                WHERE company_name = ?
            `).get(companyName) as CompanyResearchCacheRow | undefined;
            return row ?? null;
        } catch (error) {
            console.error(`[DatabaseManager] getCompanyResearchCache failed for "${companyName}":`, error);
            return null;
        }
    }

    public pruneCompanyResearchCache(): number {
        if (!this.db) return 0;
        try {
            const result = this.db.prepare(`
                DELETE FROM company_research_cache WHERE expires_at < ?
            `).run(new Date().toISOString());
            return result.changes;
        } catch (error) {
            console.error('[DatabaseManager] pruneCompanyResearchCache failed:', error);
            return 0;
        }
    }

    public deleteAllCompanyResearchCache(): number {
        if (!this.db) return 0;
        try {
            const result = this.db.prepare('DELETE FROM company_research_cache').run();
            return result.changes;
        } catch (error) {
            console.error('[DatabaseManager] deleteAllCompanyResearchCache failed:', error);
            return 0;
        }
    }

    /**
     * One-time migration: Copy existing BLOB embeddings into vec0 virtual tables.
     */
    private migrateExistingEmbeddings(): void {
        if (!this.db) return;

        // Migrate chunk embeddings
        try {
            const chunkRows = this.db.prepare(
                'SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL'
            ).all() as any[];

            if (chunkRows.length > 0) {
                const insert = this.db.prepare(
                    'INSERT OR IGNORE INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)'
                );
                const migrateAll = this.db.transaction(() => {
                    for (const row of chunkRows) {
                        try {
                            insert.run(row.id, row.embedding);
                        } catch (err) {
                            // On mismatch (e.g. mixed 768 and 3072 dims), nullify to re-embed later
                            this.db.prepare('UPDATE chunks SET embedding = NULL WHERE id = ?').run(row.id);
                        }
                    }
                });
                migrateAll();
                console.log(`[DatabaseManager] Migrated ${chunkRows.length} chunk embeddings to vec_chunks`);
            }
        } catch (e) {
            console.error('[DatabaseManager] Failed to migrate chunk embeddings:', e);
        }

        // Migrate summary embeddings
        try {
            const summaryRows = this.db.prepare(
                'SELECT id, embedding FROM chunk_summaries WHERE embedding IS NOT NULL'
            ).all() as any[];

            if (summaryRows.length > 0) {
                const insert = this.db.prepare(
                    'INSERT OR IGNORE INTO vec_summaries(summary_id, embedding) VALUES (?, ?)'
                );
                const migrateAll = this.db.transaction(() => {
                    for (const row of summaryRows) {
                        try {
                            insert.run(row.id, row.embedding);
                        } catch (err) {
                            this.db.prepare('UPDATE chunk_summaries SET embedding = NULL WHERE id = ?').run(row.id);
                        }
                    }
                });
                migrateAll();
                console.log(`[DatabaseManager] Migrated ${summaryRows.length} summary embeddings to vec_summaries`);
            }
        } catch (e) {
            console.error('[DatabaseManager] Failed to migrate summary embeddings:', e);
        }
    }

    /**
     * Known embedding dimension tiers.
     * Used by the v8 migration, delete operations, and table provisioning.
     * When a new provider dimension is encountered at runtime, ensureVecTableForDim() handles it.
     */
    public static readonly KNOWN_DIMS: readonly number[] = [768, 1536, 3072];

    /** Cache: dimensions for which vec0 tables have already been verified/created this session. */
    private ensuredDims = new Set<number>();

    /**
     * Lazily create a per-dimension vec0 table pair if not already present.
     * Called by v8 migration and at runtime when a new embedding dimension is first seen.
     * Uses an in-memory cache to avoid redundant CREATE TABLE IF NOT EXISTS on every insert.
     */
    public ensureVecTableForDim(dim: number): void {
        if (this.ensuredDims.has(dim)) return; // Already verified this session
        if (!this.db) return;
        // Guard against SQL injection: dim must be a positive integer
        if (!Number.isInteger(dim) || dim <= 0 || dim > 100_000) {
            console.error(`[DatabaseManager] Invalid dimension for vec0 table: ${dim}`);
            return;
        }
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks_${dim} USING vec0(
                    chunk_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_summaries_${dim} USING vec0(
                    summary_id INTEGER PRIMARY KEY,
                    embedding float[${dim}]
                );
            `);
            this.ensuredDims.add(dim);
            console.log(`[DatabaseManager] Ensured vec0 tables for dim=${dim}`);
        } catch (e) {
            console.error(`[DatabaseManager] Failed to create vec0 tables for dim=${dim}:`, e);
        }
    }

    /**
     * Enumerate every embedding dimension that actually has a vec0 table, unioned
     * with KNOWN_DIMS. Used by delete/clear paths so they cover dims provisioned
     * at runtime via ensureVecTableForDim() — not just the static KNOWN_DIMS list.
     *
     * Without this, a provider that introduced a dimension outside KNOWN_DIMS (e.g.
     * a future model at 1024d) would have its rows created on insert but NEVER
     * deleted, orphaning vec0 rows on re-index/fallback.
     */
    public getExistingVecDims(): number[] {
        const dims = new Set<number>(DatabaseManager.KNOWN_DIMS);
        if (!this.db) return [...dims];
        try {
            const rows = this.db.prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vec_chunks_%'`
            ).all() as { name: string }[];
            for (const r of rows) {
                const m = r.name.match(/^vec_chunks_(\d+)$/);
                if (m) dims.add(Number(m[1]));
            }
        } catch (e) {
            console.warn('[DatabaseManager] getExistingVecDims failed; falling back to KNOWN_DIMS:', e);
        }
        return [...dims];
    }

    /**
     * Check if sqlite-vec is available (any per-dimension vec0 table must exist)
     */
    public hasVecExtension(): boolean {
        if (!this.db) return false;
        try {
            // Check the most common dimension (Ollama 768); any may suffice
            this.db.prepare("SELECT count(*) FROM vec_chunks_768 LIMIT 1").get();
            return true;
        } catch (e) {
            return false;
        }
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Expose the raw database instance for external managers (e.g. ProfileDatabaseManager).
     */
    public getDb(): Database.Database | null {
        return this.db;
    }

    /** Path to the SQLite database file on disk. Used by worker threads. */
    public getDbPath(): string {
        return this.dbPath;
    }

    /**
     * Resolved sqlite-vec extension path (without platform file suffix).
     * Used by worker threads that open their own DB connection.
     */
    public getExtPath(): string {
        return this.resolvedExtPath;
    }

    public saveMeeting(meeting: Meeting, startTimeMs: number, durationMs: number) {
        if (!this.db) {
            console.error('[DatabaseManager] DB not initialized');
            return;
        }

        const insertMeeting = this.db.prepare(`
            INSERT OR REPLACE INTO meetings (id, title, start_time, duration_ms, summary_json, created_at, calendar_event_id, source, is_processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTranscript = this.db.prepare(`
            INSERT INTO transcripts (
                meeting_id, speaker, speaker_id, speaker_label, provider_speaker_id,
                diarization_provider, content, timestamp_ms, start_timestamp_ms, end_timestamp_ms,
                speaker_verification_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertInteraction = this.db.prepare(`
            INSERT INTO ai_interactions (meeting_id, type, timestamp, user_query, ai_response, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const summaryJson = JSON.stringify({
            legacySummary: meeting.summary,
            detailedSummary: meeting.detailedSummary
        });

        const runTransaction = this.db.transaction(() => {
            // 1. Insert Meeting
            insertMeeting.run(
                meeting.id,
                meeting.title,
                startTimeMs,
                durationMs,
                summaryJson,
                meeting.date, // Using the ISO string as created_at for sorting simply
                meeting.calendarEventId || null,
                meeting.source || 'manual',
                meeting.isProcessed ? 1 : 0
            );

            // 2. Insert Transcript
            if (meeting.transcript) {
                for (const segment of meeting.transcript) {
                    insertTranscript.run(
                        meeting.id,
                        segment.speaker,
                        segment.speakerId || null,
                        segment.speakerLabel || null,
                        segment.providerSpeakerId || null,
                        segment.diarizationProvider || null,
                        segment.text,
                        segment.timestamp,
                        segment.startTimestampMs ?? null,
                        segment.endTimestampMs ?? null,
                        segment.speakerVerification ? JSON.stringify(segment.speakerVerification) : null
                    );
                }
            }

            // 3. Insert Interactions
            if (meeting.usage) {
                for (const usage of meeting.usage) {
                    let metadata = null;
                    if (usage.items) {
                        metadata = JSON.stringify(usage.items);
                    } else if (usage.type === 'followup_questions' && usage.answer) {
                        // Sometimes answer is the array for questions, or we store it in metadata
                        // In intelligence manager we pushed: { type: 'followup_questions', answer: fullQuestions }
                        // Let's store that 'answer' (array) in metadata for this type
                        if (Array.isArray(usage.answer)) {
                            metadata = JSON.stringify(usage.answer);
                        }
                    }

                    // Normalization
                    const answerText = Array.isArray(usage.answer) ? null : usage.answer || null;
                    const queryText = usage.question || null;

                    insertInteraction.run(
                        meeting.id,
                        usage.type,
                        usage.timestamp,
                        queryText,
                        answerText,
                        metadata
                    );
                }
            }
        });

        try {
            runTransaction();
            console.log(`[DatabaseManager] Successfully saved meeting ${meeting.id}`);
        } catch (err) {
            console.error(`[DatabaseManager] Failed to save meeting ${meeting.id}`, err);
            throw err;
        }
    }

    public updateMeetingTitle(id: string, title: string): boolean {
        if (!this.db) return false;
        try {
            const stmt = this.db.prepare('UPDATE meetings SET title = ? WHERE id = ?');
            const info = stmt.run(title, id);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to update title for meeting ${id}:`, error);
            return false;
        }
    }

    public updateMeetingSummary(id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }): boolean {
        if (!this.db) return false;

        try {
            // 1. Get current summary_json
            const row = this.db.prepare('SELECT summary_json FROM meetings WHERE id = ?').get(id) as any;
            if (!row) return false;

            const existingData = JSON.parse(row.summary_json || '{}');
            const currentDetailed = existingData.detailedSummary || {};

            // 2. Merge updates
            const newDetailed = {
                ...currentDetailed,
                ...updates
            };

            // Should likely filter out undefined updates if spread doesn't handle them how we want,
            // but spread over undefined is fine. We want to overwrite if provided.
            // If updates.overview is empty string, it overwrites.
            // If updates.overview is undefined, we use ...updates trick:
            // Actually spread only includes own enumerable properties. If I pass { overview: "new" }, it works.

            // However, we need to be careful not to wipe legacySummary if it exists
            const newData = {
                ...existingData,
                detailedSummary: newDetailed
            };

            const jsonStr = JSON.stringify(newData);

            // 3. Write back
            const stmt = this.db.prepare('UPDATE meetings SET summary_json = ? WHERE id = ?');
            const info = stmt.run(jsonStr, id);
            return info.changes > 0;

        } catch (error) {
            console.error(`[DatabaseManager] Failed to update summary for meeting ${id}:`, error);
            return false;
        }
    }

    public getRecentMeetings(limit: number = 50): Meeting[] {
        if (!this.db) return [];

        const stmt = this.db.prepare(`
            SELECT * FROM meetings
            ORDER BY created_at DESC
            LIMIT ?
        `);

        const rows = stmt.all(limit) as any[];

        return rows.map(row => {
            const summaryData = JSON.parse(row.summary_json || '{}');

            // Format duration string if needed, but we typically store ms
            // Let's recreate the 'duration' string "MM:SS" from duration_ms
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at, // Use the stored ISO string
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                calendarEventId: row.calendar_event_id,
                source: row.source as any,
                // We don't load full transcript/usage for list view to keep it light
                transcript: [] as any[],
                usage: [] as any[]
            };
        });
    }

    public getMeetingDetails(id: string): Meeting | null {
        if (!this.db) return null;

        const meetingStmt = this.db.prepare('SELECT * FROM meetings WHERE id = ?');
        const meetingRow = meetingStmt.get(id) as any;

        if (!meetingRow) return null;

        // Get Transcript
        const transcriptStmt = this.db.prepare('SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms ASC');
        const transcriptRows = transcriptStmt.all(id) as any[];

        // Get Usage
        const usageStmt = this.db.prepare('SELECT * FROM ai_interactions WHERE meeting_id = ? ORDER BY timestamp ASC');
        const usageRows = usageStmt.all(id) as any[];

        // Reconstruct
        const summaryData = JSON.parse(meetingRow.summary_json || '{}');
        const minutes = Math.floor(meetingRow.duration_ms / 60000);
        const seconds = Math.floor((meetingRow.duration_ms % 60000) / 1000);
        const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const transcript = transcriptRows.map(row => ({
            speaker: row.speaker,
            speakerId: row.speaker_id || undefined,
            speakerLabel: row.speaker_label || undefined,
            providerSpeakerId: row.provider_speaker_id || undefined,
            diarizationProvider: row.diarization_provider === 'doubao-auc' ? 'doubao-auc' as const : undefined,
            text: row.content,
            timestamp: row.timestamp_ms,
            startTimestampMs: row.start_timestamp_ms ?? undefined,
            endTimestampMs: row.end_timestamp_ms ?? undefined,
            speakerVerification: row.speaker_verification_json ? JSON.parse(row.speaker_verification_json) : undefined
        }));

        const usage = usageRows.map(row => {
            let items: string[] | undefined;
            let answer = row.ai_response;

            if (row.metadata_json) {
                try {
                    const parsed = JSON.parse(row.metadata_json);
                    if (Array.isArray(parsed)) {
                        items = parsed;
                        // Special case: for 'followup_questions', earlier we treated 'answer' as the array in memory
                        // UI expects appropriate field. If type is 'followup_questions', usually answer is null and items has the questions.
                    }
                } catch (e) { console.warn('[DatabaseManager] Failed to parse metadata_json for interaction:', row?.id, e); }
            }

            return {
                type: row.type,
                timestamp: row.timestamp,
                question: row.user_query,
                answer: answer,
                items: items
            };
        });

        return {
            id: meetingRow.id,
            title: meetingRow.title,
            date: meetingRow.created_at,
            duration: durationStr,
            summary: summaryData.legacySummary || '',
            detailedSummary: summaryData.detailedSummary,
            calendarEventId: meetingRow.calendar_event_id,
            source: meetingRow.source,
            transcript: transcript,
            usage: usage
        };
    }

    public deleteMeeting(id: string): boolean {
        if (!this.db) return false;

        try {
            const stmt = this.db.prepare('DELETE FROM meetings WHERE id = ?');
            const info = stmt.run(id);
            console.log(`[DatabaseManager] Deleted meeting ${id}. Changes: ${info.changes}`);
            return info.changes > 0;
        } catch (error) {
            console.error(`[DatabaseManager] Failed to delete meeting ${id}:`, error);
            return false;
        }
    }

    public getUnprocessedMeetings(): Meeting[] {
        if (!this.db) return [];

        // is_processed = 0 means false
        const stmt = this.db.prepare(`
            SELECT * FROM meetings
            WHERE is_processed = 0
            ORDER BY created_at DESC
        `);

        const rows = stmt.all() as any[];

        return rows.map(row => {
            // Reconstruct minimal meeting object for processing
            // We mainly need ID to fetch transcripts later
            const summaryData = JSON.parse(row.summary_json || '{}');
            const minutes = Math.floor(row.duration_ms / 60000);
            const seconds = Math.floor((row.duration_ms % 60000) / 1000);
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            return {
                id: row.id,
                title: row.title,
                date: row.created_at,
                duration: durationStr,
                summary: summaryData.legacySummary || '',
                detailedSummary: summaryData.detailedSummary,
                calendarEventId: row.calendar_event_id,
                source: row.source,
                isProcessed: false,
                transcript: [] as any[], // Fetched separately via getMeetingDetails or manually if needed
                usage: [] as any[]
            };
        });
    }

    public clearAllData(): boolean {
        if (!this.db) return false;

        try {
            // Clear all tables atomically (order matters due to foreign keys,
            // but SQLite handles cascades). Using a transaction ensures we never
            // end up in a half-cleared state if one statement fails.
            this.db.transaction(() => {
                this.db!.exec('DELETE FROM embedding_queue');
                this.db!.exec('DELETE FROM chunk_summaries');
                this.db!.exec('DELETE FROM chunks');
                this.db!.exec('DELETE FROM ai_interactions');
                this.db!.exec('DELETE FROM transcripts');
                this.db!.exec('DELETE FROM meetings');
            })();

            console.log('[DatabaseManager] All data cleared from database.');
            return true;
        } catch (error) {
            console.error('[DatabaseManager] Failed to clear all data:', error);
            return false;
        }
    }

    public seedDemoMeeting() {
        if (!this.db) return;

        // Check if demo meeting already exists
        const existing = this.db.prepare('SELECT id FROM meetings WHERE id = ?').get('demo-meeting');
        if (existing) {
            console.log('[DatabaseManager] Demo meeting already exists, skipping seed.');
            return;
        }

        // Do NOT flush all meetings. Preserving user data is critical.
        // If we really need to clean up old demo data, we should delete only that ID.
        // this.deleteMeeting('demo-meeting'); // Optional safety if we wanted to force update

        const demoId = 'demo-meeting';

        // Set date to today 9:30 AM
        const today = new Date();
        today.setHours(9, 30, 0, 0);

        const durationMs = 300000; // 5 min

        const summaryMarkdown = `# Overview

CueUp is a real-time AI meeting assistant designed to help you stay focused, informed, and fast-moving during calls. Get live insights while you speak, instant answers to questions, and structured notes after every meeting.

# Getting Started

### Start a Session
Click **Start Session** from the dashboard.
Join a scheduled meeting and start directly from the meeting notification.

### During a Meeting
- Use the **five quick action buttons** for real-time assistance
- Show or hide CueUp at any time:
  - **Mac**: Cmd + B
  - **Windows**: Ctrl + B
- Move the widget anywhere on your screen by hovering over the top pill and dragging

# Main Features

## Five Quick Action Buttons
- **What to answer**: Instantly generates a context-aware response to the current topic.
- **Clarify**: Asks a targeted, senior-level clarifying question to establish constraints.
- **Recap**: Generates a comprehensive summary of the conversation so far.
- **Follow Up Question**: Suggests strategic questions you can ask to drive the conversation.
- **Answer**: Manually trigger a response or use voice input to ask specific questions.

## Meeting Insights (Launcher)
- **Smart Note Taking**: Automatically captures key points, action items, and structured summaries.
- **Summary**: A concise high-level brief of the entire meeting.
- **Transcript**: Full real-time speech-to-text transcript, available during and after the call.
- **Usage**: Track your interaction history and see how CueUp assisted you.

## Live Insights
Click **Live Insights** during a call to view:
- Real-time questions and prompts
- Detected keywords and topics
- Context-aware suggestions based on the conversation
- Click any insight to get an instant response.

## AI Chat
- Type your question and press **Enter** or click **Submit**
- Enable **Smart Mode** for advanced reasoning and coding assistance

## Screenshots
- **Full Screen Screenshot**: Cmd + H
- **Selective Screenshot**: Cmd + Shift + H

# Making the Most of CueUp

### Custom Context
Upload resumes, project briefs, sales scripts, or other documents to tailor responses to your workflow. (coming soon).

### Language Preferences
Go to **Settings → Language Preferences** to:
- Change input and output language
- Enable real-time translation during calls

### Undetectability
Unlock the **Undetectability** add-on to keep CueUp invisible during screen sharing.

# Interface Basics

- **Dashboard**: Start meetings and view recent activity
- **Start Session**: Begin a new meeting instantly
- **Settings**: Configure API keys, language, and visibility
- **History**: Review past meetings, notes, and transcripts

# API Setup

1. Open **Settings**
2. Scroll to **Credentials**
3. Add your API keys:
   - **Gemini**
   - **Groq**
4. To enable real-time transcription, select the location of your **Google Cloud service account JSON file**.

If you don’t already have one, follow the steps below to create it.

# Creating a Google Speech-to-Text Service Account

## 1. Create or Select a Project
- Open **Google Cloud Console**
- Create a new project or select an existing one
- Ensure billing is enabled

## 2. Enable Speech-to-Text API
- Go to **APIs & Services → Library**
- Enable **Speech-to-Text API**

## 3. Create a Service Account
- Navigate to **IAM & Admin → Service Accounts**
- Click **Create Service Account**
- **Name**: natively-stt
- **Description**: optional

## 4. Assign Permissions
- Grant the following role: **Speech-to-Text User** (\`roles/speech.client\`)

## 5. Create a JSON Key
- Open the service account
- Go to **Keys → Add Key → Create new key**
- Select **JSON**
- Download the file

**Once downloaded, return to Settings → Credentials in CueUp and select this file to complete setup.**

# Free Google Cloud Credit (New Users)

New Google Cloud accounts receive **$300 in free credits**, valid for 90 days.

To activate:
1. Visit [cloud.google.com](https://cloud.google.com)
2. Click **Get started for free**
3. Sign in with a Google account
4. Add billing details (card required)
5. Activate the free trial

The credit can be used for Speech-to-Text and is sufficient for extended testing and regular usage.

# Support

If you need help with setup or usage, contact us anytime at:
natively.contact@gmail.com`;

        const demoMeeting: Meeting = {
            id: demoId,
            title: "CueUp Demo & Guide",
            date: today.toISOString(),
            duration: "5:00",
            summary: "Complete guide to using CueUp - your real-time AI meeting assistant.",
            detailedSummary: {
                overview: summaryMarkdown,
                actionItems: [],
                keyPoints: []
            },
            transcript: [
                { speaker: 'interviewer', text: "Welcome to CueUp! Let me show you how it works.", timestamp: 0 },
                { speaker: 'user', text: "Thanks! I'm excited to try it out.", timestamp: 5000 },
                { speaker: 'interviewer', text: "You have 5 quick action buttons. 'What to answer' listens to the conversation and suggests what you should say.", timestamp: 10000 },
                { speaker: 'user', text: "That sounds helpful for interviews.", timestamp: 18000 },
                { speaker: 'interviewer', text: "Check out the 'How to Use' section in the notes for API setup instructions.", timestamp: 20000 },
                { speaker: 'interviewer', text: "'Clarify' asks a targeted question to get missing constraints. 'Recap' summarizes the entire conversation so far.", timestamp: 22000 },
                { speaker: 'user', text: "What about the other buttons?", timestamp: 30000 },
                { speaker: 'interviewer', text: "'Follow Up Questions' suggests questions you can ask. 'Answer' lets you speak a question and get an instant response.", timestamp: 35000 },
                { speaker: 'user', text: "Can I take screenshots during calls?", timestamp: 45000 },
                { speaker: 'interviewer', text: "Yes! Press Cmd+H for full screen or Cmd+Shift+H to select an area. The AI will analyze it and help you.", timestamp: 50000 },
                { speaker: 'user', text: "How do I hide CueUp during screen share?", timestamp: 60000 },
                { speaker: 'interviewer', text: "Press Cmd+B to toggle visibility anytime. You can also enable undetectable mode in settings.", timestamp: 65000 },
                { speaker: 'user', text: "This is amazing. What happens after the call?", timestamp: 75000 },
                { speaker: 'interviewer', text: "You get detailed meeting notes with action items, key points, full transcript, and a log of all AI interactions.", timestamp: 80000 }
            ],
            usage: [
                { type: 'assist', timestamp: 15000, question: 'What features does CueUp have?', answer: 'CueUp offers 5 quick action buttons, screenshot analysis, real-time transcription, and comprehensive meeting notes.' },
                { type: 'followup', timestamp: 40000, question: 'How do the action buttons work?', answer: 'Each button serves a specific purpose: suggest answers, clarify questions, recap conversations, generate follow-up questions, or get instant voice-to-answer responses.' }
            ],
            isProcessed: true
        };

        this.saveMeeting(demoMeeting, today.getTime(), durationMs);
        console.log('[DatabaseManager] Seeded demo meeting.');
    }
}
