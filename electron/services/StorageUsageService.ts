import fs from 'fs';
import path from 'path';

export type DownloadedModelKind = 'whisper' | 'sensevoice';

export interface StorageUsageItem {
  id: string;
  label: string;
  bytes: number;
  removable: boolean;
  reason?: 'bundled' | 'cache' | 'managed_elsewhere' | 'model_in_use' | 'migration_incomplete' | 'unsafe_symbolic_link';
}

export interface StorageUsageCategory {
  bytes: number;
  items: StorageUsageItem[];
}

export interface StorageUsageSummary {
  appModels: StorageUsageCategory;
  downloadedModels: StorageUsageCategory;
  caches: StorageUsageCategory;
  legacyData: StorageUsageCategory;
  totalBytes: number;
  reclaimableBytes: number;
}

export interface StorageMutationResult {
  success: boolean;
  freedBytes?: number;
  error?: 'unknown_model' | 'unknown_candidate' | 'model_in_use' | 'migration_incomplete' | 'unsafe_symbolic_link' | 'unsafe_path' | 'delete_failed';
}

interface KnownModel {
  id: string;
  name: string;
}

interface StorageUsageServiceOptions {
  userDataDir?: string;
  appDataDir?: string;
  bundledModelsDir?: string;
  knownModels?: Record<DownloadedModelKind, KnownModel[]>;
  isModelInUse?: (kind: DownloadedModelKind, modelId: string) => boolean;
}

const DEFAULT_WHISPER_MODELS: KnownModel[] = [
  'Xenova/whisper-tiny',
  'Xenova/whisper-tiny.en',
  'Xenova/whisper-base',
  'Xenova/whisper-base.en',
  'Xenova/whisper-small',
  'Xenova/whisper-small.en',
  'Xenova/whisper-medium',
  'Xenova/whisper-medium.en',
  'onnx-community/whisper-large-v3-turbo-ONNX',
  'distil-whisper/distil-small.en',
  'distil-whisper/distil-medium.en',
  'distil-whisper/distil-large-v2',
  'distil-whisper/distil-large-v3',
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-tiny-zh-ONNX',
  'onnx-community/moonshine-base-ONNX',
].map(id => ({ id, name: id.split('/').pop() || id }));

const DEFAULT_SENSEVOICE_MODELS: KnownModel[] = [{
  id: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  name: 'SenseVoice Small Chinese',
}];

const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache'] as const;
const LEGACY_MIGRATION_MARKER = '.legacy-natively-migration-complete.json';
const MIGRATION_PROOF_ENTRIES = [
  'natively.db',
  'credentials.enc',
  'settings.json',
  'models',
  'whisper-models',
  'sensevoice-models',
  'skills',
] as const;

function existingPathHasSymlink(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return true;
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) return true;
  }
  return false;
}

