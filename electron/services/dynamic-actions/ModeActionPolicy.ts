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
): ActionGatePolicy {
    return {
        actionType,
        riskLevel,
        gateStrategy,
        fastPathEligible,
        allowLocalFallbackOnCloudFailure,
        requiredEvidence,
        localFallbackEvidence,
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
        pricing_objection: policy('pricing_objection', 'high', 'required', true, [{ includeAny: ['太贵', '价格太高', '报价太高', '预算不够', '预算不足', '预算过不了', '预算这一关就过不了', 'out of budget', 'too expensive'], rejectAny: ['报价表', '价格页', '成本数据'] }]),
        pricing_request: policy('pricing_request', 'high', 'required', true, [{ includeAny: ['发我报价', '发一版报价', '给客户发一版报价', '报个价格', '给个价格', '报价单', '模块多少钱', 'what does it cost', 'proposal'], rejectAny: ['报价表在这', '内部报价', '价格页'] }]),
        case_study_request: policy('case_study_request', 'high', 'required', false),
        discovery_question: policy('discovery_question', 'high', 'required', false),
        technical_requirements: policy('technical_requirements', 'high', 'required', false),
        buying_signal: policy('buying_signal', 'high', 'required', true, [{ includeAny: ['发合同', '法务审核', '放假审核', '准备签', '准备推进', '安排时间', 'send contract', 'legal review'] }]),
    },
    fde: {
        fde_discovery_probe: policy('fde_discovery_probe', 'high', 'required', false),
        fde_integration_check: policy('fde_integration_check', 'high', 'required', false),
        fde_security_review: policy('fde_security_review', 'high', 'required', false),
        fde_risk_blocker: policy('fde_risk_blocker', 'high', 'required', false),
        fde_agent_feasibility: policy('fde_agent_feasibility', 'high', 'required', false),
        fde_success_criteria: policy('fde_success_criteria', 'high', 'required', false),
        fde_next_step: policy('fde_next_step', 'high', 'required', false),
    },
    recruiting: {
        candidate_concern: policy('candidate_concern', 'medium', 'preferred', true, [{ includeAny: ['offer', '入职时间', '签证', '薪资', 'remote', 'hybrid'] }]),
        strong_fit_signal: policy('strong_fit_signal', 'medium', 'preferred', true, [{ includeAny: ['很感兴趣', '很匹配', 'great fit', 'love this'] }]),
        candidate_experience_probe: policy('candidate_experience_probe', 'medium', 'preferred', true, [{ includeAny: ['讲讲你的经验', '具体例子', 'tell me about your experience', 'give me an example'] }]),
    },
    'team-meet': {
        action_item: policy('action_item', 'medium', 'preferred', true, [{ includeAny: ['我来做', '周五前', 'by Friday', 'assigned to'] }], ['owner_or_actor', 'action', 'deadline_or_commitment']),
        decision_point: policy('decision_point', 'medium', 'preferred', true, [{ includeAny: ['决定了', '最终决定', 'approved', 'confirmed'], rejectAny: ['还没有决定', '只是讨论'] }]),
        blocker_check: policy('blocker_check', 'medium', 'preferred', true, [{ includeAny: ['卡住', '依赖', '推进不了', 'blocked by', 'dependency'] }]),
        owner_deadline_check: policy('owner_deadline_check', 'medium', 'preferred', true, [{ includeAny: ['谁负责', '什么时候', '截止日期', 'by when', 'due date'] }]),
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
