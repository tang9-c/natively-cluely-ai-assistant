import type { MeetingContext } from '../../../shared/meetingPreparation';

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
