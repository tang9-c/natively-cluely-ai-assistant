import type {
    AutoSurfacePolicy,
    DynamicAction,
    DynamicActionOutputType,
    DynamicActionProductContract,
    DynamicActionRiskState,
    EvidenceRef,
} from './DynamicAction';
import {
    buildDynamicActionContextNeedDecision,
    UNKNOWN_CONTEXT_NEED_DECISION,
} from '../context/ContextNeedDecision';

export const VISIBLE_DYNAMIC_ACTION_OUTPUT_TYPES: readonly DynamicActionOutputType[] = [
    'spoken_response',
    'checklist',
    'email_draft',
    'action_item',
    'decision_record',
];

export const VISIBLE_DYNAMIC_ACTION_RISK_STATES: readonly DynamicActionRiskState[] = [
    'auto_countdown',
    'normal',
];

type ContractInput = Pick<
    DynamicAction,
    'type' | 'label' | 'modeTemplateType' | 'confidence' | 'autoSurfacePolicy' | 'evidenceRefs' | 'answerStyle'
>;

const EVIDENCE_SUMMARY_MAX_CHARS = 90;

const CHECKLIST_TYPES = new Set([
    'technical_requirements',
    'fde_discovery_probe',
    'fde_integration_check',
    'fde_security_review',
    'fde_risk_blocker',
    'fde_agent_feasibility',
    'fde_success_criteria',
    'fde_next_step',
    'blocker_check',
    'owner_deadline_check',
]);

const EMAIL_TYPES = new Set([
    'pricing_request',
    'final_offer',
    'send_contract',
]);

const ACTION_ITEM_TYPES = new Set([
    'action_item',
    'buying_signal',
]);

const DECISION_TYPES = new Set([
    'decision_point',
]);

export function buildDynamicActionProductContract(input: ContractInput): DynamicActionProductContract {
    try {
        const outputType = resolveOutputType(input);
        return {
            userAction: buildUserAction(input, outputType),
            whyNow: explainDynamicActionForUser(input).whyNow,
            evidenceSummary: summarizeEvidence(input.evidenceRefs),
            outputType,
            outputPromise: outputPromiseFor(outputType),
            riskState: resolveRiskState(input),
            contextNeedDecision: buildDynamicActionContextNeedDecision(input),
        };
    } catch {
        return {
            userAction: '生成下一步回应',
            whyNow: '当前会议出现了可处理的下一步。',
            outputType: 'spoken_response',
            outputPromise: '生成一段可直接说出口的回应',
            riskState: 'normal',
            contextNeedDecision: UNKNOWN_CONTEXT_NEED_DECISION,
        };
    }
}

export function explainDynamicActionForUser(input: Pick<DynamicAction, 'type' | 'label' | 'modeTemplateType'>): {
    whyNow: string;
    severity: 'info' | 'ok' | 'warning';
} {
    if (input.type === 'pricing_request') {
        return { whyNow: '对方正在索要报价、proposal 或商务条款，适合生成一封不编价格和条款的跟进邮件。', severity: 'info' };
    }
    if (input.type === 'case_study_request') {
        return { whyNow: '对方正在索要案例、ROI 或证明点，必须优先引用已上传资料，不能编造客户案例。', severity: 'info' };
    }
    if (input.type === 'technical_requirements') {
        return { whyNow: '对方正在确认 API、SSO、安全或部署要求，适合先生成澄清清单而不是承诺能力。', severity: 'info' };
    }
    if (input.type === 'buying_signal') {
        return { whyNow: '对方释放了推进信号，需要锁定 owner、date 和 artifact，避免下一步落空。', severity: 'ok' };
    }
    if (/pricing|objection|pushback|budget/.test(input.type)) {
        return { whyNow: '对方正在表达价格或预算顾虑，适合马上给出回应。', severity: 'warning' };
    }
    if (input.type === 'fde_agent_feasibility') {
        return { whyNow: 'AI Agent 的自动化边界已经出现，需要先明确人工确认、只读分析，以及不可自动写回的边界。', severity: 'warning' };
    }
    if (input.type === 'fde_discovery_probe') {
        return { whyNow: '客户正在描述制造业流程或系统对象，适合马上澄清 PLM/QMS 对象、角色、权限和验证产物。', severity: 'info' };
    }
    if (input.type === 'fde_integration_check') {
        return { whyNow: '讨论已经进入 PLM/QMS/ERP/MES 集成与权限边界，需要确认数据方向、读写边界和验证产物。', severity: 'info' };
    }
    if (input.type === 'fde_risk_blocker') {
        return { whyNow: '会议出现客户流程风险、系统权限风险、交付风险、AI Agent 误判风险或信息缺失，需要先分类再推进。', severity: 'warning' };
    }
    if (input.type === 'fde_next_step') {
        return { whyNow: '下一步必须锁定 owner、date、artifact、测试数据和验收标准，缺字段时要直接追问。', severity: 'ok' };
    }
    if (input.type === 'blocker_check') {
        return { whyNow: '当前讨论出现阻塞或依赖信号，适合立刻明确影响和解法。', severity: 'warning' };
    }
    if (/fde_|integration|security|risk|blocker/.test(input.type)) {
        return { whyNow: '讨论已经进入验证或风险澄清阶段，需要把下一步说清楚。', severity: 'info' };
    }
    if (/action_item|owner_deadline/.test(input.type)) {
        return { whyNow: '会议中出现了负责人或截止时间信号，适合记录成行动项。', severity: 'ok' };
    }
    if (/decision/.test(input.type)) {
        return { whyNow: '当前讨论出现决策信号，适合确认并记录下来。', severity: 'ok' };
    }
    return { whyNow: '当前会议出现了可处理的下一步。', severity: 'info' };
}

