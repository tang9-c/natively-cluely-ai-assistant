import type { BusinessSystemSourceKind, BusinessSystemTriggerResult } from './BusinessSystemTypes';

const EXPLICIT_PATTERNS: Array<{ pattern: RegExp; sourceHint?: BusinessSystemSourceKind }> = [
    { pattern: /根据\s*PLM/i, sourceHint: 'plm' },
    { pattern: /查一下\s*PLM/i, sourceHint: 'plm' },
    { pattern: /用\s*PLM\s*确认/i, sourceHint: 'plm' },
    { pattern: /PLM\s*里/i, sourceHint: 'plm' },
    { pattern: /根据\s*QMS/i, sourceHint: 'qms' },
    { pattern: /查一下\s*QMS/i, sourceHint: 'qms' },
    { pattern: /用\s*QMS\s*确认/i, sourceHint: 'qms' },
    { pattern: /QMS\s*里/i, sourceHint: 'qms' },
    { pattern: /查(?:一下|下|询)?\s*(?:物料|项目|图纸|需求|问题|质量|变更|BOM|ECO|ECN|CAPA|NCR|偏差|审批|负责人|进度|[A-Za-z]{1,8}[-_ ]?\d{2,})/i, sourceHint: 'business_system' },
    { pattern: /去系统里看一下/i, sourceHint: 'business_system' },
    { pattern: /根据业务系统知识源/i, sourceHint: 'business_system' },
    { pattern: /业务系统知识源/i, sourceHint: 'business_system' },
];

const VAGUE_ONLY_PATTERN = /(这个|这个怎么样|刚才那个|上次那个|它|该项|这个问题)$/;
const ANCHOR_PATTERN = /([A-Za-z]{1,8}[-_ ]?\d{2,}|[A-Za-z]\d{2,}|[\u4e00-\u9fa5A-Za-z0-9]+(?:项目|物料|图纸|需求|问题|变更|版本|进度|负责人|状态|包装问题|质量问题))/;

function compact(value?: string): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function summarizeRecentContext(value?: string): string {
    const cleaned = compact(value);
    if (!cleaned) return '';
    const sentences = cleaned.match(/[^。！？.!?]+[。！？.!?]?/g) || [cleaned];
    return sentences
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('');
}

function findTrigger(question: string): { matched: boolean; sourceHint?: BusinessSystemSourceKind } {
    for (const entry of EXPLICIT_PATTERNS) {
        if (entry.pattern.test(question)) return { matched: true, sourceHint: entry.sourceHint };
    }
    return { matched: false };
}

function hasQueryAnchor(question: string, recentContext?: string): boolean {
    const combined = `${question} ${recentContext || ''}`;
    if (ANCHOR_PATTERN.test(combined)) return true;
    return !VAGUE_ONLY_PATTERN.test(question);
}

export function detectBusinessSystemTrigger(question: string | undefined, recentContext?: string): BusinessSystemTriggerResult {
    const cleanedQuestion = compact(question);
    const cleanedRecentContext = summarizeRecentContext(recentContext);
    const trigger = findTrigger(cleanedQuestion);

    if (!trigger.matched) {
        return { shouldQuery: false, failureReason: 'not_explicitly_requested' };
    }

    if (!hasQueryAnchor(cleanedQuestion, cleanedRecentContext)) {
        return {
            shouldQuery: false,
            sourceHint: trigger.sourceHint,
            failureReason: 'missing_query_anchor',
            userMessage: '我可以查业务系统知识源，但现在还缺少要查询的物料、项目、图纸、需求或问题线索。',
        };
    }

    return {
        shouldQuery: true,
        query: cleanedQuestion,
        sourceHint: trigger.sourceHint,
        recentContext: cleanedRecentContext || undefined,
    };
}
