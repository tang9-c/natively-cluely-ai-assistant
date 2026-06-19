import React from 'react';

import { ReferenceMaterialsCard } from './cards/ReferenceMaterialsCard';
import { ScenarioSummaryCard } from './cards/ScenarioSummaryCard';
import type { ScenarioCard, ScenarioDocument } from './types';

interface CardRendererProps {
    card: ScenarioCard;
    documents: ScenarioDocument[];
    uploading: boolean;
    onUpload: (docSubtype: string) => void;
    onDelete: (document: ScenarioDocument) => void;
}

const cardRenderers = {
    'reference-materials': ReferenceMaterialsCard,
    'scenario-summary': ScenarioSummaryCard,
};

export function CardRenderer(props: CardRendererProps) {
    const Renderer = cardRenderers[props.card.componentKey as keyof typeof cardRenderers];

    if (!Renderer) {
        return (
            <div className="rounded-lg border border-border-subtle bg-bg-input/35 p-4">
                <h5 className="text-[13px] font-bold text-text-primary">{props.card.title}</h5>
                <p className="mt-1 text-[11px] text-text-secondary">{props.card.description}</p>
                <p className="mt-4 text-[11px] text-text-tertiary">
                    该资料类型暂未配置专属卡片。
                </p>
            </div>
        );
    }

    return <Renderer {...props} />;
}
