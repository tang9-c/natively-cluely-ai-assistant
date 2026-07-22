// @huggingface/transformers is ESM-only — must use dynamic import()
import path from 'path';
import { app } from 'electron';
import { IEmbeddingProvider } from './IEmbeddingProvider';
import {
  EmbeddingModelCandidate,
  loadFirstValidatedEmbeddingModel,
} from './LocalEmbeddingModelValidator';
import { embeddingSpaceKey } from '../embeddingSpace';
import { telemetryService } from '../../services/telemetry/TelemetryService';

export class LocalEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'local';
  readonly dimensions = 384; // paraphrase-multilingual-MiniLM-L12-v2
  readonly model = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
  readonly space: string;

  private pipe: any = null;
  private loadingPromise: Promise<void> | null = null; // prevents concurrent init races
  private modelPath: string | null = null;
  // Mirrors the IntentClassifierWorker pattern: once Transformers.js WASM
  // init has failed (missing binding, proxy blocked, etc.), don't keep
  // retrying on every embed() call — surface the failure so callers can
  // switch to a cloud provider instead of paying the multi-second WASM
  // boot cost on every RAG retrieval.
  private loadFailed = false;

  constructor() {
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  private resolveModelCandidates(): EmbeddingModelCandidate[] {
    const downloadedModelsPath =
      typeof app.getPath === 'function'
        ? path.join(app.getPath('userData'), 'models')
        : path.join(app.getAppPath(), 'resources', 'models');
    const bundledModelsPath = path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      'models'
    );
    return [
      { source: 'downloaded', rootPath: downloadedModelsPath },
      { source: 'bundled', rootPath: bundledModelsPath },
    ];
  }

  async isAvailable(): Promise<boolean> {
    if (process.env.CUEUP_TEST_LOCAL_EMBEDDING_AVAILABLE === '1') {
      return true;
    }

    // Local model is ALWAYS available after install — this is the guarantee
    try {
      await this.ensureLoaded();
      return true;
    } catch {
      console.error('[LocalEmbeddingProvider] Model failed to load', { code: 'validation_failed' });
      return false;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipe) return;

    // If a previous load attempt already failed, fail fast instead of paying
    // the full WASM boot cost again. EmbeddingPipeline catches this in
    // isAvailable() (returns false) and RAGManager falls through to whatever
    // cloud provider is configured.
    if (this.loadFailed) {
      throw new Error('[LocalEmbeddingProvider] Local embedding load previously failed; cloud provider required');
    }

    // If another caller already kicked off loading, wait for that same promise
    // rather than launching a second concurrent pipeline() call.
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = (async () => {
      // Use new Function() to force a true ESM dynamic import at runtime.
      // TypeScript with module:commonjs rewrites `await import(...)` to
      // `Promise.resolve().then(() => require(...))`, which fails for ESM-only
      // packages like @huggingface/transformers. The new Function() trick is opaque
      // to the TypeScript compiler so it is left as a real import() call.
      const { pipeline, env } = await (new Function('return import("@huggingface/transformers")')()) as any;

      // Route ONNX/WASM through a worker thread. Without this, transformers.js
      // loads WASM on the main thread where Electron's main-process origin
      // policy + V8 sandboxing can block the cross-origin WASM fetch on first
      // boot, which previously caused ensureLoaded() to throw on every cold
      // start and propagate as a hard RAG init failure (no cloud fallback).
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.proxy = true;
      }

      const loaded = await loadFirstValidatedEmbeddingModel({
        candidates: this.resolveModelCandidates(),
        dimensions: this.dimensions,
        createPipeline: async (rootPath) => {
          env.cacheDir = rootPath;
          env.localModelPath = rootPath;
          env.allowLocalModels = true;
          env.allowRemoteModels = false;
          return pipeline('feature-extraction', this.model, {
            local_files_only: true,
            model_file_name: 'model_int8',
          });
        },
        onValidation: (event) => {
          console.info('[LocalEmbeddingProvider] Model validation', event);
          telemetryService.track({
            name: 'rag_embedding_model_validation',
            status: event.status,
            properties: {
              source: event.source,
              stage: event.stage,
              code: event.code,
              appVersion: typeof app.getVersion === 'function' ? app.getVersion() : 'unknown',
            },
          });
        },
      });
      this.modelPath = loaded.rootPath;
      this.pipe = loaded.pipeline;
    })();

    try {
      await this.loadingPromise;
    } catch (e) {
      // Reset so a future call can retry, but mark the provider as
      // permanently-failed-for-this-process so embed() callers don't pay the
      // WASM boot cost on every RAG retrieval after a failed first init.
      this.loadingPromise = null;
      this.loadFailed = true;
      throw e;
    }
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const output = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // paraphrase-multilingual-MiniLM-L12-v2 is symmetric
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();
    // transformers.js handles batching internally
    const output = await this.pipe(texts, { pooling: 'mean', normalize: true });
    // output.data is flat [n * 384], reshape it
    const batchSize = texts.length;
    const result: number[][] = [];
    for (let i = 0; i < batchSize; i++) {
      result.push(Array.from(output.data.slice(i * this.dimensions, (i + 1) * this.dimensions)));
    }
    return result;
  }
}
