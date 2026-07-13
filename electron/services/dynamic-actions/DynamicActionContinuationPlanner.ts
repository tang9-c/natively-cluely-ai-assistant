import {
    assertProviderDataScopes,
    ProviderScopeError,
    type ProviderDataScopePolicy,
} from '../../llm/ProviderRouter';
import type { DynamicActionContinuationSourceIntent } from './DynamicActionContinuation';

export type ContinuationPlannerDecision = 'trigger_grounded_answer' | 'continue_collecting' | 'ignore';
export type ContinuationPlannerFailureReason =
    | 'provider_scope_denied'
    | 'planner_timeout'
    | 'planner_invalid_json'
    | 'planner_provider_unavailable';

export interface ContinuationPlannerInput {
    modeTemplateType: 'sales';
    sourceIntent: DynamicActionContinuationSourceIntent;
    originalTurn: string;
    keyEntities: string[];
    collectedCustomerTurns: Array<{ text: string; timestamp: number }>;
    currentTurn: { text: string; timestamp: number };
    providerDataScopes?: ProviderDataScopePolicy;
}

export interface ContinuationPlannerResult {
    decision: ContinuationPlannerDecision;
    confidence: number;
    extractedSlots: {
        object?: string;
        workflow?: string;
        metrics?: string[];
        environment?: string;
        validationNeed?: string;
        systemObjects?: string[];
    };
    reasonCode: 'sufficient_customer_detail' | 'insufficient_customer_detail' | 'unrelated_turn';
    decisionSource: 'continuation_planner';
}

export class ContinuationPlannerError extends Error {
    constructor(readonly reason: ContinuationPlannerFailureReason) {
        super(reason);
        this.name = 'ContinuationPlannerError';
    }
}

export class DynamicActionContinuationPlanner {
    constructor(private readonly generateStructured: (prompt: string, options: {
        taskLabel: string;
        maxOutputTokens: number;
        perProviderTimeoutMs: number;
        maxRotations: number;
    }) => Promise<string>) {}

    async decide(input: ContinuationPlannerInput): Promise<ContinuationPlannerResult> {
        try {
            assertProviderDataScopes(
                'dynamic-action-continuation-planner',
                ['transcript'],
                input.providerDataScopes,
            );
        } catch (error) {
            if (error instanceof ProviderScopeError) {
                throw new ContinuationPlannerError('provider_scope_denied');
            }
            throw error;
        }

        const prompt = [
            '你是销售会议 continuation planner。只返回 JSON，不生成回答。',
            '判断客户是否补齐了对象、工作流、指标、环境或验证要求。',
            'decision 只能是 trigger_grounded_answer、continue_collecting、ignore。',
            `sourceIntent: ${input.sourceIntent}`,
            `originalTurn: ${JSON.stringify(input.originalTurn)}`,
            `keyEntities: ${JSON.stringify(input.keyEntities.slice(0, 12))}`,
            `customerTurns: ${JSON.stringify(input.collectedCustomerTurns.slice(-6))}`,
            '返回格式: {"decision":"...","confidence":0.0,"extractedSlots":{},"reasonCode":"..."}',
        ].join('\n');

        let raw: string;
        try {
            raw = await this.generateStructured(prompt, {
                taskLabel: 'dynamic-action-continuation-planner',
                maxOutputTokens: 256,
                perProviderTimeoutMs: 1500,
                maxRotations: 1,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            throw new ContinuationPlannerError(/timeout|timed out/i.test(message)
                ? 'planner_timeout'
                : 'planner_provider_unavailable');
        }

        const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonText) throw new ContinuationPlannerError('planner_invalid_json');

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(jsonText);
        } catch {
            throw new ContinuationPlannerError('planner_invalid_json');
        }

        const allowedKeys = new Set(['decision', 'confidence', 'extractedSlots', 'reasonCode']);
        if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
            throw new ContinuationPlannerError('planner_invalid_json');
        }

        const decision = parsed.decision;
        const confidence = Number(parsed.confidence);
        const reasonCode = parsed.reasonCode;
        if (
            !['trigger_grounded_answer', 'continue_collecting', 'ignore'].includes(String(decision)) ||
            !Number.isFinite(confidence) ||
            confidence < 0 ||
            confidence > 1 ||
            !['sufficient_customer_detail', 'insufficient_customer_detail', 'unrelated_turn'].includes(String(reasonCode))
        ) {
            throw new ContinuationPlannerError('planner_invalid_json');
        }

        const extractedSlots = parseContinuationSlots(parsed.extractedSlots);
        return {
            decision: decision as ContinuationPlannerDecision,
            confidence,
            extractedSlots,
            reasonCode: reasonCode as ContinuationPlannerResult['reasonCode'],
            decisionSource: 'continuation_planner',
        };
    }
}

const SLOT_KEYS = new Set(['object', 'workflow', 'metrics', 'environment', 'validationNeed', 'systemObjects']);
const ARRAY_SLOT_KEYS = new Set(['metrics', 'systemObjects']);

export function parseContinuationSlots(value: unknown): ContinuationPlannerResult['extractedSlots'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ContinuationPlannerError('planner_invalid_json');
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !SLOT_KEYS.has(key))) {
        throw new ContinuationPlannerError('planner_invalid_json');
    }
    const result: Record<string, string | string[]> = {};
    for (const [key, item] of Object.entries(record)) {
        if (ARRAY_SLOT_KEYS.has(key)) {
            if (!Array.isArray(item) || item.length > 12 || item.some((entry) =>
                typeof entry !== 'string' || !entry.trim() || entry.trim().length > 120)) {
                throw new ContinuationPlannerError('planner_invalid_json');
            }
            result[key] = item.map((entry) => entry.trim());
            continue;
        }
        if (typeof item !== 'string' || !item.trim() || item.trim().length > 240) {
            throw new ContinuationPlannerError('planner_invalid_json');
        }
        result[key] = item.trim();
    }
    return result as ContinuationPlannerResult['extractedSlots'];
}
