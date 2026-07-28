export type ActionRiskLevel = 'high' | 'medium' | 'low';
export type GateStrategy = 'required' | 'preferred' | 'optional' | 'never';

export interface LocalFallbackEvidence {
    includeAny: string[];
    rejectAny?: string[];
    requireAllAny?: string[][];
}

export interface ActionGatePolicy {
    actionType: string;
    riskLevel: ActionRiskLevel;
    gateStrategy: GateStrategy;
    fastPathEligible: boolean;
    allowLocalFallbackOnCloudFailure: boolean;
    requiredEvidence: string[];
    localFallbackEvidence: LocalFallbackEvidence[];
    exclusiveGroup?: string;
    selectionPriority?: number;
}

export const FIRST_CLASS_MODE_TEMPLATE_TYPES = [
    'general',
    'sales',
    'fde',
    'recruiting',
    'team-meet',
    'looking-for-work',
    'technical-interview',
    'lecture',
] as const;

const MODE_ALIASES: Record<string, string> = {
    team_meeting: 'team-meet',
    interview: 'looking-for-work',
    technical_interview: 'technical-interview',
};

function policy(
    actionType: string,
    riskLevel: ActionRiskLevel,
    gateStrategy: GateStrategy,
    allowLocalFallbackOnCloudFailure: boolean,
    localFallbackEvidence: LocalFallbackEvidence[] = [],
    requiredEvidence: string[] = [],
    fastPathEligible = false,
    arbitration?: Pick<ActionGatePolicy, 'exclusiveGroup' | 'selectionPriority'>,
): ActionGatePolicy {
    return {
        actionType,
        riskLevel,
        gateStrategy,
        fastPathEligible,
        allowLocalFallbackOnCloudFailure,
        requiredEvidence,
        localFallbackEvidence,
        ...arbitration,
    };
}

export function normalizeModeTemplateType(modeTemplateType: string): string {
    return MODE_ALIASES[modeTemplateType] ?? modeTemplateType;
}