function resolveOutputType(input: ContractInput): DynamicActionOutputType {
    if (input.answerStyle?.format === 'email') return 'email_draft';
    if (ACTION_ITEM_TYPES.has(input.type)) return 'action_item';
    if (DECISION_TYPES.has(input.type)) return 'decision_record';
    if (CHECKLIST_TYPES.has(input.type) || input.answerStyle?.format === 'checklist') return 'checklist';
    if (EMAIL_TYPES.has(input.type) || /email|quote/i.test(input.label)) return 'email_draft';
    return 'spoken_response';
}

function resolveRiskState(input: { autoSurfacePolicy?: AutoSurfacePolicy; confidence: number }): DynamicActionRiskState {
    return input.autoSurfacePolicy === 'auto' && input.confidence >= 0.9 ? 'auto_countdown' : 'normal';
}

function buildUserAction(input: ContractInput, outputType: DynamicActionOutputType): string {
    if (input.type === 'pricing_request') return '生成报价邮件';
    if (input.type === 'case_study_request') return '引用案例证明';
    if (input.type === 'technical_requirements') return '澄清技术需求';
    if (input.type === 'buying_signal') return '锁定推进下一步';
    if (/pricing|objection|pushback|budget/.test(input.type)) return '回应价格异议';
    if (input.type === 'fde_discovery_probe') return '澄清制造业流程和系统对象';
    if (input.type === 'fde_integration_check') return '锁定集成、权限和读写边界';
    if (input.type === 'fde_security_review') return '确认权限、审计和质量记录边界';
    if (input.type === 'fde_agent_feasibility') return '判断 AI Agent 可行性边界';
    if (input.type === 'fde_next_step') return '锁定 owner/date/artifact 下一步';
    if (input.type === 'buying_signal') return '锁定下一步';
    if (/fde_|blocker|risk/.test(input.type)) return '澄清部署风险和下一步';
    if (outputType === 'action_item') return '确认负责人和截止时间';
    if (outputType === 'decision_record') return '记录当前决策';
    if (outputType === 'email_draft') return '生成后续邮件草稿';
    if (outputType === 'checklist') return '整理验证检查清单';
    return '生成下一步回应';
}

function outputPromiseFor(outputType: DynamicActionOutputType): string {
    switch (outputType) {
        case 'checklist':
            return '生成一份可核对的检查清单';
        case 'email_draft':
            return '生成一封可发送的邮件草稿';
        case 'action_item':
            return '记录负责人、任务和截止时间';
        case 'decision_record':
            return '记录决策内容和依据';
        case 'spoken_response':
        default:
            return '生成一段可直接说出口的回应';
    }
}

function summarizeEvidence(evidenceRefs: EvidenceRef[] | undefined): string | undefined {
    const raw = evidenceRefs?.[0]?.text?.replace(/\s+/g, ' ').trim();
    if (!raw) return undefined;
    if (raw.length <= EVIDENCE_SUMMARY_MAX_CHARS) return raw;
    return `${raw.slice(0, EVIDENCE_SUMMARY_MAX_CHARS).trimEnd()}…`;
}
