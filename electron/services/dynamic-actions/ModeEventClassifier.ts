import type { IntentResult } from '../../llm/IntentClassifier';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';

export type SemanticGateDecision = 'pass' | 'reject' | 'defer' | 'fast_path';
export type SemanticGateProvider = 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable';
export type SemanticGateArbitrationStatus =
    'cloud_used' |
    'local_only_by_privacy' |
    'local_fallback_cloud_unavailable' |
    'cloud_unavailable' |
    'local_only_not_needed';
export type CloudSemanticGateFailureReason =
    'cloud_timeout' |
    'cloud_invalid_json' |
    'cloud_provider_unavailable';

export class CloudSemanticGateError extends Error {
    constructor(readonly reason: CloudSemanticGateFailureReason, message?: string) {
        super(message ?? reason);
        this.name = 'CloudSemanticGateError';
    }
}

export interface ModeEventContextTurn {
    role?: string;
    speaker?: string;
    text: string;
    timestamp?: number;
}

export interface ModeEventCandidate {
    actionType: string;
    label: string;
    match: string;
    confidence: number;
    highRisk: boolean;
    fastPathEligible: boolean;
}

export interface SemanticGateTrace {
    decision: SemanticGateDecision;
    actionType: string;
    semanticIntent?: string;
    confidence: number;
    reasons: string[];
    regexCandidates: string[];
    rejectedCandidates: string[];
    usedLocalIntentModel: boolean;
    usedCloudArbitration: boolean;
    semanticProvider: SemanticGateProvider;
    arbitrationStatus: SemanticGateArbitrationStatus;
    degradedReason?: string;
    upgradedByRepeatedEvidence: boolean;
}

export interface ModeEventGateDecision {
    candidate: ModeEventCandidate;
    decision: SemanticGateDecision;
    confidence: number;
    semanticIntent?: string;
    reasons: string[];
    rejectedCandidates: string[];
    usedLocalIntentModel: boolean;
    usedCloudArbitration: boolean;
    semanticProvider: SemanticGateProvider;
    arbitrationStatus: SemanticGateArbitrationStatus;
    degradedReason?: string;
}

export interface CloudSemanticGateInput {
    transcript: string;
    recentContextTurns: ModeEventContextTurn[];
    modeTemplateType: string;
    speaker?: string;
    candidates: ModeEventCandidate[];
    intentResult?: IntentResult;
}

export interface CloudSemanticGateResult {
    actionType: string;
    decision: Extract<SemanticGateDecision, 'pass' | 'reject' | 'defer'>;
    confidence: number;
    semanticIntent?: string;
    reasons?: string[];
    rejectedCandidates?: string[];
}

export interface ModeEventGateInput {
    transcript: string;
    recentContextTurns?: ModeEventContextTurn[];
    modeTemplateType: string;
    speaker?: string;
    candidates: ModeEventCandidate[];
    activeActionTypes?: string[];
    intentResult?: IntentResult;
    providerDataScopes?: ProviderDataScopePolicy;
    cloudClassifier?: CloudSemanticGateClassifier;
}

export type CloudSemanticGateClassifier = (input: CloudSemanticGateInput) => Promise<CloudSemanticGateResult[] | null>;

export interface ModeEventClassifierOptions {
    cloudClassifier?: CloudSemanticGateClassifier;
}

const HIGH_RISK_ACTIONS = new Set([
    'pricing_objection',
    'pricing_request',
    'case_study_request',
    'discovery_question',
    'technical_requirements',
    'buying_signal',
]);

const FAST_PATH_ACTIONS = new Set([
    'send_contract',
    'schedule_meeting',
    'coding_problem',
    'action_item',
]);

function includesAny(text: string, terms: string[]): boolean {
    const lower = text.toLowerCase();
    return terms.some(term => lower.includes(term.toLowerCase()));
}

function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function isCloudGateDecision(value: unknown): value is CloudSemanticGateResult['decision'] {
    return value === 'pass' || value === 'reject' || value === 'defer';
}

function isTimeoutError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
    return code === 'ETIMEDOUT' || /timeout|timed out/i.test(message);
}

export function cloudFailureReasonFromError(error: unknown): CloudSemanticGateFailureReason {
    if (error instanceof CloudSemanticGateError) return error.reason;
    if (error && typeof error === 'object' && 'reason' in error) {
        const reason = (error as { reason?: unknown }).reason;
        if (reason === 'cloud_timeout' || reason === 'cloud_invalid_json' || reason === 'cloud_provider_unavailable') {
            return reason;
        }
    }
    return isTimeoutError(error) ? 'cloud_timeout' : 'cloud_provider_unavailable';
}

