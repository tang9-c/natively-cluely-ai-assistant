import type { AnswerDegradedReason } from '../../db/DatabaseManager';
import type { CredentialsManager } from '../CredentialsManager';
import type { RealtimeContextCandidate } from '../context/RealtimeContextOrchestrator';
import { BusinessMcpClient } from './BusinessMcpClient';
import { detectBusinessSystemTrigger } from './BusinessSystemTriggerDetector';
import type {
    BusinessSystemEvidence,
    BusinessSystemFixedReplyStatus,
    BusinessSystemKnowledgeSource,
    BusinessSystemQueryResult,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';
import type { WindchillBusinessContextAdapter } from './WindchillBusinessContextAdapter';

const WINDCHILL_QUERY_TIMEOUT_MS = 6000;

export type BusinessSystemServiceResult =
    | { kind: 'skipped' }
    | ReturnType<typeof toBusinessSystemFixedReply>
    | { kind: 'context'; status: 'ok'; sourceName: string; candidate: RealtimeContextCandidate; answer: string };

export interface BusinessSystemResolveInput {
    question?: string;
    recentContext?: string;
}

interface BusinessSystemContextServiceDeps {
    credentialsManager: Pick<CredentialsManager, 'getBusinessSystemKnowledgeSources' | 'getBusinessSystemCredentials'>;
    mcpClient?: Pick<BusinessMcpClient, 'query'>;
    plmAdapter?: Pick<WindchillBusinessContextAdapter, 'query'>;
}

function pickSource(sources: BusinessSystemKnowledgeSource[], hint?: BusinessSystemSourceKind): BusinessSystemKnowledgeSource | { status: 'ambiguous' } | undefined {
    const enabled = sources.filter((source) => source.enabled);
    if (hint && hint !== 'business_system') {
        const matching = enabled.filter((source) => source.kind === hint);
        if (matching.length === 1) return matching[0];
        if (matching.length > 1) return matching.find((source) => source.isDefault) || { status: 'ambiguous' };
        return undefined;
    }
    if (hint === 'business_system') {
        const generic = enabled.filter((source) => source.kind === 'business_system');
        if (generic.length === 1) return generic[0];
        if (generic.length > 1) return generic.find((source) => source.isDefault) || { status: 'ambiguous' };
    }
    const defaults = enabled.filter((source) => source.isDefault);
    if (defaults.length === 1) return defaults[0];
    if (enabled.length === 1) return enabled[0];
    if (enabled.length > 1) return { status: 'ambiguous' };
    return undefined;
}

function isAmbiguousSourceSelection(
    source: BusinessSystemKnowledgeSource | { status: 'ambiguous' } | undefined,
): source is { status: 'ambiguous' } {
    return Boolean(source && 'status' in source && source.status === 'ambiguous');
}

export function businessSystemDegradedReasonForStatus(status: BusinessSystemFixedReplyStatus): AnswerDegradedReason {
    switch (status) {
        case 'missing_query_anchor':
            return 'business_system_missing_query_anchor';
        case 'unsupported_operation':
            return 'business_system_unsupported_operation';
        case 'auth_failed':
            return 'business_system_auth_failed';
        case 'timeout':
            return 'business_system_timeout';
        case 'no_result':
            return 'business_system_no_result';
        case 'ambiguous':
            return 'business_system_ambiguous';
        case 'not_configured':
            return 'business_system_not_configured';
        case 'unavailable':
            return 'business_system_unavailable';
        case 'error':
            return 'business_system_error';
    }
}

export function toBusinessSystemFixedReply(input: {
    status: BusinessSystemFixedReplyStatus;
    sourceName?: string;
}): { kind: 'fixed_reply'; status: BusinessSystemFixedReplyStatus; answer: string; sourceName?: string } {
    const sourceName = input.sourceName || '业务系统知识源';
    if (input.status === 'not_configured') {
        return {
            kind: 'fixed_reply',
            status: input.status,
            answer: '当前没有配置可用的业务系统知识源，无法从业务系统确认该信息。',
        };
    }
    if (input.status === 'missing_query_anchor') {
        return {
            kind: 'fixed_reply',
            status: input.status,
            sourceName: input.sourceName,
            answer: '我可以查业务系统知识源，但现在还缺少要查询的物料、项目、图纸、需求或问题线索。',
        };
    }
    if (input.status === 'no_result') {
        return { kind: 'fixed_reply', status: input.status, sourceName, answer: `我没有从${sourceName}中确认到相关信息。` };
    }
    if (input.status === 'ambiguous') {
        return { kind: 'fixed_reply', status: input.status, sourceName, answer: `${sourceName}返回了多个可能结果，需要你指定是哪一个。` };
    }
    if (input.status === 'auth_failed') {
        return { kind: 'fixed_reply', status: input.status, sourceName, answer: `${sourceName}认证失败或不可用，无法确认该信息。` };
    }
    if (input.status === 'timeout') {
        return { kind: 'fixed_reply', status: input.status, sourceName, answer: `${sourceName}查询超时，无法从业务系统确认该信息。` };
    }
    if (input.status === 'unavailable') {
        return { kind: 'fixed_reply', status: input.status, sourceName, answer: `${sourceName}当前不可用，无法确认该信息。` };
    }
    if (input.status === 'unsupported_operation') {
        return {
            kind: 'fixed_reply',
            status: input.status,
            sourceName,
            answer: '当前只支持只读查询，暂不支持创建、修改、审批、提交、删除或写回操作。',
        };
    }
    return { kind: 'fixed_reply', status: 'error', sourceName, answer: `查询${sourceName}时失败，无法确认该信息。` };
}

function formatDeterministicBusinessAnswer(sourceName: string, result: BusinessSystemQueryResult): string {
    const records = result.evidence?.records ?? [];
    if (records.length > 0) {
        const lines = [`已从 ${sourceName} 查询到以下结果：`, ''];
        records.slice(0, 5).forEach((record, index) => {
            lines.push(`记录 ${index + 1}：${record.title || '未命名记录'}`);
            for (const field of record.fields.slice(0, 16)) {
                lines.push(`- ${field.name}: ${field.value}`);
            }
            if (index < records.length - 1) lines.push('');
        });
        lines.push('');
        lines.push(`共查询到 ${result.evidence?.recordCount ?? records.length} 条记录。`);
        return lines.join('\n');
    }
    const summary = String(result.summary || '').trim();
    return `根据 ${sourceName} 的查询结果：\n${summary}`;
}

function formatEvidenceContext(sourceName: string, evidence: BusinessSystemEvidence): string {
    const label = evidence.source === 'windchill' ? 'Windchill' : sourceName;
    const lines = [
        `${label} 结构化查询结果：`,
    ];
    if (evidence.sourceTool) lines.push(`工具：${evidence.sourceTool}`);
    lines.push(`记录数：${evidence.recordCount}`);
    evidence.records.slice(0, 5).forEach((record, index) => {
        lines.push(`记录 ${index + 1}${record.title ? `：${record.title}` : '：'}`);
        for (const field of record.fields.slice(0, 16)) {
            lines.push(`- ${field.name}: ${field.value}`);
        }
    });
    if (typeof evidence.omittedFieldCount === 'number' && evidence.omittedFieldCount > 0) {
        lines.push(`已省略字段数：${evidence.omittedFieldCount}`);
    }
    lines.push('请用中文自然汇报，不要输出 JSON，不要编造缺失字段。');
    return lines.join('\n');
}

function hasBusinessSystemContent(result: BusinessSystemQueryResult): boolean {
    return Boolean(
        result.summary?.trim()
        || result.evidence?.records?.length
        || (typeof result.evidence?.recordCount === 'number' && result.evidence.recordCount > 0)
        || result.items?.length
    );
}

function buildContextCandidate(source: BusinessSystemKnowledgeSource, result: BusinessSystemQueryResult): RealtimeContextCandidate {
    const sourceName = result.sourceName || source.name;
    const summary = String(result.summary || '').trim();
    const text = result.evidence
        ? formatEvidenceContext(sourceName, result.evidence)
        : `根据 ${sourceName}：${summary}`;
    return {
        source: 'business_system',
        sourceId: source.id,
        text,
        tokenCount: Math.max(1, Math.ceil(text.length / 4)),
        metadata: {
            sourceName,
            status: result.status,
            kind: source.kind,
            evidenceSource: result.evidence?.source,
            sourceTool: result.evidence?.sourceTool,
            recordCount: result.evidence?.recordCount,
        },
    };
}

export class BusinessSystemContextService {
    private credentialsManager: BusinessSystemContextServiceDeps['credentialsManager'];
    private mcpClient: Pick<BusinessMcpClient, 'query'>;
    private plmAdapter?: Pick<WindchillBusinessContextAdapter, 'query'>;

    constructor(deps: BusinessSystemContextServiceDeps) {
        this.credentialsManager = deps.credentialsManager;
        this.mcpClient = deps.mcpClient || new BusinessMcpClient();
        this.plmAdapter = deps.plmAdapter;
    }

    async resolve(input: BusinessSystemResolveInput): Promise<BusinessSystemServiceResult> {
        const trigger = detectBusinessSystemTrigger(input.question, input.recentContext);
        if (!trigger.shouldQuery) {
            if (trigger.failureReason === 'missing_query_anchor') {
                return toBusinessSystemFixedReply({ status: trigger.failureReason });
            }
            if (trigger.failureReason === 'unsupported_operation') {
                return toBusinessSystemFixedReply({
                    status: 'unsupported_operation',
                    sourceName: trigger.sourceHint,
                });
            }
            return { kind: 'skipped' };
        }

        const selectedSource = pickSource(this.credentialsManager.getBusinessSystemKnowledgeSources(), trigger.sourceHint);
        if (isAmbiguousSourceSelection(selectedSource)) {
            return toBusinessSystemFixedReply({ status: 'ambiguous' });
        }
        if (!selectedSource) {
            return toBusinessSystemFixedReply({ status: 'not_configured' });
        }

        const source = selectedSource;
        const credentials = this.credentialsManager.getBusinessSystemCredentials(source.id);
        let result: BusinessSystemQueryResult;
        try {
            // PLM 类知识源走专用 adapter(只支持 Windchill);
            // 其他(QMS、business_system、未识别的 MCP)继续原路调 business_context.query。
            if (source.kind === 'plm' && this.plmAdapter) {
                result = await this.plmAdapter.query(
                    {
                        query: trigger.query || '',
                        sourceHint: trigger.sourceHint,
                        recentContext: trigger.recentContext,
                        sourceUrl: source.url,
                    },
                    credentials,
                    WINDCHILL_QUERY_TIMEOUT_MS,
                );
            } else {
                result = await this.mcpClient.query(source, credentials, {
                    query: trigger.query || '',
                    sourceHint: trigger.sourceHint,
                    recentContext: trigger.recentContext,
                });
            }
        } catch {
            return toBusinessSystemFixedReply({
                status: 'unavailable',
                sourceName: source.name,
            });
        }

        if (result.status !== 'ok' || !hasBusinessSystemContent(result)) {
            const failureStatus = result.status === 'ok' ? 'no_result' : result.status;
            return toBusinessSystemFixedReply({
                status: failureStatus,
                sourceName: result.sourceName || source.name,
            });
        }

        return {
            kind: 'context',
            status: 'ok',
            sourceName: result.sourceName || source.name,
            candidate: buildContextCandidate(source, result),
            answer: formatDeterministicBusinessAnswer(result.sourceName || source.name, result),
        };
    }
}
