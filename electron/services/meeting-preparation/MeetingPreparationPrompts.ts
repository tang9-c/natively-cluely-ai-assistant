import type { MeetingContext } from '../../../shared/meetingPreparation';
import type { PredictedQuestion } from './MeetingPreparationSchemas';
import type { KnowledgeMaterialSearchResult } from '../knowledge/KnowledgeMaterialService';

interface PromptMode {
    id: string;
    name: string;
    templateType: string;
}

export function buildMeetingContextPrompt(rawInput: string): string {
    return [
        '你只负责拆解会议信息，不补充输入中不存在的事实。',
        '返回 JSON：topic/customer/participants/goal/agenda/background；不确定字段的 state 必须为 needs_confirmation。',
        `用户输入：${JSON.stringify(rawInput)}`,
    ].join('\n');
}

export function buildModePrompt(context: MeetingContext, modes: PromptMode[]): string {
    const allowed = modes
        .filter((mode) => mode.templateType === 'sales' || mode.templateType === 'fde')
        .map((mode) => ({ id: mode.id, name: mode.name, templateType: mode.templateType }));
    return [
        '只能在 sales 与 fde 中推荐一个主模式。',
        '返回 JSON：templateType、reason、focus。',
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
    mode: { id: string; name: string; templateType: 'sales' | 'fde' },
    history: unknown | null,
): string {
    const keyMoments = mode.templateType === 'sales'
        ? ['需求发现', '案例与价值证明', '异议', '决策与下一步']
        : ['目标与场景', '集成与安全约束', '交付风险', '成功标准与下一步'];
    return [
        '你只生成会前准备信息，不得编造客户、案例、ROI、价格、认证、部署承诺或资料来源。',
        '返回 JSON：historySummary、commitments、questions。questions 必须为 0–3 个，每项包含 question、keyMomentType、rationale、knowledgeRequirements、requiresInternalEvidence。',
        '没有历史会议时，historySummary 和 commitments 必须为空数组。',
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
    return [
        '你只判断所给内部资料对问题的覆盖程度，不得使用外部知识。',
        'coverage 只能是 sufficient 或 partial；missing 与 not_needed 由系统确定。',
        'citedChunkIds 只能引用下方提供的 chunkId。',
        '返回 JSON：coverage、supported、missing、limitations、citedChunkIds、handlingScript、followupQuestions。',
        `问题与知识要求：${JSON.stringify({ question: question.question, knowledgeRequirements: question.knowledgeRequirements })}`,
        `检索资料：${JSON.stringify(chunks)}`,
    ].join('\n');
}
