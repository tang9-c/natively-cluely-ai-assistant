export type WindchillIntent =
    | 'part_search'
    | 'part_structure'
    | 'part_where_used'
    | 'document_search'
    | 'change_search'
    | 'change_affected_objects'
    | 'workflow_my_tasks'
    | 'project_search'
    | 'quality_nonconformance_search';

export interface WindchillPlanInput {
    query: string;
    recentContext?: string;
}

export interface WindchillPlannedCall {
    toolName: string;
    arguments: Record<string, unknown>;
    resultKey: string;
    argumentsFrom?: 'partSearch:firstId' | 'changeSearch:firstId';
}

export type WindchillPlanResult =
    | { kind: 'unsupported_operation'; reason: string }
    | { kind: 'missing_anchor'; reason: string }
    | { kind: 'readonly_plan'; intent: WindchillIntent; calls: WindchillPlannedCall[] };

const WRITE_OPERATION_PATTERN = /\b(create|update|delete|approve|submit|checkin|checkout|add|remove|replace|bulk|switch|set|revise|delegate|complete|change_approve|part_create|document_create)\b|创建|修改|删除|审批|提交|签入|签出|新增|移除|替换|切换/i;
const PART_NUMBER_PATTERN = /\b([A-Za-z]{1,12}[-_ ]?\d{2,}|\d{3,}\*?)\b/;
const CHANGE_NUMBER_PATTERN = /\b((?:ECO|ECN|CN|CR)[-_ ]?\d{2,})\b/i;
const QUALITY_NUMBER_PATTERN = /\b((?:NCR|CAPA)[-_ ]?\d{2,})\b/i;

function compact(value?: string): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstMatch(pattern: RegExp, ...values: Array<string | undefined>): string | null {
    for (const value of values) {
        const match = compact(value).match(pattern);
        if (match?.[1]) return match[1].replace(/\s+/g, '-');
    }
    return null;
}

export function planWindchillQuery(input: WindchillPlanInput): WindchillPlanResult {
    const query = compact(input.query);
    const recentContext = compact(input.recentContext);
    const combined = `${query} ${recentContext}`.trim();

    if (WRITE_OPERATION_PATTERN.test(query)) {
        return { kind: 'unsupported_operation', reason: 'write operation requested' };
    }

    const partNumber = firstMatch(PART_NUMBER_PATTERN, query, recentContext);
    const changeNumber = firstMatch(CHANGE_NUMBER_PATTERN, query, recentContext);
    const qualityNumber = firstMatch(QUALITY_NUMBER_PATTERN, query, recentContext);

    if (/BOM|结构|structure/i.test(query) && partNumber) {
        return {
            kind: 'readonly_plan',
            intent: 'part_structure',
            calls: [
                { toolName: 'part_search', arguments: { number: partNumber, limit: 5 }, resultKey: 'partSearch' },
                { toolName: 'part_get_structure', arguments: { levels: 2 }, argumentsFrom: 'partSearch:firstId', resultKey: 'partStructure' },
            ],
        };
    }

    if (/用在哪|where[- ]?used|where used|使用位置/i.test(query) && partNumber) {
        return {
            kind: 'readonly_plan',
            intent: 'part_where_used',
            calls: [
                { toolName: 'part_search', arguments: { number: partNumber, limit: 5 }, resultKey: 'partSearch' },
                { toolName: 'part_get_where_used', arguments: { levels: 2 }, argumentsFrom: 'partSearch:firstId', resultKey: 'partWhereUsed' },
            ],
        };
    }

    if (/affected objects|影响对象|受影响/i.test(query) && changeNumber) {
        return {
            kind: 'readonly_plan',
            intent: 'change_affected_objects',
            calls: [
                { toolName: 'change_search', arguments: { number: changeNumber, limit: 5 }, resultKey: 'changeSearch' },
                { toolName: 'change_get_affected_objects', arguments: {}, argumentsFrom: 'changeSearch:firstId', resultKey: 'changeAffectedObjects' },
            ],
        };
    }

    if (/变更|change|ECO|ECN/i.test(query) && changeNumber) {
        return {
            kind: 'readonly_plan',
            intent: 'change_search',
            calls: [{ toolName: 'change_search', arguments: { number: changeNumber, limit: 5 }, resultKey: 'changeSearch' }],
        };
    }

    if (/文档|document|规格|图纸/i.test(query) && partNumber) {
        return {
            kind: 'readonly_plan',
            intent: 'document_search',
            calls: [{ toolName: 'document_advanced_search', arguments: { number: partNumber, limit: 5 }, resultKey: 'documentSearch' }],
        };
    }

    if (/任务|待办|workflow|my tasks/i.test(query)) {
        return {
            kind: 'readonly_plan',
            intent: 'workflow_my_tasks',
            calls: [{ toolName: 'workflow_get_my_tasks', arguments: { limit: 10 }, resultKey: 'workflowTasks' }],
        };
    }

    if (/项目|project|负责人|进度/i.test(query)) {
        return {
            kind: 'readonly_plan',
            intent: 'project_search',
            calls: [{ toolName: 'project_advanced_search', arguments: { name: query, limit: 5 }, resultKey: 'projectSearch' }],
        };
    }

    if (/质量|不合格|nonconformance|NCR|CAPA/i.test(combined) && (qualityNumber || /质量|不合格|nonconformance/i.test(query))) {
        return {
            kind: 'readonly_plan',
            intent: 'quality_nonconformance_search',
            calls: [{ toolName: 'quality_search_nonconformances', arguments: qualityNumber ? { number: qualityNumber, limit: 5 } : { name: query, limit: 5 }, resultKey: 'qualitySearch' }],
        };
    }

    if (partNumber) {
        return {
            kind: 'readonly_plan',
            intent: 'part_search',
            calls: [{ toolName: 'part_search', arguments: { number: partNumber, limit: 5 }, resultKey: 'partSearch' }],
        };
    }

    return { kind: 'missing_anchor', reason: 'missing Windchill object anchor' };
}
