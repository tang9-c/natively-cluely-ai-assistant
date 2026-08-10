import type { BusinessSystemSourceKind, BusinessSystemTriggerResult } from './BusinessSystemTypes';

const STRONG_READONLY_ACTION_PATTERN = /(查(?:一下|下|询)|查询|帮我看(?:一下|下)?|去\s*(?:系统|PLM|Windchill|QMS|ERP|MES|CRM)\s*里看(?:一下|下)?|根据\s*(?:PLM|Windchill|QMS|ERP|MES|CRM)|用\s*(?:PLM|Windchill|QMS|ERP|MES|CRM)\s*确认)/i;
const WEAK_CONFIRM_ACTION_PATTERN = /确认(?:一下|下)?/i;
const EXPLICIT_WRITE_OPERATION_PATTERN = /(?:请|帮我|麻烦|替我|把|将)[^。！？!?]{0,32}(?:创建|新增|修改|更新|审批通过|通过审批|提交|删除|写回|自动写入|改成)|^在[^。！？!?]{0,20}(?:中|里)[^。！？!?]{0,8}(?:创建|新增|修改|更新|审批通过|通过审批|提交|删除|写回|自动写入|改成)|^(?:创建|新增|修改|更新|审批通过|通过审批|提交|删除|写回|自动写入|改成)|^(?:please\s+)?(?:create|update|approve|submit|delete|write\s*back|close\s+out)\b/i;
const HYPOTHETICAL_WRITE_PATTERN = /(会不会|是否(?:会|能)?|能不能|可不可以|能否|是否支持)[^。！？!?]{0,24}(?:创建|新增|修改|更新|审批|提交|删除|写回|自动写入|改成)/i;

const SYSTEM_HINTS: Array<{ pattern: RegExp; sourceHint: BusinessSystemSourceKind }> = [
    { pattern: /\b(?:PLM|Windchill)\b/i, sourceHint: 'plm' },
    { pattern: /\bQMS\b/i, sourceHint: 'qms' },
    { pattern: /\bERP\b/i, sourceHint: 'erp' },
    { pattern: /\bMES\b/i, sourceHint: 'mes' },
    { pattern: /\bCRM\b/i, sourceHint: 'crm' },
];

const OBJECT_ANCHOR_PATTERN = /\b(?:BOM|ECO|ECN|CAPA|NCR|8D|IQC|OQC|IPQC|工单|合同|客户档案|客户|物料|项目|图纸|需求|问题|质量事件|质量记录|偏差|审批|负责人|进度|状态|库存|版本)\b|[A-Za-z]{1,8}[-_ ]?\d{2,}|[A-Za-z]\d{2,}|\b\d{4,}\b|[\u4e00-\u9fa5A-Za-z0-9]+(?:项目|物料|图纸|需求|问题|变更|版本|进度|负责人|状态|包装问题|质量问题|合同|客户档案)/i;

const VAGUE_ONLY_PATTERN = /(这个|这个怎么样|刚才那个|上次那个|它|该项|这个问题)$/;

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

function findSourceHint(question: string): BusinessSystemSourceKind | undefined {
    return SYSTEM_HINTS.find((entry) => entry.pattern.test(question))?.sourceHint;
}

function hasQueryAnchor(question: string, recentContext?: string): boolean {
    const combined = `${question} ${recentContext || ''}`;
    if (VAGUE_ONLY_PATTERN.test(question)) {
        return OBJECT_ANCHOR_PATTERN.test(recentContext || '');
    }
    return OBJECT_ANCHOR_PATTERN.test(combined);
}

export function detectBusinessSystemTrigger(question: string | undefined, recentContext?: string): BusinessSystemTriggerResult {
    const cleanedQuestion = compact(question);
    const cleanedRecentContext = summarizeRecentContext(recentContext);
    const sourceHint = findSourceHint(cleanedQuestion);

    const hasExplicitWriteAction = EXPLICIT_WRITE_OPERATION_PATTERN.test(cleanedQuestion)
        && !HYPOTHETICAL_WRITE_PATTERN.test(cleanedQuestion);
    const hasReadonlyAction = STRONG_READONLY_ACTION_PATTERN.test(cleanedQuestion)
        || hasExplicitWriteAction
        || (Boolean(sourceHint) && WEAK_CONFIRM_ACTION_PATTERN.test(cleanedQuestion));
    if (!hasReadonlyAction) {
        return { shouldQuery: false, failureReason: 'not_explicitly_requested' };
    }

    if (!hasQueryAnchor(cleanedQuestion, cleanedRecentContext)) {
        return {
            shouldQuery: false,
            sourceHint,
            failureReason: 'missing_query_anchor',
            userMessage: '我可以查业务系统知识源，但现在还缺少要查询的物料、项目、图纸、需求或问题线索。',
        };
    }

    return {
        shouldQuery: true,
        query: cleanedQuestion,
        sourceHint: sourceHint ?? 'business_system',
        recentContext: cleanedRecentContext || undefined,
    };
}
