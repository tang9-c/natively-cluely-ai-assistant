import React, { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, HardDrive, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  sizeMb: number;
  task: string;
  status: 'available' | 'missing' | 'downloading' | 'error';
  errorMessage?: string;
}

const electronAPI = (window as any).electronAPI;

export function LocalModelsPanel() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadingSet, setDownloadingSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const res = await electronAPI?.localModelsGetList?.();
      if (res?.models) setModels(res.models);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubProgress = electronAPI?.onLocalModelsDownloadProgress?.((data: { modelId: string; progress: number }) => {
      setDownloadProgress((prev) => ({ ...prev, [data.modelId]: data.progress }));
    });
    const unsubComplete = electronAPI?.onLocalModelsDownloadComplete?.((data: { modelId: string }) => {
      setDownloadingSet((prev) => {
        const s = new Set(prev);
        s.delete(data.modelId);
        return s;
      });
      setDownloadProgress((prev) => {
        const d = { ...prev };
        delete d[data.modelId];
        return d;
      });
      loadData();
    });
    const unsubError = electronAPI?.onLocalModelsDownloadError?.((data: { modelId: string; error: string }) => {
      setDownloadingSet((prev) => {
        const s = new Set(prev);
        s.delete(data.modelId);
        return s;
      });
      setDownloadProgress((prev) => {
        const d = { ...prev };
        delete d[data.modelId];
        return d;
      });
      setModels((prev) =>
        prev.map((m) =>
          m.id === data.modelId ? { ...m, status: 'error', errorMessage: data.error } : m
        )
      );
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, [loadData]);

  const handleDownload = async (modelId: string) => {
    if (downloadingSet.has(modelId)) return;
    setDownloadingSet((prev) => new Set([...prev, modelId]));
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, status: 'downloading' } : m)));
    setDownloadProgress((prev) => ({ ...prev, [modelId]: 0 }));

    const result = await electronAPI?.localModelsStartDownload?.(modelId);
    if (!result?.success && result?.error !== 'already-downloading') {
      setDownloadingSet((prev) => {
        const s = new Set(prev);
        s.delete(modelId);
        return s;
      });
      setDownloadProgress((prev) => {
        const d = { ...prev };
        delete d[modelId];
        return d;
      });
      setModels((prev) =>
        prev.map((m) =>
          m.id === modelId
            ? { ...m, status: 'error', errorMessage: result?.error ?? 'Download failed' }
            : m
        )
      );
    }
  };

  const handleDelete = async (modelId: string) => {
    await electronAPI?.localModelsDeleteModel?.(modelId);
    await loadData();
  };

  if (loading) {
    return (
      <div className="p-4 flex justify-center text-text-tertiary">
        <Loader2 className="animate-spin w-5 h-5" />
      </div>
    );
  }

  return (
    <div className="bg-bg-card rounded-xl border border-border-subtle overflow-hidden shadow-sm">
      <div className="px-5 py-4 bg-bg-elevated/50 border-b border-border-subtle">
        <h3 className="text-sm font-semibold text-text-primary">本地模型</h3>
        <p className="text-xs text-text-secondary mt-1">下载到本地的 ONNX 模型，可在离线时使用</p>
      </div>

      <div className="p-4 space-y-3 bg-bg-elevated/20">
        {models.map((model) => {
          const isDownloading = model.status === 'downloading' || downloadingSet.has(model.id);
          const progress = downloadProgress[model.id] || 0;
          const isAvailable = model.status === 'available';

          return (
            <div
              key={model.id}
              className="p-4 flex items-center justify-between bg-bg-card border border-border-subtle rounded-[14px] hover:shadow-sm hover:border-border-muted transition-all duration-200"
            >
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-medium text-text-primary truncate tracking-tight">
                    {model.name}
                  </span>
                  {isAvailable && (
                    <span className="px-1.5 py-0.5 rounded-[4px] bg-emerald-500/10 text-emerald-500 text-[9px] font-bold uppercase tracking-wider">
                      已安装
                    </span>
                  )}
                  {!isAvailable && !isDownloading && model.status !== 'error' && (
                    <span className="px-1.5 py-0.5 rounded-[4px] bg-bg-input text-text-tertiary text-[9px] font-bold uppercase tracking-wider">
                      未安装
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3.5 text-xs text-text-tertiary">
                  <span className="flex items-center gap-1.5">
                    <HardDrive size={13} className="opacity-70" /> {model.sizeMb} MB
                  </span>
                  <span>{model.description}</span>
                </div>

                {isDownloading && (
                  <div className="mt-3.5 pr-8">
                    <div className="flex justify-between items-center text-[10px] text-text-secondary mb-1.5 uppercase tracking-wider font-semibold">
                      <span>Downloading...</span>
                      <span className="text-accent-primary tabular-nums">{Math.round(progress)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-bg-input rounded-full overflow-hidden shadow-inner ring-1 ring-inset ring-black/5 dark:ring-white/5">
                      <motion.div
                        className="h-full bg-accent-primary relative"
                        style={{ width: `${progress}%` }}
                        transition={{ duration: 0.3 }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      </motion.div>
                    </div>
                  </div>
                )}

                {model.status === 'error' && (
                  <div className="mt-2.5 text-xs text-red-500 flex items-center gap-1.5 font-medium bg-red-500/10 px-2.5 py-1.5 rounded-md inline-flex">
                    <AlertCircle size={14} />
                    {model.errorMessage || 'Failed to download model'}
                  </div>
                )}
              </div>

              <div className="flex-shrink-0 flex items-center gap-2">
                {!isAvailable && !isDownloading && (
                  <button
                    onClick={() => handleDownload(model.id)}
                    className="group/btn relative h-[34px] px-4 flex items-center gap-1.5 rounded-[10px] bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary text-[13px] font-semibold transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] shadow-sm"
                  >
                    <Download size={14} className="transition-transform duration-300 group-hover/btn:-translate-y-[2px]" />
                    <span>安装</span>
                  </button>
                )}

                {isAvailable && (
                  <button
                    onClick={() => handleDelete(model.id)}
                    className="p-2 rounded-[10px] text-text-tertiary hover:bg-red-500/10 hover:text-red-500 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96]"
                    title="删除模型"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
