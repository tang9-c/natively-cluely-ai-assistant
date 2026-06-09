"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalModels = getLocalModels;
exports.deleteLocalModel = deleteLocalModel;
exports.setDownloadCallbacks = setDownloadCallbacks;
exports.startLocalModelDownload = startLocalModelDownload;
// electron/services/LocalModelManager.ts
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const electron_1 = require("electron");
const MODEL_DEFINITIONS = [
    {
        id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
        name: '本地嵌入模型',
        description: '用于本地 RAG 向量检索',
        sizeMb: 129,
        task: 'feature-extraction',
        requiredFiles: ['onnx/model_int8.onnx'],
    },
    {
        id: 'Xenova/mobilebert-uncased-mnli',
        name: '意图分类模型',
        description: '用于对话意图识别',
        sizeMb: 121,
        task: 'zero-shot-classification',
        requiredFiles: ['onnx/model.onnx'],
    },
];
function getModelsDir() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'models');
}
function modelDir(modelId) {
    return path_1.default.join(getModelsDir(), modelId);
}
function isModelCached(def) {
    const dir = modelDir(def.id);
    if (!fs_1.default.existsSync(dir))
        return false;
    return def.requiredFiles.every((f) => fs_1.default.existsSync(path_1.default.join(dir, f)));
}
function getLocalModels() {
    return MODEL_DEFINITIONS.map((def) => ({
        id: def.id,
        name: def.name,
        description: def.description,
        sizeMb: def.sizeMb,
        task: def.task,
        status: isModelCached(def) ? 'available' : 'missing',
    }));
}
function deleteLocalModel(modelId) {
    try {
        const dir = modelDir(modelId);
        if (fs_1.default.existsSync(dir)) {
            fs_1.default.rmSync(dir, { recursive: true, force: true });
        }
        return { success: true };
    }
    catch (e) {
        return { success: false, error: e.message };
    }
}
// In-memory download tracking (single-process, sufficient for Electron main)
const downloadStates = new Map();
let onProgress = null;
let onComplete = null;
let onError = null;
function setDownloadCallbacks(progress, complete, error) {
    onProgress = progress;
    onComplete = complete;
    onError = error;
}
async function startLocalModelDownload(modelId) {
    const def = MODEL_DEFINITIONS.find((m) => m.id === modelId);
    if (!def)
        return { success: false, error: `Unknown model: ${modelId}` };
    if (downloadStates.get(modelId) === 'downloading') {
        return { success: false, error: 'already-downloading' };
    }
    downloadStates.set(modelId, 'downloading');
    try {
        // Dynamic ESM import for @huggingface/transformers (ESM-only package)
        const { pipeline, env } = await (new Function('return import("@huggingface/transformers")')());
        env.cacheDir = getModelsDir();
        env.allowRemoteModels = true;
        env.remoteHost = (process.env.HF_ENDPOINT || 'https://modelscope.cn/models').replace(/\/$/, '') + '/';
        // Per-file progress tracking for accurate average
        const fileProgress = new Map();
        let lastPostedPct = 0;
        await pipeline(def.task, def.id, {
            local_files_only: false,
            progress_callback: (data) => {
                const key = data.file ?? data.name;
                if (!key)
                    return;
                let val = null;
                if (data.status === 'initiate' || data.status === 'download' || data.status === 'downloading') {
                    if (!fileProgress.has(key))
                        val = 0;
                }
                else if (data.status === 'progress') {
                    const p = Number(data.progress);
                    if (!Number.isNaN(p))
                        val = Math.min(100, Math.max(0, p));
                }
                else if (data.status === 'done') {
                    val = 100;
                }
                else {
                    return;
                }
                if (val !== null) {
                    const prev = fileProgress.get(key) ?? 0;
                    fileProgress.set(key, Math.max(prev, val));
                }
                if (fileProgress.size === 0)
                    return;
                let sum = 0;
                for (const v of fileProgress.values())
                    sum += v;
                const avg = sum / fileProgress.size;
                const rounded = Math.min(99, Math.floor(avg));
                const next = Math.max(lastPostedPct, rounded);
                if (next === lastPostedPct)
                    return;
                lastPostedPct = next;
                onProgress?.(modelId, next);
            },
        });
        downloadStates.delete(modelId);
        onComplete?.(modelId);
        return { success: true };
    }
    catch (e) {
        downloadStates.delete(modelId);
        const msg = e?.message || String(e);
        onError?.(modelId, msg);
        return { success: false, error: msg };
    }
}
//# sourceMappingURL=LocalModelManager.js.map