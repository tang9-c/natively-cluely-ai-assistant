import type { IntentResult } from '../../llm/IntentClassifier';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';

export type SemanticGateDecision = 'pass' | 'reject' | 'defer' | 'fast_path';
export type SemanticGateProvider = 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable';

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
    };

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
        if (includesAny(text, ['too expensive', 'too pricey', 'too high', 'out of budget', '价格太高', '太贵', '超出预算'])) {
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

    if (candidate.actionType === 'case_study_request' && includesAny(text, ['case study', 'customer proof', '客户案例', '案例证明', '证明 ROI', '证明roi'])) {
        return {
            ...base,
            decision: 'pass',
            confidence: Math.max(candidate.confidence, 0.88),
            semanticIntent: 'case_or_proof_request',
            reasons: ['case_or_proof_request'],
            semanticProvider: 'local_intent',
        };
    }

    if (candidate.actionType === 'technical_requirements' && includesAny(text, ['API', 'SSO', 'production', 'integration', '技术方案', '生产环境', '部署要求', '集成要求'])) {
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
                    decisions.set(candidate.actionType, this.degraded(candidate, 'provider_scope_denied'));
                }
            } else if (shouldUseCloud({ ...input, candidates: unresolvedHighRisk }) && (input.cloudClassifier || this.options.cloudClassifier)) {
                const cloudClassifier = input.cloudClassifier ?? this.options.cloudClassifier;
                const cloudResults = await cloudClassifier?.({
                    transcript: input.transcript,
                    recentContextTurns: input.recentContextTurns ?? [],
                    modeTemplateType: input.modeTemplateType,
                    speaker: input.speaker,
                    candidates: unresolvedHighRisk,
                    intentResult: input.intentResult,
                }).catch(() => null);
                const validTypes = new Set(unresolvedHighRisk.map(candidate => candidate.actionType));
                for (const result of cloudResults ?? []) {
                    if (!validTypes.has(result.actionType)) continue;
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
                    });
                }
                for (const candidate of unresolvedHighRisk) {
                    if (!decisions.has(candidate.actionType)) {
                        decisions.set(candidate.actionType, this.degraded(candidate, 'cloud_semantic_gate_unavailable'));
                    }
                }
            } else {
                for (const candidate of unresolvedHighRisk) {
                    decisions.set(candidate.actionType, this.degraded(candidate, 'local_intent_unavailable'));
                }
            }
        }

        return input.candidates.map(candidate => decisions.get(candidate.actionType) ?? this.degraded(candidate, 'semantic_gate_unavailable'));
    }

    private degraded(candidate: ModeEventCandidate, reason: string): ModeEventGateDecision {
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
            degradedReason: reason,
        };
    }
}
