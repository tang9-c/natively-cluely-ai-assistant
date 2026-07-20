import {
    assertProviderDataScopes,
    ProviderScopeError,
    type ProviderDataScope,
    type ProviderDataScopePolicy,
} from '../../llm/ProviderRouter';
import type { InjectedGroundingEvidence } from './DynamicActionRuntimeGrounding';
import {
    containsPositiveCapabilityClaim,
    containsPositiveRecruitingPolicyClaim,
} from './DynamicActionAcceptedOutputEvaluator';

export type ClaimGroundingVerdictCode = 'not_required' | 'supported' | 'unsupported' | 'unavailable';

export interface ClaimGroundingVerdict {
    verdict: ClaimGroundingVerdictCode;
    evidenceIds: string[];
    reasonCode:
        | 'no_positive_capability_claim'
        | 'claims_supported'
        | 'claim_not_supported'
        | 'no_injected_evidence'
        | 'provider_scope_denied'
        | 'verifier_timeout'
        | 'verifier_provider_unavailable'
        | 'verifier_invalid_json';
    verificationSource: 'continuation_grounding_verifier';
}

export class DynamicActionClaimGroundingVerifier {
    constructor(private readonly generateStructured: (prompt: string, options: {
        taskLabel: string;
        maxOutputTokens: number;
        perProviderTimeoutMs: number;
        maxRotations: number;
    }) => Promise<string>) {}

    async verify(input: {
        answerText: string;
        evidence: InjectedGroundingEvidence[];
        claimDomain: 'capability' | 'recruiting_policy';
        providerDataScopes?: ProviderDataScopePolicy;
    }): Promise<ClaimGroundingVerdict> {
        const hasPositiveClaim = input.claimDomain === 'recruiting_policy'
            ? containsPositiveRecruitingPolicyClaim(input.answerText)
            : containsPositiveCapabilityClaim(input.answerText);
        if (!hasPositiveClaim) return buildNotRequiredClaimGroundingVerdict();
        if (input.evidence.length === 0) return unavailableVerdict('no_injected_evidence');

        const requiredScopes: ProviderDataScope[] = ['transcript'];
        if (input.evidence.some((item) => item.type === 'material' || item.type === 'pptx')) {
            requiredScopes.push('reference_files');
        }
        try {
            assertProviderDataScopes('dynamic-action-grounding-verifier', requiredScopes, input.providerDataScopes);
        } catch (error) {
            if (error instanceof ProviderScopeError) return unavailableVerdict('provider_scope_denied');
            throw error;
        }

        try {
            const raw = await this.generateStructured(buildVerifierPrompt(input), {
                taskLabel: 'dynamic-action-grounding-verifier',
                maxOutputTokens: 192,
                perProviderTimeoutMs: 1500,
                maxRotations: 1,
            });
            return parseVerifierResult(raw, new Set(input.evidence.map((item) => item.evidenceId)));
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            return unavailableVerdict(/timeout|timed out/i.test(message)
                ? 'verifier_timeout'
                : 'verifier_provider_unavailable');
        }
    }
}

function buildVerifierPrompt(input: {
    answerText: string;
    evidence: InjectedGroundingEvidence[];
    claimDomain: 'capability' | 'recruiting_policy';
}): string {
    const instructions = input.claimDomain === 'recruiting_policy'
        ? [
            '你是 recruiting policy claim grounding verifier。只返回 JSON，不生成用户可见回答。',
            '逐条核对回答中的薪酬、签证、远程办公、搬迁、offer、职级和入职日期声明是否被招聘材料 excerpt 支持。',
        ]
        : [
            '你是 capability claim grounding verifier。只返回 JSON，不生成用户可见回答。',
            '逐条核对回答里的正向产品能力声明是否被 evidence excerpt 支持。',
        ];
    return [
        ...instructions,
        '任一正向声明没有证据支持，返回 unsupported。',
        `answerText: ${JSON.stringify(input.answerText.slice(0, 2_000))}`,
        `evidence: ${JSON.stringify(input.evidence.map((item) => ({
            evidenceId: item.evidenceId,
            type: item.type,
            label: item.label,
            excerpt: item.excerpt,
        })))}`,
        '返回格式: {"verdict":"supported|unsupported","evidenceIds":["..."],"reasonCode":"claims_supported|claim_not_supported"}',
    ].join('\n');
}

export function buildNotRequiredClaimGroundingVerdict(): ClaimGroundingVerdict {
    return {
        verdict: 'not_required',
        evidenceIds: [],
        reasonCode: 'no_positive_capability_claim',
        verificationSource: 'continuation_grounding_verifier',
    };
}

function unavailableVerdict(reasonCode: ClaimGroundingVerdict['reasonCode']): ClaimGroundingVerdict {
    return {
        verdict: 'unavailable',
        evidenceIds: [],
        reasonCode,
        verificationSource: 'continuation_grounding_verifier',
    };
}

export function parseVerifierResult(raw: string, allowedEvidenceIds: Set<string>): ClaimGroundingVerdict {
    try {
        const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonText) return unavailableVerdict('verifier_invalid_json');
        const parsed = JSON.parse(jsonText) as Record<string, unknown>;
        const allowedKeys = new Set(['verdict', 'evidenceIds', 'reasonCode']);
        if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
            return unavailableVerdict('verifier_invalid_json');
        }
        if (parsed.verdict !== 'supported' && parsed.verdict !== 'unsupported') {
            return unavailableVerdict('verifier_invalid_json');
        }
        if (!Array.isArray(parsed.evidenceIds) || parsed.evidenceIds.some((id) =>
            typeof id !== 'string' || !allowedEvidenceIds.has(id))) {
            return unavailableVerdict('verifier_invalid_json');
        }
        const expectedReason = parsed.verdict === 'supported' ? 'claims_supported' : 'claim_not_supported';
        if (parsed.reasonCode !== expectedReason ||
            (parsed.verdict === 'supported' && parsed.evidenceIds.length === 0)) {
            return unavailableVerdict('verifier_invalid_json');
        }
        return {
            verdict: parsed.verdict,
            evidenceIds: [...new Set(parsed.evidenceIds)],
            reasonCode: expectedReason,
            verificationSource: 'continuation_grounding_verifier',
        };
    } catch {
        return unavailableVerdict('verifier_invalid_json');
    }
}
