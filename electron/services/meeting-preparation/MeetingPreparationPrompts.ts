import type { MeetingContext, MeetingPreparationTemplateType } from '../../../shared/meetingPreparation';
import type { PredictedQuestion } from './MeetingPreparationSchemas';
import type { KnowledgeMaterialSearchResult } from '../knowledge/KnowledgeMaterialService';

interface PromptMode {
    id: string;
    name: string;
    templateType: string;
}

export function buildMeetingContextPrompt(rawInput: string): string {
    const example = {
        topic: { value: '产品技术交流', state: 'confirmed' },
        customer: { value: '启明机器人', state: 'confirmed' },
        participants: [{ name: '张三', role: '研发总监' }],
        goal: { value: '确认产品集成方案', state: 'confirmed' },
        agenda: ['机器人行业案例', '产品集成'],
        background: '首次交流',
    };
    return [
        '你只负责拆解会议信息，不补充输入中不存在的事实。',
        '必须只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码块。',
        '严格使用以下字段和类型：topic、customer、goal 都是 { value: string, state: string }；participants 是 { name: string, role: string }[]；agenda 是 string[]；background 是 string。',
        'state 只能是 confirmed 或 needs_confirmation；输入未明确的信息使用空字符串、空数组和 needs_confirmation，不得猜测。',
        `合法格式示例（只展示结构和类型，不得照抄内容）：${JSON.stringify(example)}`,
        `用户输入：${JSON.stringify(rawInput)}`,
    ].join('\n');
}

export function buildModePrompt(context: MeetingContext, modes: PromptMode[]): string {
    const allowed = modes
        .filter((mode) => mode.templateType === 'sales'
            || mode.templateType === 'fde'
            || mode.templateType === 'recruiting'
            || mode.templateType === 'team-meet')
        .map((mode) => ({ id: mode.id, name: mode.name, templateType: mode.templateType }));
    return [
        '只能在 sales、fde、recruiting 与 team-meet 中推荐一个主模式。',
        '必须依据会议的主任务判断，不得根据“售前”“技术”“管理层”等单个关键词直接决定模式。信息冲突时严格按以下优先级判断：会议目标 > 议程 > 参会人 > 主题名称。',
        '模式边界：明确属于内部协作时推荐 team-meet；明确涉及候选人或招聘流程时推荐 recruiting；外部客户会议不得推荐 team-meet。',
        '外部客户会议中，核心任务是技术需求发现、产品能力确认、集成、安全、部署、交付风险或成功标准时推荐 fde；核心任务是解决方案价值汇报、管理层认可、预算、决策链、商务异议或采购推进时推荐 sales。',
        '“售前”不等于 sales：售前技术交流、技术验证或集成讨论推荐 fde；首次向客户管理层做解决方案与价值汇报推荐 sales；向 CTO 和架构团队做技术方案评审推荐 fde；处理报价异议并确认采购流程推荐 sales。',
        '会议同时包含销售和技术内容时，按照会议结束时希望达成的主要结果选择一个主模式。',
        '返回 JSON：templateType、reason、focus。reason 必须说明采用了哪些会议信息和主任务；focus 必须匹配所选模式。',
        `可选模式：${JSON.stringify(allowed)}`,
        `会议信息：${JSON.stringify(context)}`,
    ].join('\n');
}

const confirmedContext = (context: MeetingContext): Record<string, unknown> => ({
    topic: context.topic.state === 'confirmed' ? context.topic.value : '',
    customer: context.customer.state === 'confirmed' ? context.customer.value : '',
    participants: context.participants,
    goal: context.goal.state === 'confirmed' ? context.goal.value : '',
    agenda: context.agenda,
    background: context.background,
});

