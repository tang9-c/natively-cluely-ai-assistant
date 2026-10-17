import type { MeetingEditState } from './meetingEdits';

export interface MeetingActionItem {
    id: string;
    text: string;
    owner?: string;
    deadline?: string;
    sourceTimestamp?: number;
}
interface ActionSummary {
    schemaVersion?: number;
    actionItems?: string[];
    actionItemsStructured?: MeetingActionItem[];
    sections?: Array<{ title: string; bullets: string[] }>;
}
const ACTION_SECTION_TITLES = new Set(['行动项', '下一步', '后续行动', 'action items', 'next steps']);
const isActionSection = (title: string) => ACTION_SECTION_TITLES.has(title.trim().toLowerCase());
const taskKey = (text: string) => text.trim().replace(/\s+/g, ' ').replace(/[.。!！?？;；,，、]+$/u, '').trim();
export const isValidMeetingActionText = (text: string): boolean => Boolean(taskKey(text));
const compatible = (a: MeetingActionItem, b: MeetingActionItem) =>
    !(['owner', 'deadline'] as const).some(key => a[key]?.trim() && b[key]?.trim() && a[key]!.trim() !== b[key]!.trim());
function stableId(text: string, index: number): string {
    let hash = 2166136261;
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `action:${(hash >>> 0).toString(36)}:${index}`;
}

/** v3's structured list is authoritative, including an explicitly empty list. */
export function normalizeMeetingActionItems<T extends ActionSummary>(summary: T, mergeExplicitSections = false): T & {
    schemaVersion: 3; actionItems: string[]; actionItemsStructured: MeetingActionItem[];
} {
    const structured = summary.actionItemsStructured || [];
    const sectionActions = (summary.sections || []).filter(section => isActionSection(section.title)).flatMap(section => section.bullets);
    const sections = summary.sections?.filter(section => !isActionSection(section.title));
    const result: MeetingActionItem[] = [];
    const add = (item: MeetingActionItem) => {
        if (!isValidMeetingActionText(item.text)) return;
        const match = result.find(old => taskKey(old.text) === taskKey(item.text) && compatible(old, item));
        if (match) {
            if (!match.owner?.trim() && item.owner?.trim()) match.owner = item.owner;
            if (!match.deadline?.trim() && item.deadline?.trim()) match.deadline = item.deadline;
            if (match.sourceTimestamp === undefined) match.sourceTimestamp = item.sourceTimestamp;
        } else result.push({ ...item });
    };
    if ((summary.schemaVersion || 0) >= 3) {
        // Do not deduplicate explicit user edits in the canonical list.
        result.push(...structured.filter(item => isValidMeetingActionText(item.text)).map(item => ({ ...item })));
        if (mergeExplicitSections) sectionActions.forEach((text, index) => add({ id: stableId(taskKey(text), index), text }));
    } else {
        const remaining = [...structured];
        for (const [index, text] of [...(summary.actionItems || []), ...sectionActions].entries()) {
            const match = remaining.findIndex(item => taskKey(item.text) === taskKey(text));
            const metadata = match < 0 ? undefined : remaining.splice(match, 1)[0];
            add({ ...metadata, id: metadata?.id || stableId(taskKey(text), index), text });
        }
        remaining.forEach(add);
    }
    return { ...summary, ...(sections ? { sections } : {}), schemaVersion: 3, actionItemsStructured: result, actionItems: result.map(item => item.text) };
}

/** Compatibility writes replace the list; only surviving matches retain metadata. */
export function replaceLegacyActionItems(summary: ActionSummary, texts: string[]): MeetingActionItem[] {
    const remaining = normalizeMeetingActionItems(summary).actionItemsStructured;
    const seen = new Set<string>();
    return texts.flatMap((text, index) => {
        const key = taskKey(text);
        if (!key || seen.has(key)) return [];
        seen.add(key);
        const matches = remaining.filter(item => taskKey(item.text) === key);
        return matches.length ? matches.map(item => ({ ...item, text })) : [{ id: stableId(key, index), text }];
    });
}
export function formatMeetingActionItem(item: MeetingActionItem): string {
    return `${item.text}（负责人：${item.owner?.trim() || '待确认'}；期限：${item.deadline?.trim() || '待确认'}）`;
}

export function hasManuallyEditedActions(state?: Pick<MeetingEditState, 'editedSummaryFields'>): boolean {
    return Boolean(state?.editedSummaryFields.some(field => field === 'actionItems' || field === 'actionItemsStructured'));
}
