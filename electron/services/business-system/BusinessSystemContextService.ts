import type { AnswerDegradedReason } from '../../db/DatabaseManager';
import type { CredentialsManager } from '../CredentialsManager';
import type { SettingsManager } from '../SettingsManager';
import type { RealtimeContextCandidate } from '../context/RealtimeContextOrchestrator';
import { detectBusinessSystemTrigger } from './BusinessSystemTriggerDetector';
import type { McpAgentLoop, McpAgentRunResult } from './McpAgentLoop';
import type {
    BusinessSystemFixedReplyStatus,
    BusinessSystemKnowledgeSource,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';

export type BusinessSystemServiceResult =
    | { kind: 'skipped' }
    | ReturnType<typeof toBusinessSystemFixedReply>
    | { kind: 'context'; status: 'ok'; sourceName: string; candidate: RealtimeContextCandidate; answer: string };

export interface BusinessSystemResolveInput {
    question?: string;
    recentContext?: string;
}

interface BusinessSystemContextServiceDeps {
    credentialsManager: Pick<CredentialsManager,
        'getBusinessSystemKnowledgeSources'
        | 'getBusinessSystemCredentials'
        | 'getBusinessSystemCredentialRevision'>;
    agentLoop: Pick<McpAgentLoop, 'run'>;
    settingsManager?: Pick<SettingsManager, 'getNativeMcpToolCallingEnabled'>;
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

function buildContextCandidate(
    source: BusinessSystemKnowledgeSource,
    answer: string,
    traceId: string,
    toolCalls: number,
): RealtimeContextCandidate {
    const text = `根据 ${source.name} 的 MCP 查询结果：\n${answer}`;
    return {
        source: 'business_system',
        sourceId: source.id,
        text,
        tokenCount: Math.max(1, Math.ceil(text.length / 4)),
        metadata: {
            sourceName: source.name,
            status: 'ok',
            kind: source.kind,
            traceId,
            toolCalls,
        },
    };
}

function mapAgentFailure(result: Extract<McpAgentRunResult, { status: 'error' }>): BusinessSystemFixedReplyStatus {
    if (result.errorCode === 'mcp_auth_failed') return 'auth_failed';
    if (result.errorCode === 'mcp_timeout') return 'timeout';
    if (result.errorCode === 'mcp_unavailable' || result.errorCode === 'mcp_tool_calling_unsupported') {
        return 'unavailable';
    }
    return 'error';
}

export class BusinessSystemContextService {
    private credentialsManager: BusinessSystemContextServiceDeps['credentialsManager'];
    private agentLoop: Pick<McpAgentLoop, 'run'>;
    private settingsManager?: BusinessSystemContextServiceDeps['settingsManager'];

    constructor(deps: BusinessSystemContextServiceDeps) {
        this.credentialsManager = deps.credentialsManager;
        this.agentLoop = deps.agentLoop;
        this.settingsManager = deps.settingsManager;
    }

    async resolve(input: BusinessSystemResolveInput): Promise<BusinessSystemServiceResult> {
        const trigger = detectBusinessSystemTrigger(input.question, input.recentContext);
        if (!trigger.shouldQuery) {
            if (trigger.failureReason === 'missing_query_anchor') {
                return toBusinessSystemFixedReply({ status: trigger.failureReason });
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
        if (this.settingsManager?.getNativeMcpToolCallingEnabled() === false) {
            return toBusinessSystemFixedReply({ status: 'unavailable', sourceName: source.name });
        }
        const credentials = this.credentialsManager.getBusinessSystemCredentials(source.id);
        let result: McpAgentRunResult;
        try {
            result = await this.agentLoop.run({
                source,
                credentials,
                credentialRevision: this.credentialsManager.getBusinessSystemCredentialRevision(source.id),
                question: trigger.query || '',
                recentContext: trigger.recentContext,
            });
        } catch {
            return toBusinessSystemFixedReply({
                status: 'unavailable',
                sourceName: source.name,
            });
        }

        if (result.status !== 'ok') {
            return toBusinessSystemFixedReply({
                status: mapAgentFailure(result),
                sourceName: source.name,
            });
        }

        return {
            kind: 'context',
            status: 'ok',
            sourceName: source.name,
            candidate: buildContextCandidate(source, result.answer, result.traceId, result.toolCalls),
            answer: result.answer,
        };
    }
}
