import React from 'react';
import { FileText, Trash2 } from 'lucide-react';

import type { ScenarioCard, ScenarioDocument } from '../types';

interface ReferenceMaterialsCardProps {
    card: ScenarioCard;
    documents: ScenarioDocument[];
    uploading: boolean;
    onUpload: (docSubtype: string) => void;
    onDelete: (document: ScenarioDocument) => void;
}

function getDocumentTitle(document: ScenarioDocument): string {
    return document.title || document.fileName || document.path?.split('/').pop() || '未命名资料';
}

export function ReferenceMaterialsCard({
    card,
    documents,
    uploading,
    onUpload,
    onDelete,
}: ReferenceMaterialsCardProps) {
    return (
        <div className="h-full rounded-lg border border-border-subtle bg-bg-input/45 p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h5 className="text-[13px] font-bold text-text-primary">{card.title}</h5>
                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{card.description}</p>
                </div>
                <button
                    type="button"
                    onClick={() => onUpload(card.docSubtype)}
                    disabled={uploading}
                    className="shrink-0 rounded-full border border-border-subtle bg-bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-primary transition-colors hover:bg-bg-input disabled:cursor-progress disabled:opacity-60"
                >
                    {uploading ? '上传中' : '添加'}
                </button>
            </div>

            <div className="mt-4 space-y-2">
                {documents.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border-subtle px-3 py-4 text-[11px] text-text-tertiary">
                        暂无资料
                    </div>
                ) : (
                    documents.map((document) => (
                        <div
                            key={document.id}
                            className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-surface/70 px-3 py-2"
                        >
                            <FileText size={14} className="shrink-0 text-text-tertiary" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-medium text-text-primary">
                                    {getDocumentTitle(document)}
                                </p>
                                <p className="text-[10px] text-text-tertiary">
                                    {document.updatedAt || document.updated_at || document.createdAt || document.created_at || '已加入档案'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => onDelete(document)}
                                className="rounded-full p-1.5 text-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-500"
                                aria-label={`删除 ${getDocumentTitle(document)}`}
                            >
                                <Trash2 size={13} />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
