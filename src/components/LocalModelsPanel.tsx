import React, { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, HardDrive, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface ModelInfo {
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

const electronAPI = (window as any).electronAPI;

export function LocalModelsPanel() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [downloadingSet, setDownloadingSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [localIntentEnhancementEnabled, setLocalIntentEnhancementEnabled] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [res, enhancementEnabled] = await Promise.all([
        electronAPI?.localModelsGetList?.(),
        electronAPI?.getLocalIntentEnhancementEnabled?.(),
      ]);
      if (res?.models) setModels(res.models);
      if (typeof enhancementEnabled === 'boolean') {
        setLocalIntentEnhancementEnabled(enhancementEnabled);
      }
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
    const unsubEnhancement = electronAPI?.onLocalIntentEnhancementEnabledChanged?.((enabled: boolean) => {
      setLocalIntentEnhancementEnabled(enabled);
    });

    return () => {
      unsubProgress?.();
      unsubComplete?.();
      unsubError?.();
      unsubEnhancement?.();
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

  const handleToggleIntentEnhancement = async () => {
    const next = !localIntentEnhancementEnabled;
    setLocalIntentEnhancementEnabled(next);
    const result = await electronAPI?.setLocalIntentEnhancementEnabled?.(next);
    if (!result?.success) {
      setLocalIntentEnhancementEnabled(!next);
    }
  };

  const renderModel = (model: ModelInfo) => {
    const isDownloading = model.status === 'downloading' || downloadingSet.has(model.id);
    const progress = downloadProgress[model.id] || 0;
    const isAvailable = model.status === 'available';
    const canDelete = model.source === 'downloaded';
    const isOptionalIntentEnhancement = model.category === 'optional-enhancement';

    return (
      <div
        key={model.id}
        className="p-4 flex items-center justify-between bg-bg-card border border-border-subtle rounded-[8px] hover:shadow-sm hover:border-border-muted transition-all duration-200"
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
          <div className="flex flex-wrap items-center gap-3.5 text-xs text-text-tertiary">
            <span className="flex items-center gap-1.5">
              <HardDrive size={13} className="opacity-70" /> {model.sizeMb} MB
            </span>
            <span>{model.description}</span>
          </div>
          {isOptionalIntentEnhancement && (
            <p className="mt-2 text-xs text-text-secondary">
              未开启时不会影响默认中文意图识别；开启后仅在规则和云端判断不足时使用已安装模型。
            </p>
          )}

          {isDownloading && (
            <div className="mt-3.5 pr-8">
              <div className="flex justify-between items-center text-[10px] text-text-secondary mb-1.5 uppercase tracking-wider font-semibold">
                <span>下载中...</span>
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
              {model.errorMessage || '模型下载失败'}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {isOptionalIntentEnhancement && (
            <button
              onClick={handleToggleIntentEnhancement}
              className={`h-[34px] px-3 rounded-[8px] text-[13px] font-semibold transition-all duration-200 ${
                localIntentEnhancementEnabled
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-bg-input text-text-secondary hover:text-text-primary'
              }`}
            >
              {localIntentEnhancementEnabled ? '已开启' : '开启'}
            </button>
          )}
          {!isAvailable && !isDownloading && (
            <button
              onClick={() => handleDownload(model.id)}
              className="group/btn relative h-[34px] px-4 flex items-center gap-1.5 rounded-[8px] bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary text-[13px] font-semibold transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] shadow-sm"
            >
              <Download size={14} className="transition-transform duration-300 group-hover/btn:-translate-y-[2px]" />
              <span>安装</span>
            </button>
          )}

          {isAvailable && canDelete && (
            <button
              onClick={() => handleDelete(model.id)}
              className="p-2 rounded-[8px] text-text-tertiary hover:bg-red-500/10 hover:text-red-500 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96]"
              title="删除模型"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    );
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
        <p className="text-xs text-text-secondary mt-1">基础本地模型默认可用；可选增强包只在显式开启后参与推理</p>
      </div>

      <div className="p-4 space-y-3 bg-bg-elevated/20">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-text-secondary">基础本地模型</h4>
          {models.filter((model) => model.category !== 'optional-enhancement').map(renderModel)}
        </div>
        <div className="space-y-2 pt-2">
          <h4 className="text-xs font-semibold text-text-secondary">可选增强包</h4>
          {models.filter((model) => model.category === 'optional-enhancement').map(renderModel)}
        </div>
      </div>
    </div>
  );
}