async function directorySize(target: string): Promise<number> {
  try {
    const stat = await fs.promises.lstat(target);
    if (stat.isSymbolicLink()) return 0;
    if (!stat.isDirectory()) return stat.size;
    const children = await fs.promises.readdir(target);
    let total = 0;
    for (const child of children) {
      total += await directorySize(path.join(target, child));
    }
    return total;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

function category(items: StorageUsageItem[]): StorageUsageCategory {
  return { bytes: items.reduce((total, item) => total + item.bytes, 0), items };
}

export class StorageUsageService {
  private readonly userDataDir: string;
  private readonly appDataDir: string;
  private readonly bundledModelsDir: string;
  private readonly knownModels: Record<DownloadedModelKind, KnownModel[]>;
  private readonly isModelInUse: (kind: DownloadedModelKind, modelId: string) => boolean;

  constructor(options: StorageUsageServiceOptions = {}) {
    const { app } = require('electron');
    this.userDataDir = path.resolve(options.userDataDir ?? app.getPath('userData'));
    this.appDataDir = path.resolve(options.appDataDir ?? app.getPath('appData'));
    this.bundledModelsDir = path.resolve(options.bundledModelsDir ?? path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      'models',
    ));
    this.knownModels = options.knownModels ?? {
      whisper: DEFAULT_WHISPER_MODELS,
      sensevoice: DEFAULT_SENSEVOICE_MODELS,
    };
    this.isModelInUse = options.isModelInUse ?? (() => false);
  }

  private modelRoot(kind: DownloadedModelKind): string {
    return path.join(this.userDataDir, kind === 'whisper' ? 'whisper-models' : 'sensevoice-models');
  }

  private resolveKnownModel(kind: DownloadedModelKind, modelId: string): { model: KnownModel; target: string } | null {
    const model = this.knownModels[kind].find(candidate => candidate.id === modelId);
    if (!model) return null;
    const root = this.modelRoot(kind);
    const target = path.resolve(root, model.id);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return { model, target };
  }

  private async legacyState(): Promise<StorageUsageItem> {
    const legacyPath = path.resolve(this.appDataDir, 'Natively');
    const currentPath = path.resolve(this.userDataDir);
    const unsafe = legacyPath === currentPath || existingPathHasSymlink(this.appDataDir, legacyPath);
    const migrationComplete = !unsafe
      && fs.existsSync(path.join(currentPath, LEGACY_MIGRATION_MARKER))
      && MIGRATION_PROOF_ENTRIES.every(entry => (
      !fs.existsSync(path.join(legacyPath, entry)) || fs.existsSync(path.join(currentPath, entry))
      ));
    const bytes = unsafe ? 0 : await directorySize(legacyPath);
    return {
      id: 'natively',
      label: '旧版 Natively 数据',
      bytes,
      removable: bytes > 0 && migrationComplete,
      ...(!migrationComplete ? { reason: unsafe ? 'unsafe_symbolic_link' as const : 'migration_incomplete' as const } : {}),
    };
  }

  async getStorageUsage(): Promise<StorageUsageSummary> {
    const appModels = category([{
      id: 'bundled-models',
      label: '应用内置模型',
      bytes: await directorySize(this.bundledModelsDir),
      removable: false,
      reason: 'bundled',
    }]);

    const downloadedItems: StorageUsageItem[] = [];
    for (const kind of ['whisper', 'sensevoice'] as const) {
      for (const model of this.knownModels[kind]) {
        const resolved = this.resolveKnownModel(kind, model.id);
        if (!resolved || !fs.existsSync(resolved.target)) continue;
        const unsafe = existingPathHasSymlink(this.modelRoot(kind), resolved.target);
        const inUse = this.isModelInUse(kind, model.id);
        downloadedItems.push({
          id: `${kind}:${model.id}`,
          label: model.name,
          bytes: unsafe ? 0 : await directorySize(resolved.target),
          removable: !unsafe && !inUse,
          ...(unsafe ? { reason: 'unsafe_symbolic_link' as const } : inUse ? { reason: 'model_in_use' as const } : {}),
        });
      }
    }
    const otherLocalModelsDir = path.join(this.userDataDir, 'models');
    const otherLocalModelsBytes = await directorySize(otherLocalModelsDir);
    if (otherLocalModelsBytes > 0) {
      downloadedItems.push({
        id: 'other-local-models',
        label: '其他本地模型',
        bytes: otherLocalModelsBytes,
        removable: false,
        reason: 'managed_elsewhere',
      });
    }
    const downloadedModels = category(downloadedItems);

    const cacheItems = await Promise.all(CACHE_DIRS.map(async name => ({
      id: name.toLowerCase().replaceAll(' ', '-'),
      label: name,
      bytes: await directorySize(path.join(this.userDataDir, name)),
      removable: false,
      reason: 'cache' as const,
    })));
    const caches = category(cacheItems.filter(item => item.bytes > 0));
    const legacyItem = await this.legacyState();
    const legacyData = category([legacyItem].filter(item => item.bytes > 0));
    const categories = [appModels, downloadedModels, caches, legacyData];
    return {
      appModels,
      downloadedModels,
      caches,
      legacyData,
      totalBytes: categories.reduce((total, entry) => total + entry.bytes, 0),
      reclaimableBytes: [...downloadedModels.items, ...legacyData.items]
        .filter(item => item.removable)
        .reduce((total, item) => total + item.bytes, 0),
    };
  }

  async deleteDownloadedModel(kind: DownloadedModelKind, modelId: string): Promise<StorageMutationResult> {
    const resolved = this.resolveKnownModel(kind, modelId);
    if (!resolved) return { success: false, error: 'unknown_model' };
    if (this.isModelInUse(kind, modelId)) return { success: false, error: 'model_in_use' };
    if (existingPathHasSymlink(this.modelRoot(kind), resolved.target)) {
      return { success: false, error: 'unsafe_symbolic_link' };
    }
    const freedBytes = await directorySize(resolved.target);
    if (this.isModelInUse(kind, modelId)) return { success: false, error: 'model_in_use' };
    try {
      await fs.promises.rm(resolved.target, { recursive: true, force: true });
      return { success: true, freedBytes };
    } catch {
      return { success: false, error: 'delete_failed' };
    }
  }

  async deleteLegacyData(candidateId: string): Promise<StorageMutationResult> {
    if (candidateId !== 'natively') return { success: false, error: 'unknown_candidate' };
    const state = await this.legacyState();
    if (!state.removable) {
      return { success: false, error: state.reason === 'unsafe_symbolic_link' ? 'unsafe_symbolic_link' : 'migration_incomplete' };
    }
    const target = path.join(this.appDataDir, 'Natively');
    try {
      await fs.promises.rm(target, { recursive: true, force: true });
      return { success: true, freedBytes: state.bytes };
    } catch {
      return { success: false, error: 'delete_failed' };
    }
  }
}
