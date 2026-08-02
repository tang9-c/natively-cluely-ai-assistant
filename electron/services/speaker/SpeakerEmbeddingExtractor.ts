import path from 'path';
import fs from 'fs';
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
    if (error?.message === 'speaker_embedding_model_not_installed') {
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
  private readonly extractor: any;

  constructor(options: SherpaSpeakerEmbeddingExtractorOptions = {}) {
    try {
      const modelFile = options.modelFile ?? getDefaultSpeakerEmbeddingModelFile();
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
    return this.computeEmbedding(samples16k);
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
}