function normalizeCloudResults(
    rawResults: unknown,
    validTypes: Set<string>
): { results: CloudSemanticGateResult[]; failureReason?: CloudSemanticGateFailureReason } {
    if (rawResults == null) {
        return { results: [], failureReason: 'cloud_provider_unavailable' };
    }
    if (!Array.isArray(rawResults)) {
        return { results: [], failureReason: 'cloud_invalid_json' };
    }

    const results: CloudSemanticGateResult[] = [];
    let hasInvalidResult = false;
    for (const result of rawResults) {
        if (!result || typeof result !== 'object') {
            hasInvalidResult = true;
            continue;
        }
        const item = result as Partial<CloudSemanticGateResult>;
        if (
            typeof item.actionType !== 'string' ||
            !validTypes.has(item.actionType) ||
            !isCloudGateDecision(item.decision) ||
            !Number.isFinite(item.confidence)
        ) {
            hasInvalidResult = true;
            continue;
        }
        results.push({
            actionType: item.actionType,
            decision: item.decision,
            confidence: item.confidence,
            semanticIntent: typeof item.semanticIntent === 'string' ? item.semanticIntent : undefined,
            reasons: Array.isArray(item.reasons) ? item.reasons.filter(reason => typeof reason === 'string') : undefined,
            rejectedCandidates: Array.isArray(item.rejectedCandidates)
                ? item.rejectedCandidates.filter(candidate => typeof candidate === 'string')
                : undefined,
        });
    }

    return {
        results,
        failureReason: hasInvalidResult ? 'cloud_invalid_json' : undefined,
    };
}

function isEnglishOrMixed(text: string): boolean {
    return /[A-Za-z]/.test(text);
}

function localDecisionFor(input: ModeEventGateInput, candidate: ModeEventCandidate): ModeEventGateDecision | null {
    const text = input.transcript;
    const base = {
        candidate,
        rejectedCandidates: [] as string[],
        usedLocalIntentModel: false,
        usedCloudArbitration: false,
        arbitrationStatus: 'local_only_not_needed' as const,
    };
    const intent = input.intentResult?.intent;
    const intentConfidence = input.intentResult?.confidence ?? 0;

    if (intentConfidence >= 0.85) {
        const intentMatchesCandidate =
            (candidate.actionType === 'pricing_objection' && intent === 'handle_objection') ||
            (candidate.actionType === 'pricing_objection' && intent === 'sales_pricing_objection') ||
            (candidate.actionType === 'buying_signal' && intent === 'seize_signal') ||
            (candidate.actionType === 'buying_signal' && intent === 'sales_buying_signal') ||
            (candidate.actionType === 'pricing_request' && intent === 'sales_quote_request') ||
            (candidate.actionType === 'case_study_request' && intent === 'sales_proof_request') ||
            (candidate.actionType === 'discovery_question' && (
                intent === 'sales_pain_discovery' ||
                intent === 'sales_capability_fit' ||
                intent === 'sales_process_integration' ||
                intent === 'sales_value_discovery' ||
                intent === 'sales_contextual_proof_discovery'
            )) ||
            (candidate.actionType === 'technical_requirements' && intent === 'sales_technical_requirements') ||
            (candidate.actionType === 'technical_requirements' && intent === 'fde_integration') ||
            (candidate.actionType === 'case_study_request' && intent === 'example_request');
        if (intentMatchesCandidate) {
            return {
                ...base,
                decision: 'pass',
                confidence: Math.max(candidate.confidence, intentConfidence),
                semanticIntent: intent,
                reasons: ['intent_result_confirms_candidate'],
                usedLocalIntentModel: true,
                semanticProvider: 'local_intent',
            };
        }
    }

    if (candidate.actionType === 'pricing_objection') {
        if (includesAny(text, ['price list', 'pricing page', '成本数据', '价格先放一边'])) {
            return {
                ...base,
                decision: 'reject',
                confidence: 0.85,
                semanticIntent: 'neutral_pricing_reference',
                reasons: ['neutral_pricing_reference'],
                semanticProvider: 'local_intent',
            };
        }
        if (includesAny(text, ['too expensive', 'too pricey', 'too high', 'out of budget', '价格太高', '报价太高', '太贵', '超出预算', '预算过不了', '预算这一关就过不了', '预算不够', '预算不足'])) {
            return {
                ...base,
                decision: 'pass',
                confidence: Math.max(candidate.confidence, 0.9),
                semanticIntent: 'pricing_objection',
                reasons: ['explicit_price_pushback'],
                semanticProvider: 'local_intent',
            };
        }
    }

    if (candidate.actionType === 'pricing_request') {
        if (includesAny(text, ['price list', 'pricing page', '成本数据', '价格页'])) {
            return {
                ...base,
                decision: 'reject',
                confidence: 0.82,
                semanticIntent: 'neutral_pricing_reference',
                reasons: ['neutral_pricing_reference'],
                semanticProvider: 'local_intent',
            };
        }
        if (includesAny(text, ['send me pricing', 'quote', 'proposal', 'what does it cost', '发我报价', '报价单', '发一版报价', '给客户发一版报价', '报个价格', '给个价格', '多少钱'])) {
            return {
                ...base,
                decision: 'pass',
                confidence: Math.max(candidate.confidence, 0.88),
                semanticIntent: 'pricing_request',
                reasons: ['explicit_quote_or_pricing_request'],
                semanticProvider: 'local_intent',
            };
        }
    }

    if (candidate.actionType === 'buying_signal' && includesAny(text, ['send contract', 'legal review', 'finalize', '发合同', '法务审核', '放假审核', '准备签', '准备推进', '想推进到', '推进到法务', '推进到放假', '安排时间', '敲定'])) {
        return {
            ...base,
            decision: 'pass',
            confidence: Math.max(candidate.confidence, 0.9),
            semanticIntent: 'explicit_next_step_or_contract',
            reasons: ['explicit_next_step_or_contract'],
            semanticProvider: 'local_intent',
        };
    }

    if (candidate.actionType === 'case_study_request' && includesAny(text, [
        'case study',
        'customer proof',
        'customer story',
        'customer example',
        'similar customer',
        'proof point',
        'success story',
        '客户案例',
        '成功案例',
        '案例证明',
        '证明 ROI',
        '证明roi',
        '想看案例',
        '类似客户',
        '证明材料',
        '标杆客户',
        '落地案例',
        '实施案例',
    ])) {
        return {
            ...base,
            decision: 'pass',
            confidence: Math.max(candidate.confidence, 0.88),
            semanticIntent: 'case_or_proof_request',
            reasons: ['case_or_proof_request'],
            semanticProvider: 'local_intent',
        };
    }

    if (candidate.actionType === 'technical_requirements' && includesAny(text, ['API', 'SSO', 'production', 'integration', 'technical solution', 'integration requirements', '技术方案', '生产环境', '部署要求', '集成要求'])) {
        return {
            ...base,
            decision: 'pass',
            confidence: Math.max(candidate.confidence, 0.88),
            semanticIntent: 'technical_requirements',
            reasons: ['technical_or_integration_need'],
            semanticProvider: 'local_intent',
        };
    }

    return null;
}

