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

export function getSpeakerEmbeddingModelHealth(): SpeakerVerificationHealth {
  try {
    const modelFile = getDefaultSpeakerEmbeddingModelFile();
    if (!fs.existsSync(modelFile)) {
      resetSharedSpeakerEmbeddingExtractor();
      return { state: 'model_missing', message: '本地声纹模型缺失，请重新安装模型。' };
    }
    if (latestExtractorInitializationFailed) {
      resetSharedSpeakerEmbeddingExtractor();
      return { state: 'model_error', message: '本地声纹模型加载失败。' };
    }
    return { state: 'ready' };
  } catch (error: any) {
    resetSharedSpeakerEmbeddingExtractor();
    if (error?.message === 'speaker_embedding_model_not_installed') {
      return { state: 'model_missing', message: '本地声纹模型缺失，请重新安装模型。' };
    }
    return { state: 'model_error', message: '本地声纹模型加载失败。' };
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