export function buildPredictionPrompt(
    context: MeetingContext,
    mode: { id: string; name: string; templateType: MeetingPreparationTemplateType },
    history: unknown | null,
): string {
    const keyMoments = mode.templateType === 'sales'
        ? ['需求发现', '案例与价值证明', '异议', '决策与下一步']
        : mode.templateType === 'fde'
            ? ['目标与场景', '集成与安全约束', '交付风险', '成功标准与下一步']
            : mode.templateType === 'recruiting'
                ? ['岗位职责与成功标准', '团队结构与文化', '招聘流程', '薪酬福利与工作制度']
                : ['项目进展', '优先级与决策', '阻塞与风险', '负责人、资源和跨团队协作'];
    const example = {
        historySummary: ['上次会议讨论了集成范围'],
        commitments: [{ text: '会后补充机器人案例' }],
        questions: [{
            question: '是否有机器人行业案例？',
            keyMomentType: '案例与价值证明',
            rationale: ['议程包含机器人行业案例'],
            knowledgeRequirements: ['机器人行业案例'],
            requiresInternalEvidence: true,
        }],
    };
    return [
        '你只生成会前准备信息，不得编造客户、案例、ROI、价格、认证、部署承诺或资料来源。',
        '必须只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码块。',
        '严格使用以下字段和类型：historySummary 是 string[]；commitments 是 { text: string }[]；questions 是 0–3 个问题对象的数组。',
        '每个问题对象必须包含 question: string、keyMomentType: string、rationale: string[]、knowledgeRequirements: string[]、requiresInternalEvidence: boolean。',
        'questions 只允许生成对方参会者向当前用户提出、需要当前用户回答的问题；销售和 FDE 的对方是客户，招聘的对方是候选人，团队会议的对方是其他参会同事。question 必须使用对方直接提问的口吻。',
        '不得生成当前用户应该向对方提出的问题；不得生成面试官题库、销售需求发现问题或团队待确认事项。',
        '视角示例：“贵公司当前在图纸、物料和变更管理方面存在哪些痛点？”不得生成；应改为客户可能问我方的“你们的产品如何解决机器人企业在图纸、物料和变更管理方面的痛点？”。',
        'requiresInternalEvidence 判定规则：回答需要引用公司掌握或提供的事实时必须为 true；包括具体客户或行业案例、案例成效与指标、产品功能与技术能力、接口与集成兼容性、解决方案、价格、认证与合规、安全能力、部署与交付承诺。',
        '只有我方回答完全依据已确认会议信息、历史会议原文或现场会议原文，不需要声明公司事实时，requiresInternalEvidence 才允许为 false。',
        '同一问题同时涉及公司事实与客户现场信息时，requiresInternalEvidence 必须为 true。输出前逐题自检：只要回答中可能需要作出公司事实声明，就不得返回 false。',
        '招聘问题涉及岗位政策、公司制度、招聘流程或薪酬福利等组织事实时，requiresInternalEvidence 必须为 true。',
        '团队会议问题涉及项目状态、内部指标、计划、资源或组织政策等事实时，requiresInternalEvidence 必须为 true；完全依据已确认会议描述或关联会议原文回答时才允许为 false。',
        '判定示例：“本次会议需要交流的具体机器人行业案例有哪些？” requiresInternalEvidence=true；“你们的产品如何接入我们的现有控制系统？” requiresInternalEvidence=true；“你们理解的本次会议目标是什么？” requiresInternalEvidence=false。',
        '没有历史会议时，historySummary 和 commitments 必须为空数组。没有问题时 questions 必须为空数组，不得省略字段。',
        `合法格式示例（只展示结构和类型，不得照抄内容）：${JSON.stringify(example)}`,
        `已确认会议信息：${JSON.stringify(confirmedContext(context))}`,
        `模式与关键时刻：${JSON.stringify({ ...mode, keyMoments })}`,
        `用户选择的历史会议：${JSON.stringify(history)}`,
    ].join('\n');
}

export function buildEvidencePrompt(
    question: PredictedQuestion,
    hits: KnowledgeMaterialSearchResult[],
): string {
    const chunks = hits.map((hit) => ({
        chunkId: hit.chunkId,
        title: hit.title,
        text: hit.text,
        parentText: hit.parentText,
    }));
    const example = {
        coverage: 'partial',
        supported: ['资料已经支持的结论'],
        missing: ['仍缺少的信息'],
        limitations: ['现有资料的适用边界'],
        citedChunkIds: [123],
        handlingScript: '可以先说明已有证据覆盖的部分。',
        followupQuestions: ['您更关注哪个具体场景？'],
    };
    return [
        '你只判断所给内部资料对问题的覆盖程度，不得使用外部知识。',
        '必须只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码块。',
        '严格使用以下字段和类型：coverage 是 sufficient 或 partial；supported、missing、limitations、followupQuestions 都是 string[]；citedChunkIds 是非负整数数组；handlingScript 是 string。',
        'supported 只能包含检索资料明确支持的正向结论；任何“未知”“暂无”“未提供”“无法确认”或不支持的内容必须放入 missing，不得放入 supported。',
        'citedChunkIds 只能引用下方提供的 chunkId。没有内容时使用空数组或空字符串，不得省略字段。',
        `合法格式示例（只展示结构和类型，不得照抄内容）：${JSON.stringify(example)}`,
        `问题与知识要求：${JSON.stringify({ question: question.question, knowledgeRequirements: question.knowledgeRequirements })}`,
        `检索资料：${JSON.stringify(chunks)}`,
    ].join('\n');
}

export function buildEvidenceRequirementPrompt(
    question: string,
    context: MeetingContext | null,
): string {
    const example = {
        knowledgeRequirements: ['产品接口能力', '集成兼容性'],
        requiresInternalEvidence: true,
    };
    return [
        '你只重新判断当前问题是否需要内部资料，以及需要检索哪些知识，不得改写问题。',
        '必须只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码块。',
        '严格使用以下字段和类型：knowledgeRequirements 是 string[]；requiresInternalEvidence 是 boolean。',
        '回答需要引用公司掌握或提供的事实时必须为 true；包括具体客户或行业案例、案例成效与指标、产品功能与技术能力、接口与集成兼容性、解决方案、价格、认证与合规、安全能力、部署与交付承诺。',
        '只有问题完全依赖会议现场向客户了解的信息时才允许为 false，例如客户目标、客户现有系统、时间计划和决策流程；此时 knowledgeRequirements 必须为空数组。',
        '同一问题同时涉及公司事实与客户现场信息时必须为 true，并只列出回答公司事实所需的知识。',
        '判定示例：“我们的产品如何接入客户现有控制系统？” requiresInternalEvidence=true；“客户当前使用什么控制系统？” requiresInternalEvidence=false。',
        `合法格式示例（只展示结构和类型，不得照抄内容）：${JSON.stringify(example)}`,
        `当前问题：${JSON.stringify(question)}`,
        `已确认会议信息：${JSON.stringify(context ? confirmedContext(context) : {})}`,
    ].join('\n');
}
