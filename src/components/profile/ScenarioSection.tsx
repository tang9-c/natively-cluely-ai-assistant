import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Upload } from 'lucide-react';

import { CardRenderer } from './CardRenderer';
import type { ActiveScenario, ScenarioDocument } from './types';

function getDocSubtype(document: ScenarioDocument): string | undefined {
    return document.docSubtype || document.doc_subtype;
}

function scenarioTitle(scenario?: ActiveScenario | null): string {
    if (!scenario) return '当前场景';
    const label = scenario.adapter?.label || scenario.scenarioType;
    if (scenario.subScenario) return `${label} · ${scenario.subScenario}`;
    return label;
}

export function ScenarioSection() {
    const [scenario, setScenario] = useState<ActiveScenario | null>(null);
    const [documents, setDocuments] = useState<ScenarioDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadingSubtype, setUploadingSubtype] = useState<string | null>(null);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        setError('');
        setLoading(true);
        try {
            const scenarioResult = await window.electronAPI?.profileGetActiveScenario?.();
            if (!scenarioResult?.success || !scenarioResult.scenario) {
                setScenario(null);
                setDocuments([]);
                setError(scenarioResult?.error || '无法读取当前场景');
                return;
            }
            setScenario(scenarioResult.scenario);

            const docsResult = await window.electronAPI?.profileListDocuments?.();
            if (!docsResult?.success) {
                setDocuments([]);
                setError(docsResult?.error || '无法读取场景资料');
                return;
            }
            setDocuments(docsResult.documents || []);
        } catch (event: any) {
            setError(event?.message || '场景资料加载失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const cards = useMemo(() => scenario?.adapter?.cards ?? [], [scenario]);

    const uploadDocument = async (docSubtype: string) => {
        setUploadingSubtype(docSubtype);
        setError('');
        try {
            const fileResult = await window.electronAPI?.profileSelectFile?.();
            if (fileResult?.cancelled || !fileResult?.filePath) return;

            const result = await window.electronAPI?.profileUploadDocument?.({
                filePath: fileResult.filePath,
                docSubtype,
            });
            if (!result?.success) {
                setError(result?.error || '上传失败');
                return;
            }
            await refresh();
        } catch (event: any) {
            setError(event?.message || '上传失败');
        } finally {
            setUploadingSubtype(null);
        }
    };

    const deleteDocument = async (document: ScenarioDocument) => {
        setError('');
        try {
            const result = await window.electronAPI?.profileDeleteDocument?.({ referenceFileId: document.id });
            if (!result?.success) {
                setError(result?.error || '删除失败');
                return;
            }
            await refresh();
        } catch (event: any) {
            setError(event?.message || '删除失败');
        }
    };

    return (
        <section className="rounded-lg border border-border-subtle bg-bg-surface/50 p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-text-primary">场景档案</h4>
                        <span className="rounded-full border border-border-subtle bg-bg-input px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                            {loading ? '加载中' : scenarioTitle(scenario)}
                        </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                        按当前场景组织客户、职位、听众、议程和引用资料，并自动注入 LLM 上下文。
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={loading}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border-subtle bg-bg-input px-3 py-2 text-[11px] font-semibold text-text-primary transition-colors hover:bg-bg-surface disabled:cursor-progress disabled:opacity-60"
                >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    刷新
                </button>
            </div>

            {error && (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-500">
                    <AlertCircle size={13} />
                    {error}
                </div>
            )}

            {cards.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-border-subtle bg-bg-input/30 px-4 py-5 text-[12px] text-text-secondary">
                    <Upload size={15} className="text-text-tertiary" />
                    当前场景暂无可配置资料卡片。
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {cards.map((card) => (
                        <CardRenderer
                            key={card.id}
                            card={card}
                            documents={documents.filter((document) => getDocSubtype(document) === card.docSubtype)}
                            uploading={uploadingSubtype === card.docSubtype}
                            onUpload={uploadDocument}
                            onDelete={deleteDocument}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