const POLICIES: Record<string, Record<string, ActionGatePolicy>> = {
    general: {
        general_assistance_request: policy('general_assistance_request', 'low', 'optional', true, [{ includeAny: ['我该怎么回答', '怎么回应', 'what should I say'] }]),
        general_summarize: policy('general_summarize', 'low', 'optional', true, [{ includeAny: ['总结一下', '复盘一下', 'summarize this'] }]),
        general_explain: policy('general_explain', 'low', 'optional', true, [{ includeAny: ['解释一下', '这是什么意思', 'what does that mean'] }]),
    },
    sales: {
        pricing_objection: policy('pricing_objection', 'high', 'required', false, [], [], false, { exclusiveGroup: 'sales_live_assist', selectionPriority: 90 }),
        pricing_request: policy('pricing_request', 'high', 'required', false, [], [], false, { exclusiveGroup: 'sales_live_assist', selectionPriority: 86 }),
        case_study_request: policy('case_study_request', 'high', 'required', false, [], [], false, { exclusiveGroup: 'sales_live_assist', selectionPriority: 87 }),
        discovery_question: policy('discovery_question', 'high', 'required', false, [], [], false, { exclusiveGroup: 'sales_live_assist', selectionPriority: 84 }),
        technical_requirements: policy('technical_requirements', 'high', 'required', false, [], [], false, { exclusiveGroup: 'sales_live_assist', selectionPriority: 88 }),
        buying_signal: policy('buying_signal', 'high', 'required', false, [], [], false, { exclusiveGroup: 'sales_live_assist', selectionPriority: 95 }),
    },
    fde: {
        fde_discovery_probe: policy('fde_discovery_probe', 'high', 'required', false, [], [], false, { exclusiveGroup: 'fde_live_assist', selectionPriority: 84 }),
        fde_integration_check: policy('fde_integration_check', 'high', 'required', false, [], [], false, { exclusiveGroup: 'fde_live_assist', selectionPriority: 88 }),
        fde_security_review: policy('fde_security_review', 'high', 'required', false, [], [], false, { exclusiveGroup: 'fde_live_assist', selectionPriority: 92 }),
        fde_risk_blocker: policy('fde_risk_blocker', 'high', 'required', false, [], [], false, { exclusiveGroup: 'fde_live_assist', selectionPriority: 90 }),
        fde_agent_feasibility: policy('fde_agent_feasibility', 'high', 'required', false, [], [], false, { exclusiveGroup: 'fde_live_assist', selectionPriority: 87 }),
        fde_success_criteria: policy('fde_success_criteria', 'high', 'required', false, [], [], false, { exclusiveGroup: 'fde_live_assist', selectionPriority: 86 }),
        fde_next_step: policy('fde_next_step', 'high', 'required', false, [], [], false, { exclusiveGroup: 'fde_live_assist', selectionPriority: 90 }),
    },
    recruiting: {
        candidate_concern: policy('candidate_concern', 'high', 'required', false, [], [
            'counterpart explicitly asks or expresses concern about recruiting policy',
            'policy category is compensation, visa, remote work, relocation, offer, level, or start date',
        ], false, { exclusiveGroup: 'recruiting_live_assist', selectionPriority: 100 }),
        candidate_experience_probe: policy('candidate_experience_probe', 'high', 'required', false, [], [
            'counterpart answer or claim lacks observable job-related evidence',
            'follow-up can request personal action, result, ownership, tradeoff, or verification',
        ], false, { exclusiveGroup: 'recruiting_live_assist', selectionPriority: 80 }),
        strong_fit_signal: policy('strong_fit_signal', 'high', 'required', false, [], [
            'counterpart explicitly expresses interest in the role or company',
            'do not infer hiring fit from interest',
        ], false, { exclusiveGroup: 'recruiting_live_assist', selectionPriority: 60 }),
    },
    'team-meet': {
        action_item: policy('action_item', 'medium', 'preferred', false, [], ['owner_or_actor', 'action', 'deadline_or_commitment'], false, { exclusiveGroup: 'team_meet_live_assist', selectionPriority: 90 }),
        decision_point: policy('decision_point', 'medium', 'preferred', false, [], [], false, { exclusiveGroup: 'team_meet_live_assist', selectionPriority: 85 }),
        blocker_check: policy('blocker_check', 'medium', 'preferred', false, [], [], false, { exclusiveGroup: 'team_meet_live_assist', selectionPriority: 84 }),
        owner_deadline_check: policy('owner_deadline_check', 'medium', 'preferred', false, [], [], false, { exclusiveGroup: 'team_meet_live_assist', selectionPriority: 83 }),
    },
    'looking-for-work': {
        behavioral_question: policy('behavioral_question', 'medium', 'preferred', true, [{ includeAny: ['讲一个例子', '成功的例子', '面对挑战', 'STAR', 'tell me about a time', 'describe a situation'] }]),
        intro_pitch: policy('intro_pitch', 'medium', 'preferred', true, [{ includeAny: ['介绍一下你自己', '自我介绍', '介绍你的经历', 'tell me about yourself'] }]),
        company_motivation: policy('company_motivation', 'medium', 'preferred', true, [{ includeAny: ['为什么我们公司', 'why this company'] }]),
        weakness_question: policy('weakness_question', 'medium', 'preferred', true, [{ includeAny: ['缺点', '最大的缺点', 'weakness', 'area for improvement'] }]),
    },
    'technical-interview': {
        coding_problem: policy('coding_problem', 'high', 'required', true, [{ includeAny: ['实现', '写代码', '算法', '函数', 'implement', 'write code', 'solve'] }]),
        screen_coding_problem: policy('screen_coding_problem', 'medium', 'preferred', true, [{ includeAny: ['屏幕', '显示', 'shown'], requireAllAny: [['题', '代码', 'problem']] }]),
        complexity_analysis: policy('complexity_analysis', 'medium', 'preferred', true, [{ includeAny: ['时间复杂度', '空间复杂度', '大O', 'big O', 'optimize'] }]),
        system_design_prompt: policy('system_design_prompt', 'high', 'required', false),
    },
    lecture: {
        concept_explanation: policy('concept_explanation', 'low', 'optional', true, [{ includeAny: ['定义', '公式', '概念', 'explain the concept'] }]),
        worked_example: policy('worked_example', 'low', 'optional', true, [{ includeAny: ['举个例子', '例题', 'worked example', 'sample problem'] }]),
    },
    negotiation: {
        budget_probe: policy('budget_probe', 'medium', 'preferred', false),
        price_pushback: policy('price_pushback', 'medium', 'preferred', false),
        final_offer: policy('final_offer', 'medium', 'preferred', false),
    },
};

export function getActionGatePolicy(modeTemplateType: string, actionType: string): ActionGatePolicy {
    const mode = normalizeModeTemplateType(modeTemplateType);
    return POLICIES[mode]?.[actionType] ?? policy(actionType, 'medium', 'preferred', false);
}
