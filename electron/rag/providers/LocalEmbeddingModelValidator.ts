import fs from 'fs';
import path from 'path';

export const LOCAL_EMBEDDING_MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const LOCAL_EMBEDDING_REQUIRED_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_int8.onnx',
] as const;
export const LOCAL_EMBEDDING_VALIDATION_TEXT = 'CueUp 本地模型可用性验证';

export type EmbeddingModelSource = 'downloaded' | 'bundled';
export type EmbeddingModelValidationCode =
  | 'missing_files'
  | 'load_failed'
  | 'inference_failed'
  | 'invalid_dimensions'
  | 'non_finite_values'
  | 'ready';

export interface EmbeddingModelCandidate {
  source: EmbeddingModelSource;
  rootPath: string;
}

export interface EmbeddingModelValidationEvent {
  source: EmbeddingModelSource;
  stage: 'files' | 'load' | 'inference' | 'output';
  status: 'success' | 'failed';
  code: EmbeddingModelValidationCode;
}

export type EmbeddingPipelineLike = (
  text: string,
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ data: ArrayLike<number> }>;

export interface ValidatedEmbeddingModel {
  source: EmbeddingModelSource;
  rootPath: string;
  pipeline: EmbeddingPipelineLike;
}

interface LoadOptions {
  candidates: EmbeddingModelCandidate[];
  dimensions: number;
  createPipeline: (rootPath: string) => Promise<EmbeddingPipelineLike>;
  onValidation?: (event: EmbeddingModelValidationEvent) => void;
}

function missingRequiredFiles(rootPath: string): string[] {
  const modelDir = path.join(rootPath, LOCAL_EMBEDDING_MODEL_ID);
  return LOCAL_EMBEDDING_REQUIRED_FILES.filter(
    (relativePath) => !fs.existsSync(path.join(modelDir, relativePath)),
  );
}

export async function loadFirstValidatedEmbeddingModel(
  options: LoadOptions,
): Promise<ValidatedEmbeddingModel> {
  for (const candidate of options.candidates) {
    if (missingRequiredFiles(candidate.rootPath).length > 0) {
      options.onValidation?.({
        source: candidate.source,
        stage: 'files',
        status: 'failed',
        code: 'missing_files',
      });
      continue;
    }

    let pipeline: EmbeddingPipelineLike;
    try {
      pipeline = await options.createPipeline(candidate.rootPath);
    } catch {
      options.onValidation?.({
        source: candidate.source,
        stage: 'load',
        status: 'failed',
        code: 'load_failed',
      });
      continue;
    }

    let vector: number[];
    try {
      const result = await pipeline(LOCAL_EMBEDDING_VALIDATION_TEXT, {
        pooling: 'mean',
        normalize: true,
      });
      vector = Array.from(result.data);
    } catch {
      options.onValidation?.({
        source: candidate.source,
        stage: 'inference',
        status: 'failed',
        code: 'inference_failed',
      });
      continue;
    }

    if (vector.length !== options.dimensions) {
      options.onValidation?.({
        source: candidate.source,
        stage: 'output',
        status: 'failed',
        code: 'invalid_dimensions',
      });
      continue;
    }
    if (!vector.every(Number.isFinite)) {
      options.onValidation?.({
        source: candidate.source,
        stage: 'output',
        status: 'failed',
        code: 'non_finite_values',
      });
      continue;
    }

    options.onValidation?.({
      source: candidate.source,
      stage: 'output',
      status: 'success',
      code: 'ready',
    });
    return { source: candidate.source, rootPath: candidate.rootPath, pipeline };
  }

  const checkedSources = options.candidates.map((candidate) => candidate.source).join(', ');
  throw new Error(`No validated local embedding model is available (checked sources: ${checkedSources})`);
}
