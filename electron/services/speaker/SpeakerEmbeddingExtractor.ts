import path from 'path';
import fs from 'fs';
import { fork, type ChildProcess } from 'child_process';
import { resolveSpeakerEmbeddingWorkerPath } from './speakerEmbeddingWorkerPathResolver';
import type { SpeakerEmbeddingExtractorLike } from './speakerVerificationTypes';
import type { SpeakerVerificationHealth } from './speakerVerificationTypes';

export interface SherpaSpeakerEmbeddingExtractorOptions {
  modelFile?: string;
  numThreads?: number;
}

let latestExtractorInitializationFailed = false;
let singleton: SherpaSpeakerEmbeddingExtractor | null = null;
let singletonModelFile: string | null = null;

export interface SpeakerEmbeddingModelHealthOptions {
  smokeTest?: boolean;
}

export function getDefaultSpeakerEmbeddingModelFile(): string {
  if (process.env.SPEAKER_EMBEDDING_MODEL_FILE) {
    return process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  }
  const {
    SPEAKER_EMBEDDING_MODEL_ID,
    SPEAKER_EMBEDDING_MODEL_RELATIVE_PATH,
    resolveLocalModelFile,
  } = require('../LocalModelManager');
  const modelFile = resolveLocalModelFile(
    SPEAKER_EMBEDDING_MODEL_ID,
    SPEAKER_EMBEDDING_MODEL_RELATIVE_PATH,
  );
  if (!modelFile) {
    throw new Error('speaker_embedding_model_not_installed');
  }
  return modelFile;
}

function speakerEmbeddingSmokeSamples(): Float32Array {
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate * 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((i / sampleRate) * 220 * Math.PI * 2) * 0.02;
  }
  return samples;
}

export function getSpeakerEmbeddingModelHealth(
  options: SpeakerEmbeddingModelHealthOptions = {},
): SpeakerVerificationHealth | Promise<SpeakerVerificationHealth> {
  const startedAt = Date.now();
  try {
    const modelFile = getDefaultSpeakerEmbeddingModelFile();
    if (!fs.existsSync(modelFile)) {
      resetSharedSpeakerEmbeddingExtractor();
      return {
        state: 'model_missing',
        message: '模型缺失',
        modelInstalled: false,
        modelFile,
        loadLatencyMs: Math.max(0, Date.now() - startedAt),
      };
    }
    if (latestExtractorInitializationFailed && !options.smokeTest) {
      resetSharedSpeakerEmbeddingExtractor();
      return {
        state: 'model_error',
        message: '模型加载失败',
        modelInstalled: true,
        modelFile,
        loadLatencyMs: Math.max(0, Date.now() - startedAt),
        error: 'speaker_embedding_model_previous_load_failed',
      };
    }

    if (!options.smokeTest) {
      return {
        state: 'ready',
        message: '模型正常',
        modelInstalled: true,
        modelFile,
        loadLatencyMs: Math.max(0, Date.now() - startedAt),
      };
    }

    return getSpeakerEmbeddingModelSmokeHealth(modelFile, startedAt);
  } catch (error: any) {
    resetSharedSpeakerEmbeddingExtractor();
    latestExtractorInitializationFailed = true;
    if (error?.message === 'speaker_embedding_model_not_installed') {
      latestExtractorInitializationFailed = false;
      return {
        state: 'model_missing',
        message: '模型缺失',
        modelInstalled: false,
        loadLatencyMs: Math.max(0, Date.now() - startedAt),
      };
    }
    return {
      state: 'model_error',
      message: '模型加载失败',
      modelInstalled: true,
      loadLatencyMs: Math.max(0, Date.now() - startedAt),
      error: 'speaker_embedding_model_health_check_failed',
    };
  }
}

