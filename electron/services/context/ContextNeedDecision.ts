import type { EvidenceRef } from '../dynamic-actions/DynamicAction';
import { MODE_TRIGGERS } from '../dynamic-actions/DynamicActionDetector';
export type {
    ContextNeedDecision,
    ContextNeedDecisionSource,
    ContextNeedLevel,
} from '../../../shared/contextNeedDecision';
import type {
    ContextNeedDecision,
    ContextNeedDecisionSource,
    ContextNeedLevel,
} from '../../../shared/contextNeedDecision';

// `dynamic_action_contract` is the only producer today. The other source labels
// reserve the IPC/telemetry contract for the planned LLM semantic gate and
// speculative-answer context decision producers.

export const UNKNOWN_CONTEXT_NEED_DECISION: ContextNeedDecision = {
    material: 'unknown',
    business: 'unknown',
    screen: 'unknown',
    confidence: 0,
    reason: 'No context need decision was available.',
    decidedBy: 'unknown',
};

const LEVELS = new Set<ContextNeedLevel>([
    'required',
    'use_if_ready',
    'not_needed',
    'unknown',
]);

const SOURCES = new Set<ContextNeedDecisionSource>([
    'llm_semantic_gate',
    'dynamic_action_contract',
    'cached_speculative',
    'unknown',
]);

export const MATERIAL_ACTION_TYPES = new Set([
    'case_study_request',
]);

export const KNOWN_CONTEXT_DECISION_ACTION_TYPES = new Set(
    Object.values(MODE_TRIGGERS)
        .flat()
        .map((trigger) => trigger.type),
);

const MATERIAL_SIGNAL_PATTERN = /\b(case study|customer case|roi|proof|reference|deck|pptx|pdf|uploaded|material|document)\b|案例|客户案例|证明|佐证|资料|材料|文档|知识库|PPT|PDF/i;
const BUSINESS_SIGNAL_PATTERN = /\b(PLM|Windchill|QMS|BOM|ECO|ECN|CAPA|NCR|part|material|change order|workflow)\b|业务系统|物料|图纸|变更|质量记录|审批|工单/i;

function clampConfidence(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function compact(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function summarizeEvidence(evidenceRefs?: EvidenceRef[]): string {
    return (evidenceRefs || [])
        .map((ref) => compact(ref.text))
        .filter(Boolean)
        .slice(0, 4)
        .join(' ');
}

function normalizeLevel(value: unknown): ContextNeedLevel {
    return typeof value === 'string' && LEVELS.has(value as ContextNeedLevel)
        ? value as ContextNeedLevel
        : 'unknown';
}

function normalizeSource(value: unknown): ContextNeedDecisionSource {
    return typeof value === 'string' && SOURCES.has(value as ContextNeedDecisionSource)
        ? value as ContextNeedDecisionSource
        : 'unknown';
}

export function sanitizeContextNeedDecision(value: unknown): ContextNeedDecision | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    const reason = compact(raw.reason).slice(0, 240) || UNKNOWN_CONTEXT_NEED_DECISION.reason;
    return {
        material: normalizeLevel(raw.material),
        business: normalizeLevel(raw.business),
        screen: normalizeLevel(raw.screen),
        confidence: clampConfidence(raw.confidence),
        reason,
        decidedBy: normalizeSource(raw.decidedBy),
    };
}

export function buildDynamicActionContextNeedDecision(input: {
    type: string;
    label: string;
    modeTemplateType?: string;
    confidence?: number;
    evidenceRefs?: EvidenceRef[];
}): ContextNeedDecision {
    const type = compact(input.type);
    const text = [
        type,
        input.label,
        input.modeTemplateType,
        summarizeEvidence(input.evidenceRefs),
    ].join(' ');
    const evidenceHasScreen = (input.evidenceRefs || []).some((ref) => ref.source === 'screen');
    const materialRequired = MATERIAL_ACTION_TYPES.has(type) || MATERIAL_SIGNAL_PATTERN.test(text);
    const businessRequired = BUSINESS_SIGNAL_PATTERN.test(text);
    const knownAction = KNOWN_CONTEXT_DECISION_ACTION_TYPES.has(type) || MATERIAL_ACTION_TYPES.has(type);

    if (!knownAction && !materialRequired && !businessRequired && !evidenceHasScreen) {
        return {
            ...UNKNOWN_CONTEXT_NEED_DECISION,
            confidence: clampConfidence(input.confidence),
            reason: `Unknown action type: ${type || 'missing'}.`,
        };
    }

    return {
        material: materialRequired
            ? 'required'
            : businessRequired
                ? 'use_if_ready'
                : 'not_needed',
        business: businessRequired ? 'required' : 'not_needed',
        screen: evidenceHasScreen ? 'required' : 'not_needed',
        confidence: clampConfidence(input.confidence || 0.8),
        reason: businessRequired
            ? 'Dynamic action evidence indicates business-system grounding may be needed.'
            : materialRequired
                ? 'Dynamic action answer should be grounded in uploaded materials when available.'
                : 'Dynamic action contract does not require external context.',
        decidedBy: 'dynamic_action_contract',
    };
}
