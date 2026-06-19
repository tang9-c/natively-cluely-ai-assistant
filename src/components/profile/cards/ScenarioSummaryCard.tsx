import React from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';

import type { ScenarioCard, ScenarioDocument } from '../types';

interface ScenarioSummaryCardProps {
    card: ScenarioCard;
    documents: ScenarioDocument[];
    uploading: boolean;
    onUpload: (docSubtype: string) => void;
    onDelete: (document: ScenarioDocument) => void;
}

function getDocumentTitle(document: ScenarioDocument): string {
    return document.title || document.fileName || document.path?.split('/').pop() || '场景资料';
}

export function ScenarioSummaryCard({
    card,
    documents,
    uploading,
    onUpload,
    onDelete,
}: ScenarioSummaryCardProps) {
    const latestDocument = documents[0];

    return (
        <div className="flex h-full min-h-[148px] flex-col rounded-lg border border-border-subtle bg-bg-input/45 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h5 className="text-[13px] font-bold text-text-primary">{card.title}</h5>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{card.description}</p>
                </div>
                <button
                    type="button"
                    onClick={() => onUpload(card.docSubtype)}
                    disabled={uploading}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-text-primary transition-colors hover:bg-bg-input disabled:cursor-progress disabled:opacity-60"
                    aria-label={`添加 ${card.title}`}
                >
                    <Plus size={14} />
                </button>
            </div>

            <div className="mt-auto pt-4">
                {latestDocument ? (
                    <div className="rounded-md border border-border-subtle bg-bg-surface/70 px-3 py-2">
                        <div className="flex items-center gap-2">
                            <FileText size={14} className="shrink-0 text-text-tertiary" />
                            <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">
                                {getDocumentTitle(latestDocument)}
                            </p>
                            <button
                                type="button"
                                onClick={() => onDelete(latestDocument)}
                                className="rounded-full p-1 text-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-500"
                                aria-label={`删除 ${getDocumentTitle(latestDocument)}`}
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                        {documents.length > 1 && (
                            <p className="mt-1 pl-5 text-[10px] text-text-tertiary">
                                另有 {documents.length - 1} 份资料
                            </p>
                        )}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => onUpload(card.docSubtype)}
                        disabled={uploading}
                        className="w-full rounded-md border border-dashed border-border-subtle px-3 py-3 text-left text-[11px] text-text-tertiary transition-colors hover:border-accent-primary/40 hover:text-text-secondary disabled:cursor-progress"
                    >
                        {uploading ? '正在加入资料...' : '添加场景资料'}
                    </button>
                )}
            </div>
        </div>
    );
}