function shouldUseCloud(input: ModeEventGateInput): boolean {
    if (input.providerDataScopes?.transcript === false) return false;
    const highRiskCount = input.candidates.filter(candidate => candidate.highRisk).length;
    return highRiskCount > 0 && (
        isEnglishOrMixed(input.transcript) ||
        highRiskCount > 1 ||
        includesAny(input.transcript, ['but', 'however', '先放一边', '不是', '不要', '先不'])
    );
}

function shouldUseCloudBeforeLocal(input: ModeEventGateInput, candidate: ModeEventCandidate): boolean {
    if (input.providerDataScopes?.transcript === false) return false;
    if (!(candidate.highRisk || HIGH_RISK_ACTIONS.has(candidate.actionType))) return false;
    const highRiskCount = input.candidates.filter(item => item.highRisk || HIGH_RISK_ACTIONS.has(item.actionType)).length;
    return isEnglishOrMixed(input.transcript) ||
        highRiskCount > 1 ||
        includesAny(input.transcript, ['but', 'however', '先放一边', '不是', '不要', '先不']);
}

export class ModeEventClassifier {
    constructor(private readonly options: ModeEventClassifierOptions = {}) {}

    async assess(input: ModeEventGateInput): Promise<ModeEventGateDecision[]> {
        const decisions = new Map<string, ModeEventGateDecision>();

        for (const candidate of input.candidates) {
            const fastPath = candidate.fastPathEligible || FAST_PATH_ACTIONS.has(candidate.actionType);
            const highRisk = candidate.highRisk || HIGH_RISK_ACTIONS.has(candidate.actionType);

            if (fastPath && !highRisk) {
                decisions.set(candidate.actionType, {
                    candidate,
                    decision: 'fast_path',
                    confidence: clampConfidence(candidate.confidence),
                    semanticIntent: candidate.actionType,
                    reasons: ['rule_fast_path'],
                    rejectedCandidates: [],
                    usedLocalIntentModel: false,
                    usedCloudArbitration: false,
                    semanticProvider: 'rule_fast_path',
                    arbitrationStatus: 'local_only_not_needed',
                });
                continue;
            }

            if (highRisk && input.providerDataScopes?.transcript === false) {
                continue;
            }

            if (shouldUseCloudBeforeLocal(input, candidate) && (input.cloudClassifier || this.options.cloudClassifier)) {
                continue;
            }

            const localDecision = localDecisionFor(input, candidate);
            if (localDecision) {
                decisions.set(candidate.actionType, localDecision);
                continue;
            }

            if (!highRisk) {
                decisions.set(candidate.actionType, {
                    candidate,
                    decision: 'pass',
                    confidence: clampConfidence(candidate.confidence),
                    semanticIntent: candidate.actionType,
                    reasons: ['low_risk_candidate'],
                    rejectedCandidates: [],
                    usedLocalIntentModel: false,
                    usedCloudArbitration: false,
                    semanticProvider: 'local_intent',
                    arbitrationStatus: 'local_only_not_needed',
                });
            }
        }

        const unresolvedHighRisk = input.candidates.filter(candidate =>
            (candidate.highRisk || HIGH_RISK_ACTIONS.has(candidate.actionType)) &&
            !decisions.has(candidate.actionType)
        );

        if (unresolvedHighRisk.length > 0) {
            if (input.providerDataScopes?.transcript === false) {
                for (const candidate of unresolvedHighRisk) {
                    decisions.set(candidate.actionType, this.degraded(candidate, 'provider_scope_denied', 'local_only_by_privacy'));
                }
            } else if (shouldUseCloud({ ...input, candidates: unresolvedHighRisk }) && (input.cloudClassifier || this.options.cloudClassifier)) {
                const cloudClassifier = input.cloudClassifier ?? this.options.cloudClassifier;
                const validTypes = new Set(unresolvedHighRisk.map(candidate => candidate.actionType));
                let cloudResults: CloudSemanticGateResult[] = [];
                let cloudFailureReason: CloudSemanticGateFailureReason | undefined;
                try {
                    const rawCloudResults = await cloudClassifier?.({
                        transcript: input.transcript,
                        recentContextTurns: input.recentContextTurns ?? [],
                        modeTemplateType: input.modeTemplateType,
                        speaker: input.speaker,
                        candidates: unresolvedHighRisk,
                        intentResult: input.intentResult,
                    });
                    const normalized = normalizeCloudResults(rawCloudResults, validTypes);
                    cloudResults = normalized.results;
                    cloudFailureReason = normalized.failureReason;
                } catch (error) {
                    cloudFailureReason = cloudFailureReasonFromError(error);
                }
                for (const result of cloudResults ?? []) {
                    const candidate = unresolvedHighRisk.find(item => item.actionType === result.actionType);
                    if (!candidate) continue;
                    decisions.set(result.actionType, {
                        candidate,
                        decision: result.decision,
                        confidence: clampConfidence(result.confidence),
                        semanticIntent: result.semanticIntent,
                        reasons: result.reasons ?? ['cloud_semantic_confirmation'],
                        rejectedCandidates: result.rejectedCandidates ?? [],
                        usedLocalIntentModel: false,
                        usedCloudArbitration: true,
                        semanticProvider: 'cloud_llm',
                        arbitrationStatus: 'cloud_used',
                    });
                }
                for (const candidate of unresolvedHighRisk) {
                    if (decisions.has(candidate.actionType)) continue;
                    const fallbackDecision = localDecisionFor(input, candidate);
                    if (fallbackDecision && (fallbackDecision.decision === 'pass' || fallbackDecision.decision === 'reject')) {
                        const cloudUnavailableReasons = [
                            ...(cloudFailureReason ? [cloudFailureReason] : ['cloud_semantic_gate_unavailable']),
                            'cloud_unavailable_local_fallback',
                        ];
                        decisions.set(candidate.actionType, {
                            ...fallbackDecision,
                            reasons: [...fallbackDecision.reasons, ...cloudUnavailableReasons],
                            arbitrationStatus: 'local_fallback_cloud_unavailable',
                        });
                        continue;
                    }
                    const reason = cloudFailureReason ?? 'cloud_semantic_gate_unavailable';
                    decisions.set(candidate.actionType, this.degraded(candidate, reason, 'cloud_unavailable'));
                }
            } else {
                for (const candidate of unresolvedHighRisk) {
                    decisions.set(candidate.actionType, this.degraded(candidate, 'local_intent_unavailable', 'local_only_not_needed'));
                }
            }
        }

        return input.candidates.map(candidate => decisions.get(candidate.actionType) ?? this.degraded(candidate, 'semantic_gate_unavailable', 'local_only_not_needed'));
    }

    private degraded(
        candidate: ModeEventCandidate,
        reason: string,
        arbitrationStatus: SemanticGateArbitrationStatus
    ): ModeEventGateDecision {
        return {
            candidate,
            decision: 'defer',
            confidence: Math.min(0.7, clampConfidence(candidate.confidence)),
            semanticIntent: candidate.actionType,
            reasons: [reason],
            rejectedCandidates: [],
            usedLocalIntentModel: false,
            usedCloudArbitration: false,
            semanticProvider: 'unavailable',
            arbitrationStatus,
            degradedReason: reason,
        };
    }
}
