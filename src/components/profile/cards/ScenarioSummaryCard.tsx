import React from 'react';
import { FileText, Plus, Search, Trash2 } from 'lucide-react';

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

function openResearchPanel(companyName: string): void {
    window.dispatchEvent(
        new CustomEvent('open-research-panel', { detail: { companyName } }),
    );
}

function CompanyResearchAction({ companyName }: { companyName?: string }) {
    if (companyName) {
        return (
            <button
                type="button"
                onClick={() => openResearchPanel(companyName)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-accent-primary transition-colors hover:bg-accent-primary/10"
                title={`调研 ${companyName}`}
            >
                <Search size={11} />
                调研
            </button>
        );
    }

    return (
        <span className="shrink-0 text-[11px] text-text-tertiary">未识别到公司名称</span>
    );
}

export function ScenarioSummaryCard({
    card,
    documents,
    uploading,
    onUpload,
    onDelete,
}: ScenarioSummaryCardProps) {
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
                {documents.length === 0 ? (
                    <button
                        type="button"
                        onClick={() => onUpload(card.docSubtype)}
                        disabled={uploading}
                        className="w-full rounded-md border border-dashed border-border-subtle px-3 py-3 text-left text-[11px] text-text-tertiary transition-colors hover:border-accent-primary/40 hover:text-text-secondary disabled:cursor-progress"
                    >
                        {uploading ? '正在加入资料...' : '添加场景资料'}
                    </button>
                ) : (
                    <div className="space-y-2">
                        {documents.map((document) => (
                            <div
                                key={document.id}
                                className="group flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface/70 px-3 py-2"
                            >
                                <FileText size={14} className="shrink-0 text-text-tertiary" />
                                <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">
                                    {getDocumentTitle(document)}
                                </p>
                                {card.docSubtype === 'company-research' && (
                                    <CompanyResearchAction companyName={document.parsedJson?.companyName} />
                                )}
                                <button
                                    type="button"
                                    onClick={() => onDelete(document)}
                                    className="rounded-full p-1 text-text-tertiary opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                                    aria-label={`删除 ${getDocumentTitle(document)}`}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
