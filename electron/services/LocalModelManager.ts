// electron/services/LocalModelManager.ts
import path from 'path';
import fs from 'fs';
import { app, net } from 'electron';
import {
  INTENT_CLASSIFIER_MODEL_ARTIFACT,
  buildIntentClassifierPipelineOptions,
  validateIntentClassifierModelArtifact,
} from '../llm/IntentClassifierModelArtifact';

export const SPEAKER_EMBEDDING_MODEL_ID = 'csukuangfj/speaker-embedding-models' as const;
export const SPEAKER_EMBEDDING_MODEL_FILENAME = '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx' as const;
export const SPEAKER_EMBEDDING_MODEL_RELATIVE_PATH = SPEAKER_EMBEDDING_MODEL_FILENAME;

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
    id: SPEAKER_EMBEDDING_MODEL_ID,
    name: '本地声纹模型',
    description: '用于在会议中识别你的发言为 ME',
    sizeMb: 28,
    task: 'speaker-verification',
    category: 'optional-enhancement',
    requiresExplicitEnable: true,
    requiredFiles: [SPEAKER_EMBEDDING_MODEL_RELATIVE_PATH],
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

export function isLocalSpeakerEmbeddingModelAvailable(): boolean {
  const def = MODEL_DEFINITIONS.find((model) => model.id === SPEAKER_EMBEDDING_MODEL_ID);
  return Boolean(def && getModelStatus(def).status === 'available');
}

export function resolveLocalModelFile(modelId: string, relativePath: string): string | null {
  const def = MODEL_DEFINITIONS.find((model) => model.id === modelId);
  if (!def) return null;
  if (!def.requiredFiles.includes(relativePath)) return null;

  const downloaded = path.join(modelDir(getModelsDir(), modelId), relativePath);
  if (fs.existsSync(downloaded)) return downloaded;

  const bundled = path.join(modelDir(getBundledModelsDir(), modelId), relativePath);
  if (fs.existsSync(bundled)) return bundled;

  return null;
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

function safeUrlForError(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = '';
    return url.toString();
  } catch {
    return rawUrl.split('?')[0] || rawUrl;
  }
}

async function downloadSingleFileModel(
  def: ModelDefinition,
  filename: string,
  sourceUrl: string,
): Promise<void> {
  const dir = modelDir(getModelsDir(), def.id);
  const destination = path.join(dir, filename);
  const tempDestination = `${destination}.download`;
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(tempDestination, { force: true });

  try {
    await new Promise<void>((resolve, reject) => {
      const request = net.request(sourceUrl);
      request.on('response', (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Failed to download ${safeUrlForError(sourceUrl)}: HTTP ${response.statusCode}`));
          return;
        }

        const header = response.headers['content-length'];
        const total = Number(Array.isArray(header) ? header[0] : header) || 0;
        let downloaded = 0;
        const file = fs.createWriteStream(tempDestination);

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (total > 0) {
            onProgress?.(def.id, Math.min(99, Math.floor((downloaded / total) * 100)));
          }
        });
        response.on('error', reject);
        file.on('error', reject);
        file.on('finish', resolve);
        response.pipe(file);
      });
      request.on('error', reject);
      request.end();
    });

    fs.renameSync(tempDestination, destination);
  } catch (error) {
    fs.rmSync(tempDestination, { force: true });
    throw error;
  }
}

export async function startLocalModelDownload(modelId: string): Promise<{ success: boolean; error?: string }> {
  const def = MODEL_DEFINITIONS.find((m) => m.id === modelId);
  if (!def) return { success: false, error: `Unknown model: ${modelId}` };

  if (downloadStates.get(modelId) === 'downloading') {
    return { success: false, error: 'already-downloading' };
  }

  downloadStates.set(modelId, 'downloading');

  try {
    if (modelId === SPEAKER_EMBEDDING_MODEL_ID) {
      await downloadSingleFileModel(
        def,
        SPEAKER_EMBEDDING_MODEL_FILENAME,
        `https://huggingface.co/${SPEAKER_EMBEDDING_MODEL_ID}/resolve/main/${SPEAKER_EMBEDDING_MODEL_FILENAME}`,
      );
      downloadStates.delete(modelId);
      onProgress?.(modelId, 100);
      onComplete?.(modelId);
      return { success: true };
    }

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
