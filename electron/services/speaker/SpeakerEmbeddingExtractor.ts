import path from 'path';
import fs from 'fs';
import { Worker } from 'worker_threads';
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
): SpeakerVerificationHealth {
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

    const extractor = getSharedSpeakerEmbeddingExtractor();
    const embedding = extractor.extractorSmokeTest(speakerEmbeddingSmokeSamples());
    if (embedding.length !== extractor.dim) {
      throw new Error('speaker_embedding_smoke_test_dim_mismatch');
    }
    return {
      state: 'ready',
      message: '模型正常',
      modelInstalled: true,
      modelFile,
      modelDim: extractor.dim,
      loadLatencyMs: Math.max(0, Date.now() - startedAt),
    };
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

export function getSharedSpeakerEmbeddingExtractor(): SherpaSpeakerEmbeddingExtractor {
  const modelFile = getDefaultSpeakerEmbeddingModelFile();
  if (singleton && singletonModelFile === modelFile) {
    return singleton;
  }
  singleton = new SherpaSpeakerEmbeddingExtractor({ modelFile });
  singletonModelFile = modelFile;
  return singleton;
}

export function resetSharedSpeakerEmbeddingExtractor(): void {
  singleton = null;
  singletonModelFile = null;
}

export class SherpaSpeakerEmbeddingExtractor implements SpeakerEmbeddingExtractorLike {
  readonly modelId: string;
  readonly version = 'sherpa-onnx-node';
  readonly dim: number;
  private readonly modelFile: string;
  private readonly extractor: any;
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pendingWorkerRequests = new Map<number, {
    resolve: (embedding: Float32Array) => void;
    reject: (error: Error) => void;
  }>();

  constructor(options: SherpaSpeakerEmbeddingExtractorOptions = {}) {
    try {
      const modelFile = options.modelFile ?? getDefaultSpeakerEmbeddingModelFile();
      this.modelFile = modelFile;
      const sherpa = require('sherpa-onnx-node');
      this.extractor = new sherpa.SpeakerEmbeddingExtractor({
        model: modelFile,
        numThreads: options.numThreads ?? 1,
        provider: 'cpu',
        debug: 0,
      });
      this.modelId = path.basename(modelFile);
      this.dim = this.extractor.dim;
      latestExtractorInitializationFailed = false;
    } catch (error) {
      latestExtractorInitializationFailed = true;
      throw error;
    }
  }

  async extract(samples16k: Float32Array): Promise<Float32Array> {
    return this.computeEmbeddingInWorker(samples16k);
  }

  extractorSmokeTest(samples16k: Float32Array): Float32Array {
    return this.computeEmbedding(samples16k);
  }

  private computeEmbedding(samples16k: Float32Array): Float32Array {
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ samples: samples16k, sampleRate: 16000 });
    stream.inputFinished();
    if (!this.extractor.isReady(stream)) {
      throw new Error('speaker_embedding_stream_not_ready');
    }
    const embedding = this.extractor.compute(stream, false);
    return new Float32Array(embedding);
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const workerPath = path.join(__dirname, 'SpeakerEmbeddingExtractorWorker.js');
    const worker = new Worker(workerPath, {
      workerData: {
        modelFile: this.modelFile,
      },
    });
    worker.on('message', (message: {
      requestId?: number;
      embedding?: ArrayBuffer;
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
      pending.resolve(new Float32Array(message.embedding));
    });
    const rejectAll = (error: Error) => {
      for (const pending of this.pendingWorkerRequests.values()) {
        pending.reject(error);
      }
      this.pendingWorkerRequests.clear();
      this.worker = null;
    };
    worker.on('error', rejectAll);
    worker.on('exit', (code) => {
      if (code !== 0) {
        rejectAll(new Error('speaker_embedding_worker_exited'));
      }
      this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  private computeEmbeddingInWorker(samples16k: Float32Array): Promise<Float32Array> {
    const requestId = this.nextRequestId++;
    const worker = this.getWorker();
    const samplesCopy = new Float32Array(samples16k);
    return new Promise((resolve, reject) => {
      this.pendingWorkerRequests.set(requestId, { resolve, reject });
      worker.postMessage({ requestId, samples: samplesCopy.buffer }, [samplesCopy.buffer]);
    });
  }
}
