import path from 'path';
import type { SpeakerEmbeddingExtractorLike } from './speakerVerificationTypes';

export interface SherpaSpeakerEmbeddingExtractorOptions {
  modelFile?: string;
  numThreads?: number;
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

export class SherpaSpeakerEmbeddingExtractor implements SpeakerEmbeddingExtractorLike {
  readonly modelId: string;
  readonly version = 'sherpa-onnx-node';
  readonly dim: number;
  private readonly extractor: any;

  constructor(options: SherpaSpeakerEmbeddingExtractorOptions = {}) {
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
  }

  async extract(samples16k: Float32Array): Promise<Float32Array> {
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ samples: samples16k, sampleRate: 16000 });
    stream.inputFinished();
    if (!this.extractor.isReady(stream)) {
      throw new Error('speaker_embedding_stream_not_ready');
    }
    return this.extractor.compute(stream);
  }
}