async function getSpeakerEmbeddingModelSmokeHealth(
  modelFile: string,
  startedAt: number,
): Promise<SpeakerVerificationHealth> {
  try {
    const extractor = getSharedSpeakerEmbeddingExtractor();
    const embedding = await extractor.extract(speakerEmbeddingSmokeSamples());
    latestExtractorInitializationFailed = false;
    return {
      state: 'ready',
      message: '模型正常',
      modelInstalled: true,
      modelFile,
      modelDim: extractor.dim,
      loadLatencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch {
    resetSharedSpeakerEmbeddingExtractor();
    latestExtractorInitializationFailed = true;
    return {
      state: 'model_error',
      message: '模型加载失败',
      modelInstalled: true,
      loadLatencyMs: Math.max(0, Date.now() - startedAt),
      error: 'speaker_embedding_model_health_check_failed',
    };
  }
}

export function getSharedSpeakerEmbeddingExtractor(): SherpaSpeakerEmbeddingExtractor {
  const modelFile = getDefaultSpeakerEmbeddingModelFile();
  if (singleton && singletonModelFile === modelFile) {
    return singleton;
  }
  singleton?.dispose();
  singleton = new SherpaSpeakerEmbeddingExtractor({ modelFile });
  singletonModelFile = modelFile;
  return singleton;
}

export function resetSharedSpeakerEmbeddingExtractor(): void {
  singleton?.dispose();
  singleton = null;
  singletonModelFile = null;
}

export class SherpaSpeakerEmbeddingExtractor implements SpeakerEmbeddingExtractorLike {
  readonly modelId: string;
  readonly version = 'sherpa-onnx-node';
  dim: number;
  private readonly modelFile: string;
  private worker: ChildProcess | null = null;
  private nextRequestId = 1;
  private disposed = false;
  private readonly pendingWorkerRequests = new Map<number, {
    resolve: (embedding: Float32Array) => void;
    reject: (error: Error) => void;
  }>();

  constructor(options: SherpaSpeakerEmbeddingExtractorOptions = {}) {
    const modelFile = options.modelFile ?? getDefaultSpeakerEmbeddingModelFile();
    this.modelFile = modelFile;
    this.modelId = path.basename(modelFile);
    this.dim = 0;
  }

  async extract(samples16k: Float32Array, options: { signal?: AbortSignal } = {}): Promise<Float32Array> {
    if (this.disposed) {
      throw new Error('speaker_embedding_extractor_disposed');
    }
    return this.computeEmbeddingInWorker(samples16k, options);
  }

  dispose(): void {
    this.disposed = true;
    this.rejectPendingWorkerRequests(new Error('speaker_embedding_worker_disposed'));
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.kill();
    }
  }

  private getWorker(): ChildProcess {
    if (this.disposed) {
      throw new Error('speaker_embedding_extractor_disposed');
    }
    if (this.worker) return this.worker;
    const workerPath = resolveSpeakerEmbeddingWorkerPath();
    const worker = fork(workerPath, [], {
      env: {
        ...process.env,
        SPEAKER_EMBEDDING_WORKER_MODEL_FILE: this.modelFile,
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    worker.on('message', (message: {
      requestId?: number;
      embedding?: number[];
      error?: string;
    }) => {
      if (typeof message.requestId !== 'number') return;
      const pending = this.pendingWorkerRequests.get(message.requestId);
      if (!pending) return;
      this.pendingWorkerRequests.delete(message.requestId);
      if (message.error) {
        pending.reject(new Error(message.error));
        return;
      }
      if (!message.embedding) {
        pending.reject(new Error('speaker_embedding_worker_missing_embedding'));
        return;
      }
      if (
        message.embedding.length === 0
        || !message.embedding.every(value => typeof value === 'number' && Number.isFinite(value))
      ) {
        pending.reject(new Error('speaker_embedding_worker_invalid_embedding'));
        return;
      }
      const embedding = Float32Array.from(message.embedding);
      if (this.dim > 0 && embedding.length !== this.dim) {
        pending.reject(new Error('speaker_embedding_worker_dim_mismatch'));
        return;
      }
      this.dim = embedding.length;
      pending.resolve(embedding);
    });
    const rejectAll = (error: Error, sourceWorker: ChildProcess) => {
      if (this.worker !== sourceWorker) {
        return;
      }
      this.rejectPendingWorkerRequests(error);
      this.worker = null;
    };
    worker.on('error', (error) => rejectAll(error, worker));
    worker.on('exit', (code, signal) => {
      if (this.worker !== worker) {
        return;
      }
      if (this.pendingWorkerRequests.size > 0 || code !== 0 || signal) {
        rejectAll(new Error(signal ? 'speaker_embedding_worker_signaled' : 'speaker_embedding_worker_exited'), worker);
        return;
      }
      this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  private computeEmbeddingInWorker(
    samples16k: Float32Array,
    options: { signal?: AbortSignal } = {},
  ): Promise<Float32Array> {
    const requestId = this.nextRequestId++;
    const worker = this.getWorker();
    const samplesCopy = new Float32Array(samples16k);
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('speaker_embedding_request_aborted'));
        return;
      }
      const abortListener = () => {
        this.pendingWorkerRequests.delete(requestId);
        if (this.worker === worker) {
          this.rejectPendingWorkerRequests(new Error('speaker_embedding_worker_aborted'));
          this.worker = null;
          worker.kill();
        }
        reject(new Error('speaker_embedding_request_aborted'));
      };
      const cleanup = () => {
        options.signal?.removeEventListener('abort', abortListener);
      };
      this.pendingWorkerRequests.set(requestId, {
        resolve: (embedding) => {
          cleanup();
          resolve(embedding);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      options.signal?.addEventListener('abort', abortListener, { once: true });
      try {
        worker.send?.({ requestId, samples: Array.from(samplesCopy) });
      } catch (error: any) {
        cleanup();
        this.pendingWorkerRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error('speaker_embedding_worker_post_failed'));
      }
    });
  }

  private rejectPendingWorkerRequests(error: Error): void {
    for (const pending of this.pendingWorkerRequests.values()) {
      pending.reject(error);
    }
    this.pendingWorkerRequests.clear();
  }
}
