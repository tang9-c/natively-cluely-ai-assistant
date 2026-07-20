import * as crypto from 'crypto';
import type { AnswerCitationRecord, AnswerDegradedReason } from '../../db/DatabaseManager';
import type { RealtimeContextCandidate, RealtimeContextPlan } from '../context/RealtimeContextOrchestrator';
import type { BusinessSystemServiceResult } from '../business-system/BusinessSystemContextService';
import type { ActionArtifact } from './DynamicActionArtifacts';

export interface InjectedGroundingEvidence {
    evidenceId: string;
    type: 'material' | 'pptx' | 'business_context';
    label: string;
    sourceId: string;
    excerpt: string;
}

export interface DynamicActionRuntimeGrounding {
    groundedSources: ActionArtifact['groundedSources'];
    injectedEvidence: InjectedGroundingEvidence[];
}

export function buildDynamicActionRuntimeGrounding(input: {
    actionType?: string;
    realtimeContextPlan: RealtimeContextPlan;
    citations: AnswerCitationRecord[];
    materialRagAttempted: boolean;
    uploadedMaterialHitCount: number;
    degradedReasons: AnswerDegradedReason[];
    businessSystemResult: BusinessSystemServiceResult;
}): DynamicActionRuntimeGrounding {
    if (!['capability_fit_answer', 'fde_grounded_answer'].includes(input.actionType ?? '')) {
        return { groundedSources: [], injectedEvidence: [] };
    }

    const injectedEvidence = input.realtimeContextPlan.injected
        .filter((candidate) => candidate.source === 'uploaded_material' || candidate.source === 'business_system')
        .map((candidate) => {
            const citation = input.citations.find((item) =>
                item.sourceId === candidate.sourceId &&
                String(item.chunkId ?? '') === String(candidate.chunkId ?? ''));
            const identity = `${citation?.title ?? ''} ${candidate.sourceId}`;
            const type = candidate.source === 'business_system'
                ? 'business_context' as const
                : /\.pptx(?:\s|$)/i.test(identity)
                    ? 'pptx' as const
                    : 'material' as const;
            return {
                evidenceId: createEvidenceId(candidate),
                type,
                label: sanitizeGroundingLabel(citation?.title || candidate.sourceId),
                sourceId: candidate.sourceId,
                excerpt: candidate.text.slice(0, 1_200),
            };
        });

    const groundedSources: ActionArtifact['groundedSources'] = injectedEvidence.map((item) => ({
        evidenceId: item.evidenceId,
        type: item.type,
        label: item.label,
        status: 'used',
    }));

    appendNonUsedSourceStatuses(groundedSources, input);
    return { groundedSources, injectedEvidence };
}

function createEvidenceId(candidate: RealtimeContextCandidate): string {
    return crypto.createHash('sha256')
        .update([
            candidate.source,
            candidate.sourceId,
            candidate.chunkId ?? '',
            candidate.text,
        ].join('|'))
        .digest('hex')
        .slice(0, 24);
}

function sanitizeGroundingLabel(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 160) || 'trusted context';
}

function appendNonUsedSourceStatuses(
    groundedSources: ActionArtifact['groundedSources'],
    input: {
        materialRagAttempted: boolean;
        uploadedMaterialHitCount: number;
        degradedReasons: AnswerDegradedReason[];
        businessSystemResult: BusinessSystemServiceResult;
    },
): void {
    const hasUsedMaterial = groundedSources.some((source) =>
        (source.type === 'material' || source.type === 'pptx') && source.status === 'used');
    if (input.materialRagAttempted && !hasUsedMaterial && input.uploadedMaterialHitCount === 0) {
        groundedSources.push({ type: 'material', label: 'uploaded material search', status: 'not_found' });
    }
    if (input.degradedReasons.includes('uploaded_material_context_truncated') && !hasUsedMaterial) {
        groundedSources.push({ type: 'material', label: 'uploaded material context', status: 'failed' });
    }
    if (input.businessSystemResult.kind === 'fixed_reply') {
        groundedSources.push({ type: 'business_context', label: input.businessSystemResult.sourceName || 'business system', status: 'failed' });
    }
}
