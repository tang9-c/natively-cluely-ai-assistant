import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Download, Loader2, Trash2 } from 'lucide-react';

interface SenseVoiceModelInfo {
    id: string;
    name: string;
    sizeMb: number;
    status: 'available' | 'missing' | 'downloading' | 'error';
    source?: 'downloaded';
    errorMessage?: string;
}

const electronAPI = (window as any).electronAPI;

export function LocalSenseVoiceModelPanel() {
    const [models, setModels] = useState<SenseVoiceModelInfo[]>([]);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        const result = await electronAPI?.localSenseVoiceGetModels?.();
        setModels(result?.models ?? []);
        setProgress(0);
    }, []);

    useEffect(() => {
        refresh().catch((err) => setError(err?.message ?? String(err)));
        const offProgress = electronAPI?.onLocalSenseVoiceDownloadProgress?.((payload: { progress: number }) => {
            setDownloading(true);
            setProgress(payload.progress);
        });
        const offComplete = electronAPI?.onLocalSenseVoiceDownloadComplete?.(() => {
            setDownloading(false);
            setProgress(100);
            setError(null);
            refresh().catch((err: any) => setError(err?.message ?? String(err)));
        });
        const offError = electronAPI?.onLocalSenseVoiceDownloadError?.((payload: { error: string }) => {
            setDownloading(false);
            setError(payload.error);
            refresh().catch((err: any) => setError(err?.message ?? String(err)));
        });
        return () => {
            offProgress?.();
            offComplete?.();
            offError?.();
        };
    }, [refresh]);

    const model = models[0];
    const isAvailable = model?.status === 'available';

    const handleDownload = async () => {
        if (!model || downloading) return;
        setDownloading(true);
        setProgress(0);
        setError(null);
        const result = await electronAPI?.localSenseVoiceStartDownload?.(model.id);
        if (!result?.success && result?.error !== 'already-downloading') {
            setDownloading(false);
            setError(result?.error ?? 'Failed to start SenseVoice model download');
        }
    };

    const handleDelete = async () => {
        if (!model || !isAvailable) return;
        const result = await electronAPI?.localSenseVoiceDeleteModel?.(model.id);
        if (!result?.success) {
            setError(result?.error ?? 'Failed to delete SenseVoice model');
            return;
        }
        await refresh();
    };

    return (
        <div className="mt-4 rounded-lg border border-border-subtle bg-bg-elevated/60 p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        {isAvailable ? (
                            <Check size={16} className="text-emerald-500" />
                        ) : (
                            <AlertCircle size={16} className="text-amber-500" />
                        )}
                        <h4 className="text-sm font-semibold text-text-primary">Local SenseVoice</h4>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                        {model?.name ?? 'SenseVoice Small Chinese'} · 中文会议优先 · 本地运行
                    </p>
                    {!isAvailable && (
                        <p className="mt-2 text-xs text-amber-500">
                            {downloading ? `正在下载模型 ${progress}%` : '需要下载本地中文模型后才能使用。'}
                        </p>
                    )}
                    {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {!isAvailable && (
                        <button
                            type="button"
                            onClick={handleDownload}
                            disabled={!model || downloading}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle px-3 text-xs text-text-primary hover:bg-bg-item-surface disabled:opacity-50"
                        >
                            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                            下载
                        </button>
                    )}
                    {isAvailable && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle px-3 text-xs text-text-primary hover:bg-bg-item-surface"
                        >
                            <Trash2 size={14} />
                            删除
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
