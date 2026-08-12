/**
 * ModelPreloader — keeps one warm Whisper worker alive in the background
 * so the first recording session starts instantly instead of waiting 2–5s
 * for the model to load off disk into ONNX Runtime.
 *
 * Usage pattern:
 *   1. Call preload(modelId) when the app launches or when local-whisper is selected.
 *   2. When LocalWhisperSTT.start() fires, call takeWarmWorker(modelId).
 *      If a warm worker exists it is handed off (no startup delay).
 *      If not, LocalWhisperSTT falls back to spawning its own worker normally.
 *
 * Only one warm lease is kept alive at a time. Recording channels acquire
 * leases from the same keyed pool, so matching mic/system configurations reuse
 * the already-loaded model session instead of spawning a second worker.
 */

import { buildWorkerInitMessage } from './inferenceConfig';
import { resolveWhisperWorkerPath } from './workerPathResolver';
import {
    localSttWorkerPool,
    type LocalSttWorkerConfig,
    type LocalSttWorkerLease,
} from '../LocalSttWorkerPool';

export function createWhisperWorkerConfig(modelId: string): LocalSttWorkerConfig {
    const initMessage = buildWorkerInitMessage(modelId);
    return {
        provider: 'whisper',
        modelId,
        executionProviders: initMessage.executionProviders,
        dtype: initMessage.dtype,
        sessionConfig: { cacheDir: initMessage.cacheDir },
        workerPath: resolveWhisperWorkerPath(),
        initMessage,
        audioField: 'audio',
    };
}

class ModelPreloader {
    private warmWorker: LocalSttWorkerLease | null = null;
    private warmModelId: string | null = null;
    private loadingWorker: LocalSttWorkerLease | null = null;
    private pendingModelId: string | null = null;
    private loading = false;

    /**
     * Warm up a worker for the given model ID.
     * Safe to call multiple times — no-ops if already warm or loading for the same model.
     * Cancels an in-progress load if a different model is requested.
     */
    preload(modelId: string): void {
        if (this.warmModelId === modelId && this.warmWorker) return;
        if (this.pendingModelId === modelId && this.loading) return;

        // Cancel any in-progress load for a different model
        if (this.loadingWorker) {
            this.loadingWorker.terminate();
            this.loadingWorker = null;
        }
        // Tear down warm worker for a different model
        if (this.warmWorker) {
            this.warmWorker.terminate();
            this.warmWorker = null;
            this.warmModelId = null;
        }

        this.loading = true;
        this.pendingModelId = modelId;

        console.log(`[ModelPreloader] Warming worker for ${modelId}...`);

        const w = localSttWorkerPool.acquire(createWhisperWorkerConfig(modelId), 'mic');
        this.loadingWorker = w;

        w.on('message', (msg: any) => {
            if (msg.type === 'ready') {
                console.log(`[ModelPreloader] Worker warm for ${modelId}`);
                this.warmWorker = w;
                this.loadingWorker = null;
                this.warmModelId = modelId;
                this.pendingModelId = null;
                this.loading = false;
            } else if (msg.type === 'error') {
                console.warn(`[ModelPreloader] Worker init failed: ${msg.message}`);
                w.terminate();
                this.loadingWorker = null;
                this.pendingModelId = null;
                this.loading = false;
            }
        });

        w.on('error', (err) => {
            console.warn('[ModelPreloader] Worker error:', err.message);
            w.terminate();
            this.loadingWorker = null;
            this.pendingModelId = null;
            this.loading = false;
        });

    }

    /**
     * Hand off the warm worker to a caller and clear the cache.
     * Returns null if no warm worker is available for that model ID.
     */
    takeWarmWorker(modelId: string): LocalSttWorkerLease | null {
        if (this.warmModelId === modelId && this.warmWorker) {
            const w = this.warmWorker;
            this.warmWorker = null;
            this.warmModelId = null;
            w.removeAllListeners('message');
            w.removeAllListeners('error');
            console.log(`[ModelPreloader] Handing off warm worker for ${modelId}`);
            return w;
        }
        return null;
    }

    isWarm(modelId: string): boolean {
        return this.warmModelId === modelId && this.warmWorker !== null;
    }

    terminate(): void {
        this.loadingWorker?.terminate();
        this.loadingWorker = null;
        this.warmWorker?.terminate();
        this.warmWorker = null;
        this.warmModelId = null;
        this.pendingModelId = null;
        this.loading = false;
    }
}

export const modelPreloader = new ModelPreloader();
