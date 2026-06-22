// electron/services/LocalModelManager.ts
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import {
  INTENT_CLASSIFIER_MODEL_ARTIFACT,
  buildIntentClassifierPipelineOptions,
  validateIntentClassifierModelArtifact,
} from '../llm/IntentClassifierModelArtifact';

export interface LocalModelInfo {
  id: string;
  name: string;
  description: string;
  sizeMb: number;
  task: string;
  category?: 'base' | 'optional-enhancement';
  requiresExplicitEnable?: boolean;
  status: 'available' | 'missing' | 'downloading' | 'error';
  source?: 'downloaded' | 'bundled';
  errorMessage?: string;
}

interface ModelDefinition {
  id: string;
  name: string;
  description: string;
  sizeMb: number;
  task: string;
  category?: 'base' | 'optional-enhancement';
  requiresExplicitEnable?: boolean;
  requiredFiles: string[]; // relative to model root, e.g. 'onnx/model_int8.onnx'
  pipelineOptions?: Record<string, unknown>;
  validate?: (rootDir: string) => { ok: boolean; error?: string };
}

const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    name: '本地嵌入模型',
    description: '用于本地 RAG 向量检索',
    sizeMb: 129,
    task: 'feature-extraction',
    category: 'base',
    requiredFiles: ['onnx/model_int8.onnx'],
  },
  {
    id: INTENT_CLASSIFIER_MODEL_ARTIFACT.modelId,
    name: '本地多语言意图增强（可选）',
    description: '仅离线/隐私优先时需要；未开启时不会影响默认中文意图识别',
    sizeMb: 317,
    task: 'zero-shot-classification',
    category: 'optional-enhancement',
    requiresExplicitEnable: true,
    requiredFiles: [INTENT_CLASSIFIER_MODEL_ARTIFACT.requiredRelativePath],
    pipelineOptions: buildIntentClassifierPipelineOptions(),
    validate: (rootDir) => validateIntentClassifierModelArtifact(rootDir),
  },
];

function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

function getBundledModelsDir(): string {
  return path.join(
    app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
    'models'
  );
}

function modelDir(rootDir: string, modelId: string): string {
  return path.join(rootDir, modelId);
}

function hasModelFiles(rootDir: string, def: ModelDefinition): boolean {
  const dir = modelDir(rootDir, def.id);
  if (!fs.existsSync(dir)) return false;
  if (def.validate) {
    return def.validate(rootDir).ok;
  }
  return def.requiredFiles.every((f) => fs.existsSync(path.join(dir, f)));
}

function getModelStatus(def: ModelDefinition): Pick<LocalModelInfo, 'status' | 'source'> {
  if (hasModelFiles(getModelsDir(), def)) {
    return { status: 'available', source: 'downloaded' };
  }
  if (hasModelFiles(getBundledModelsDir(), def)) {
    return { status: 'available', source: 'bundled' };
  }
  return { status: 'missing' };
}

export function getLocalModels(): LocalModelInfo[] {
  return MODEL_DEFINITIONS.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    sizeMb: def.sizeMb,
    task: def.task,
    category: def.category ?? 'base',
    requiresExplicitEnable: def.requiresExplicitEnable,
    ...getModelStatus(def),
  }));
}

export function isLocalIntentClassifierAvailable(): boolean {
  const def = MODEL_DEFINITIONS.find((model) => model.id === INTENT_CLASSIFIER_MODEL_ARTIFACT.modelId);
  return Boolean(def && getModelStatus(def).status === 'available');
}

export function deleteLocalModel(modelId: string): { success: boolean; error?: string } {
  try {
    const dir = modelDir(getModelsDir(), modelId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// In-memory download tracking (single-process, sufficient for Electron main)
const downloadStates = new Map<string, 'downloading' | 'error'>();

export type DownloadProgressCallback = (modelId: string, progress: number) => void;
export type DownloadCompleteCallback = (modelId: string) => void;
export type DownloadErrorCallback = (modelId: string, error: string) => void;

let onProgress: DownloadProgressCallback | null = null;
let onComplete: DownloadCompleteCallback | null = null;
let onError: DownloadErrorCallback | null = null;

export function setDownloadCallbacks(
  progress: DownloadProgressCallback,
  complete: DownloadCompleteCallback,
  error: DownloadErrorCallback,
): void {
  onProgress = progress;
  onComplete = complete;
  onError = error;
}

export async function startLocalModelDownload(modelId: string): Promise<{ success: boolean; error?: string }> {
  const def = MODEL_DEFINITIONS.find((m) => m.id === modelId);
  if (!def) return { success: false, error: `Unknown model: ${modelId}` };

  if (downloadStates.get(modelId) === 'downloading') {
    return { success: false, error: 'already-downloading' };
  }

  downloadStates.set(modelId, 'downloading');

  try {
    // Dynamic ESM import for @huggingface/transformers (ESM-only package)
    const { pipeline, env } = await (new Function('return import("@huggingface/transformers")')()) as any;

    env.cacheDir = getModelsDir();
    env.localModelPath = getModelsDir();
    env.allowLocalModels = true;
    env.allowRemoteModels = true;
    env.remoteHost = (process.env.HF_ENDPOINT || 'https://modelscope.cn/models').replace(/\/$/, '') + '/';

    // Per-file progress tracking for accurate average
    const fileProgress = new Map<string, number>();
    let lastPostedPct = 0;

    await pipeline(def.task, def.id, {
      local_files_only: false,
      ...(def.pipelineOptions ?? {}),
      progress_callback: (data: any) => {
        const key: string | undefined = data.file ?? data.name;
        if (!key) return;
        let val: number | null = null;
        if (data.status === 'initiate' || data.status === 'download' || data.status === 'downloading') {
          if (!fileProgress.has(key)) val = 0;
        } else if (data.status === 'progress') {
          const p = Number(data.progress);
          if (!Number.isNaN(p)) val = Math.min(100, Math.max(0, p));
        } else if (data.status === 'done') {
          val = 100;
        } else {
          return;
        }
        if (val !== null) {
          const prev = fileProgress.get(key) ?? 0;
          fileProgress.set(key, Math.max(prev, val));
        }
        if (fileProgress.size === 0) return;
        let sum = 0;
        for (const v of fileProgress.values()) sum += v;
        const avg = sum / fileProgress.size;
        const rounded = Math.min(99, Math.floor(avg));
        const next = Math.max(lastPostedPct, rounded);
        if (next === lastPostedPct) return;
        lastPostedPct = next;
        onProgress?.(modelId, next);
      },
    });

    if (def.validate) {
      const validation = def.validate(getModelsDir());
      if (!validation.ok) {
        throw new Error(validation.error || `Downloaded model failed artifact validation: ${modelId}`);
      }
    }

    downloadStates.delete(modelId);
    onComplete?.(modelId);
    return { success: true };
  } catch (e: any) {
    downloadStates.delete(modelId);
    const msg = e?.message || String(e);
    onError?.(modelId, msg);
    return { success: false, error: msg };
  }
}
