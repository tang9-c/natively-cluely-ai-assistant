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
    modeTemplateType: 'sales' | 'fde' | 'recruiting';
    parentActionType: string;
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
        asIsProcess?: string;
        targetProcess?: string;
        processObject?: string;
        roles?: string[];
        handoffs?: string[];
        exceptions?: string[];
        humanConfirmation?: string;
        aiSupportNeed?: string;
        systems?: string[];
        permissionBoundary?: string;
        integrationMethod?: string;
        scorecardDimension?: string;
        evidenceObserved?: string;
        missingEvidence?: string[];
        starMissing?: string[];
        candidateClaim?: string;
        riskToVerify?: string;
        recommendedProbe?: string;
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

        const prompt = buildContinuationPlannerPrompt(input);

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

        const extractedSlots = parseContinuationSlots(parsed.extractedSlots, input.modeTemplateType);
        return {
            decision: decision as ContinuationPlannerDecision,
            confidence,
            extractedSlots,
            reasonCode: reasonCode as ContinuationPlannerResult['reasonCode'],
            decisionSource: 'continuation_planner',
        };
    }
}

const SALES_SLOT_KEYS = new Set(['object', 'workflow', 'metrics', 'environment', 'validationNeed', 'systemObjects']);
const FDE_SLOT_KEYS = new Set([
    'asIsProcess',
    'targetProcess',
    'processObject',
    'roles',
    'handoffs',
    'exceptions',
    'humanConfirmation',
    'aiSupportNeed',
    'validationNeed',
    'systems',
    'permissionBoundary',
    'environment',
    'integrationMethod',
]);
const RECRUITING_SLOT_KEYS = new Set([
    'scorecardDimension',
    'evidenceObserved',
    'missingEvidence',
    'starMissing',
    'candidateClaim',
    'riskToVerify',
    'recommendedProbe',
]);
const ARRAY_SLOT_KEYS = new Set([
    'metrics',
    'systemObjects',
    'roles',
    'handoffs',
    'exceptions',
    'systems',
    'missingEvidence',
    'starMissing',
]);

export function parseContinuationSlots(
    value: unknown,
    modeTemplateType: 'sales' | 'fde' | 'recruiting' = 'sales',
): ContinuationPlannerResult['extractedSlots'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ContinuationPlannerError('planner_invalid_json');
    }
    const record = value as Record<string, unknown>;
    const allowedKeys = modeTemplateType === 'fde'
        ? FDE_SLOT_KEYS
        : modeTemplateType === 'recruiting'
            ? RECRUITING_SLOT_KEYS
            : SALES_SLOT_KEYS;
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
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

export function buildFdeContinuationDerivedActionContext(input: {
    originalTurn: string;
    currentTurn: string;
    slots: ContinuationPlannerResult['extractedSlots'];
}): { keyEntities: string[]; retrievalQuery: string } {
    const slots = input.slots;
    const keyEntities = uniqueStrings([
        slots.processObject,
        slots.asIsProcess,
        slots.targetProcess,
        slots.humanConfirmation,
        slots.aiSupportNeed,
        slots.validationNeed,
        ...(slots.roles ?? []),
        ...(slots.handoffs ?? []),
        ...(slots.exceptions ?? []),
        ...(slots.systems ?? []),
    ]).slice(0, 12);

    const retrievalQuery = [
        input.originalTurn,
        input.currentTurn,
        slots.asIsProcess && `当前流程: ${slots.asIsProcess}`,
        slots.targetProcess && `目标流程: ${slots.targetProcess}`,
        slots.processObject && `流程对象: ${slots.processObject}`,
        slots.humanConfirmation && `人审点: ${slots.humanConfirmation}`,
        slots.aiSupportNeed && `AI 支持需求: ${slots.aiSupportNeed}`,
        slots.validationNeed && `验证需求: ${slots.validationNeed}`,
    ].filter((value): value is string => Boolean(value && value.trim())).join('\n');

    return { keyEntities, retrievalQuery };
}

