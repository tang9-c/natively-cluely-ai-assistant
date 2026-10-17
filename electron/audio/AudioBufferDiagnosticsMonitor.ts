export interface AudioBufferSnapshot {
    droppedSamples: number;
    dropEvents: number;
    receivedSamples?: number;
    actualDeviceId?: string;
}

export interface AudioBufferContext {
    backend: string;
    nativeSampleRate: number;
    emittedSampleRate: number;
}

interface DiagnosticsLogger {
    log(message: string, properties: Record<string, string | number>): void;
    warn(message: string, properties: Record<string, string | number>): void;
}

interface AudioBufferDiagnosticsMonitorOptions {
    channel: 'mic' | 'system';
    getNativeDiagnostics?: () => AudioBufferSnapshot;
    getContext: () => AudioBufferContext;
    isVerbose: () => boolean;
    logger?: DiagnosticsLogger;
    intervalMs?: number;
    onHeartbeat?: (receivedSamples: number) => void;
}

const DEFAULT_INTERVAL_MS = 5_000;

function normalizeCounter(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;
}

export class AudioBufferDiagnosticsMonitor {
    private readonly channel: 'mic' | 'system';
    private readonly getNativeDiagnostics?: () => AudioBufferSnapshot;
    private readonly getContext: () => AudioBufferContext;
    private readonly isVerbose: () => boolean;
    private readonly logger: DiagnosticsLogger;
    private readonly intervalMs: number;
    private readonly optionsHeartbeat?: (receivedSamples: number) => void;
    private timer: NodeJS.Timeout | null = null;
    private active = false;
    private previousSnapshot: AudioBufferSnapshot | null = null;
    private chunkCount = 0;
    private totalBytes = 0;
    private lastChunkAtMs: number | null = null;
    private intervalTotalMs = 0;
    private intervalCount = 0;
    private maxIntervalMs = 0;
    private lastSummaryAtMs: number | null = null;

    constructor(options: AudioBufferDiagnosticsMonitorOptions) {
        this.channel = options.channel;
        this.getNativeDiagnostics = options.getNativeDiagnostics;
        this.getContext = options.getContext;
        this.isVerbose = options.isVerbose;
        this.logger = options.logger ?? console;
        this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
        this.optionsHeartbeat = options.onHeartbeat;
    }

    public start(): void {
        this.stop();
        this.active = true;
        this.previousSnapshot = this.readSnapshot();
        this.timer = setInterval(() => this.poll(), this.intervalMs);
        this.timer.unref?.();
    }

    public recordChunk(byteLength: number, atMs: number = Date.now()): void {
        if (!this.active) return;

        this.chunkCount += 1;
        this.totalBytes += normalizeCounter(byteLength);
        if (this.lastChunkAtMs !== null) {
            const intervalMs = Math.max(0, atMs - this.lastChunkAtMs);
            this.intervalTotalMs += intervalMs;
            this.intervalCount += 1;
            this.maxIntervalMs = Math.max(this.maxIntervalMs, intervalMs);
        }
        this.lastChunkAtMs = atMs;
    }

    public poll(): void {
        if (!this.active) return;

        const snapshot = this.readSnapshot();
        if (!snapshot) return;

        const previous = this.previousSnapshot ?? snapshot;
        const droppedSamplesDelta = Math.max(0, snapshot.droppedSamples - previous.droppedSamples);
        const dropEventsDelta = Math.max(0, snapshot.dropEvents - previous.dropEvents);
        this.previousSnapshot = snapshot;
        if (snapshot.receivedSamples !== undefined) this.optionsHeartbeat?.(snapshot.receivedSamples);

        const context = this.readContext();
        if (droppedSamplesDelta > 0 || dropEventsDelta > 0) {
            this.logger.warn('[AudioBufferDiagnostics] Ring buffer overflow', {
                channel: this.channel,
                backend: context.backend,
                droppedSamplesDelta,
                dropEventsDelta,
                droppedSamplesTotal: snapshot.droppedSamples,
            });
        }

        if (this.isVerbose() && (this.lastSummaryAtMs === null || Date.now() - this.lastSummaryAtMs >= DEFAULT_INTERVAL_MS)) {
            this.lastSummaryAtMs = Date.now();
            this.logger.log('[AudioBufferDiagnostics] Capture summary', {
                channel: this.channel,
                backend: context.backend,
                nativeSampleRate: context.nativeSampleRate,
                emittedSampleRate: context.emittedSampleRate,
                chunkCount: this.chunkCount,
                totalBytes: this.totalBytes,
                averageIntervalMs: this.intervalCount > 0
                    ? Math.round(this.intervalTotalMs / this.intervalCount)
                    : 0,
                maxIntervalMs: Math.round(this.maxIntervalMs),
                droppedSamplesTotal: snapshot.droppedSamples,
                dropEventsTotal: snapshot.dropEvents,
            });
        }
    }

    public stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.active = false;
        this.previousSnapshot = null;
        this.chunkCount = 0;
        this.totalBytes = 0;
        this.lastChunkAtMs = null;
        this.intervalTotalMs = 0;
        this.intervalCount = 0;
        this.maxIntervalMs = 0;
        this.lastSummaryAtMs = null;
    }

    private readSnapshot(): AudioBufferSnapshot | null {
        if (!this.getNativeDiagnostics) return null;
        try {
            const snapshot = this.getNativeDiagnostics();
            if (!snapshot || typeof snapshot !== 'object') return null;
            return {
                droppedSamples: normalizeCounter(snapshot.droppedSamples),
                dropEvents: normalizeCounter(snapshot.dropEvents),
                receivedSamples: Number.isSafeInteger(snapshot.receivedSamples) && snapshot.receivedSamples! >= 0
                    ? snapshot.receivedSamples : undefined,
            };
        } catch {
            return null;
        }
    }

    private readContext(): AudioBufferContext {
        try {
            const context = this.getContext();
            return {
                backend: typeof context.backend === 'string' ? context.backend : 'unknown',
                nativeSampleRate: normalizeCounter(context.nativeSampleRate),
                emittedSampleRate: normalizeCounter(context.emittedSampleRate),
            };
        } catch {
            return { backend: 'unknown', nativeSampleRate: 0, emittedSampleRate: 0 };
        }
    }
}
