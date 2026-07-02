import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Download, Loader2, Plus, Save, Trash2 } from 'lucide-react';

interface SenseVoiceModelInfo {
    id: string;
    name: string;
    sizeMb: number;
    status: 'available' | 'missing' | 'downloading' | 'error';
    source?: 'downloaded';
    errorMessage?: string;
}

interface SenseVoiceTermEntry {
    id: string;
    canonical: string;
    variants: string[];
    enabled: boolean;
}

const electronAPI = (window as any).electronAPI;

function createTerm(): SenseVoiceTermEntry {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { id, canonical: '', variants: [], enabled: true };
}

export function LocalSenseVoiceModelPanel() {
    const [models, setModels] = useState<SenseVoiceModelInfo[]>([]);
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [terms, setTerms] = useState<SenseVoiceTermEntry[]>([]);
    const [correctionEnabled, setCorrectionEnabled] = useState(true);
    const [termStatus, setTermStatus] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        const result = await electronAPI?.localSenseVoiceGetModels?.();
        setModels(result?.models ?? []);
        setProgress(0);
        const termResult = await electronAPI?.localSenseVoiceGetTerms?.();
        setTerms(termResult?.terms ?? []);
        setCorrectionEnabled(termResult?.correctionEnabled !== false);
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

    const updateTerm = (id: string, patch: Partial<SenseVoiceTermEntry>) => {
        setTerms((current) => current.map((term) => term.id === id ? { ...term, ...patch } : term));
        setTermStatus(null);
    };

    const handleSaveTerms = async () => {
        setError(null);
        const result = await electronAPI?.localSenseVoiceSetTerms?.({
            terms,
            correctionEnabled,
        });
        if (!result?.success) {
            setError(result?.error ?? 'Failed to save SenseVoice term corrections');
            return;
        }
        setTermStatus('已保存，下次转写会话生效。');
        const refreshed = await electronAPI?.localSenseVoiceGetTerms?.();
        setTerms(refreshed?.terms ?? []);
        setCorrectionEnabled(refreshed?.correctionEnabled !== false);
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
            <div className="mt-4 border-t border-border-subtle pt-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h5 className="text-sm font-semibold text-text-primary">专名错词纠正</h5>
                        <p className="mt-1 text-xs text-text-secondary">
                            用于修正常见、稳定的 Local SenseVoice 误识别。请为每个正确专名填写它经常被识别成的错词；只填写正确词不会提高模型识别概率。
                        </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-xs text-text-secondary">
                        <input
                            type="checkbox"
                            checked={correctionEnabled}
                            onChange={(event) => {
                                setCorrectionEnabled(event.target.checked);
                                setTermStatus(null);
                            }}
                            className="h-4 w-4"
                        />
                        启用 final 文本纠错
                    </label>
                </div>
                <div className="mt-3 space-y-3">
                    {terms.map((term) => (
                        <div key={term.id} className="grid gap-2 rounded-md border border-border-subtle p-3 md:grid-cols-[1fr_1.4fr_auto]">
                            <label className="text-xs text-text-secondary">
                                正确专名
                                <input
                                    value={term.canonical}
                                    onChange={(event) => updateTerm(term.id, { canonical: event.target.value })}
                                    className="mt-1 h-8 w-full rounded-md border border-border-subtle bg-bg-item-surface px-2 text-xs text-text-primary outline-none focus:border-accent-primary"
                                    placeholder="CueUp"
                                />
                                {term.variants.length === 0 && (
                                    <span className="mt-1 block text-[11px] text-amber-500">
                                        未填写常见误识别，不会生效。
                                    </span>
                                )}
                            </label>
                            <label className="text-xs text-text-secondary">
                                常见误识别（一行一个）
                                <textarea
                                    value={term.variants.join('\n')}
                                    onChange={(event) => updateTerm(term.id, {
                                        variants: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean),
                                    })}
                                    className="mt-1 min-h-16 w-full resize-y rounded-md border border-border-subtle bg-bg-item-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-primary"
                                    placeholder={'丘普\n秋普'}
                                />
                            </label>
                            <div className="flex items-center justify-end gap-2">
                                <label className="flex items-center gap-1 text-xs text-text-secondary">
                                    <input
                                        type="checkbox"
                                        checked={term.enabled}
                                        onChange={(event) => updateTerm(term.id, { enabled: event.target.checked })}
                                        className="h-4 w-4"
                                    />
                                    启用
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setTerms((current) => current.filter((item) => item.id !== term.id))}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-subtle text-text-secondary hover:bg-bg-item-surface"
                                    title="删除"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-text-tertiary">保存后下次转写会话生效。</p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setTerms((current) => [...current, createTerm()]);
                                setTermStatus(null);
                            }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle px-3 text-xs text-text-primary hover:bg-bg-item-surface"
                        >
                            <Plus size={14} />
                            添加专名
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveTerms}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-subtle px-3 text-xs text-text-primary hover:bg-bg-item-surface"
                        >
                            <Save size={14} />
                            保存
                        </button>
                    </div>
                </div>
                {termStatus && <p className="mt-2 text-xs text-emerald-500">{termStatus}</p>}
            </div>
        </div>
    );
}