export function buildRecruitingContinuationDerivedActionContext(input: {
    originalTurn: string;
    currentTurn: string;
    slots: ContinuationPlannerResult['extractedSlots'];
}): { keyEntities: string[]; retrievalQuery: string } {
    const slots = input.slots;
    const keyEntities = uniqueStrings([
        slots.scorecardDimension,
        slots.evidenceObserved,
        slots.candidateClaim,
        slots.riskToVerify,
        slots.recommendedProbe,
        ...(slots.missingEvidence ?? []),
        ...(slots.starMissing ?? []),
    ]).slice(0, 12);
    const retrievalQuery = [
        input.originalTurn,
        input.currentTurn,
        slots.evidenceObserved && `已观察证据: ${slots.evidenceObserved}`,
        slots.missingEvidence?.length && `缺失证据: ${slots.missingEvidence.join('；')}`,
        slots.starMissing?.length && `STAR 缺失: ${slots.starMissing.join('；')}`,
        slots.riskToVerify && `验证需求: ${slots.riskToVerify}`,
    ].filter((value): value is string => Boolean(value && value.trim())).join('\n').slice(0, 800);

    return { keyEntities, retrievalQuery };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function buildContinuationPlannerPrompt(input: ContinuationPlannerInput): string {
    const commonLines = [
        `sourceIntent: ${input.sourceIntent}`,
        `parentActionType: ${input.parentActionType}`,
        `originalTurn: ${JSON.stringify(input.originalTurn)}`,
        `keyEntities: ${JSON.stringify(input.keyEntities.slice(0, 12))}`,
        `customerTurns: ${JSON.stringify(input.collectedCustomerTurns.slice(-6))}`,
        `currentTurn: ${JSON.stringify(input.currentTurn)}`,
        '返回格式: {"decision":"...","confidence":0.0,"extractedSlots":{},"reasonCode":"..."}',
    ];

    if (input.modeTemplateType === 'fde') {
        return [
            '你是 FDE 会议 continuation planner。只返回 JSON，不生成回答。',
            'FDE 场景优先判断客户是否补齐了制造业流程信息，而不是系统架构细节。',
            '重点识别当前流程、目标流程、流程对象、角色、交接、例外、人审点、AI 支持需求、验证方式。',
            '系统、权限、环境和集成方式只作为支撑字段；只有客户明确提到时才抽取。',
            '允许的 extractedSlots key 只有 asIsProcess、targetProcess、processObject、roles、handoffs、exceptions、humanConfirmation、aiSupportNeed、validationNeed、systems、permissionBoundary、environment、integrationMethod。',
            'decision 只能是 trigger_grounded_answer、continue_collecting、ignore。',
            ...commonLines,
        ].join('\n');
    }

    if (input.modeTemplateType === 'recruiting') {
        return [
            '你是 recruiting continuation planner。只返回 JSON，不生成用户可见回答。',
            '不要判断或输出当前使用哪种面试方法。',
            '只判断候选人是否补充了与岗位相关、可验证的个人行动、结果、ownership、取舍或风险处理证据。',
            '把未被回答支持的内容放入 missingEvidence 或 riskToVerify，不要推断录用、淘汰或候选人等级。',
            '允许的 extractedSlots key 只有 scorecardDimension、evidenceObserved、missingEvidence、starMissing、candidateClaim、riskToVerify、recommendedProbe。',
            'decision 只能是 trigger_grounded_answer、continue_collecting、ignore。',
            ...commonLines,
        ].join('\n');
    }

    return [
        '你是销售会议 continuation planner。只返回 JSON，不生成回答。',
        '判断客户是否补齐了对象、工作流、指标、环境或验证要求。',
        'decision 只能是 trigger_grounded_answer、continue_collecting、ignore。',
        ...commonLines,
    ].join('\n');
}
