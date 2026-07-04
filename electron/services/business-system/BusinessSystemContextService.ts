import type { AnswerDegradedReason } from '../../db/DatabaseManager';
import type { CredentialsManager } from '../CredentialsManager';
import type { RealtimeContextCandidate } from '../context/RealtimeContextOrchestrator';
import { BusinessMcpClient } from './BusinessMcpClient';
import { detectBusinessSystemTrigger } from './BusinessSystemTriggerDetector';
import type {
    BusinessSystemFixedReplyStatus,
    BusinessSystemKnowledgeSource,
    BusinessSystemQueryResult,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';

export type BusinessSystemServiceResult =
    | { kind: 'skipped' }
    | ReturnType<typeof toBusinessSystemFixedReply>
    | { kind: 'context'; status: 'ok'; sourceName: string; candidate: RealtimeContextCandidate };

export interface BusinessSystemResolveInput {
    question?: string;
    recentContext?: string;
}

interface BusinessSystemContextServiceDeps {
    credentialsManager: Pick<CredentialsManager, 'getBusinessSystemKnowledgeSources' | 'getBusinessSystemCredentials'>;
    mcpClient?: Pick<BusinessMcpClient, 'query'>;
}

function enabledSourcesForHint(sources: BusinessSystemKnowledgeSource[], hint?: BusinessSystemSourceKind): BusinessSystemKnowledgeSource[] {
    const enabled = sources.filter((source) => source.enabled);
    if (!hint || hint === 'business_system') return enabled;
    return enabled.filter((source) => source.kind === hint);
}

function pickSource(sources: BusinessSystemKnowledgeSource[], hint?: BusinessSystemSourceKind): BusinessSystemKnowledgeSource | undefined {
    const candidates = enabledSourcesForHint(sources, hint);
    return candidates.find((source) => source.isDefault) || candidates[0];
}

export function businessSystemDegradedReasonForStatus(status: BusinessSystemFixedReplyStatus): AnswerDegradedReason {
    switch (status) {
        case 'missing_query_anchor':
            return 'business_system_missing_query_anchor';
        case 'auth_failed':
            return 'business_system_auth_failed';
        case 'timeout':
            return 'business_system_timeout';
        case 'no_result':
            return 'business_system_no_result';
        case 'ambiguous':
            return 'business_system_ambiguous';
        case 'not_configured':
        case 'unavailable':
        case 'error':
            return 'business_system_unavailable';
    }
}

export function toBusinessSystemFixedReply(input: {
    status: BusinessSystemFixedReplyStatus;
    sourceName?: string;
    answer?: string;
}): { kind: 'fixed_reply'; status: BusinessSystemFixedReplyStatus; answer: string; sourceName?: string } {
    const sourceName = input.sourceName || '业务系统知识源';
    if (input.answer?.trim()) {
        return {
            kind: 'fixed_reply',
            status: input.status,
            answer: input.answer.trim(),
            sourceName: input.sourceName,
        };
    }
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
    return { kind: 'fixed_reply', status: 'error', sourceName, answer: `查询${sourceName}时失败，无法确认该信息。` };
}

function buildContextCandidate(source: BusinessSystemKnowledgeSource, result: BusinessSystemQueryResult): RealtimeContextCandidate {
    const sourceName = result.sourceName || source.name;
    const summary = String(result.summary || '').trim();
    const text = `根据 ${sourceName}：${summary}`;
    return {
        source: 'business_system',
        sourceId: source.id,
        text,
        tokenCount: Math.max(1, Math.ceil(text.length / 4)),
        metadata: {
            sourceName,
            status: result.status,
            kind: source.kind,
        },
    };
}

export class BusinessSystemContextService {
    private credentialsManager: BusinessSystemContextServiceDeps['credentialsManager'];
    private mcpClient: Pick<BusinessMcpClient, 'query'>;

    constructor(deps: BusinessSystemContextServiceDeps) {
        this.credentialsManager = deps.credentialsManager;
        this.mcpClient = deps.mcpClient || new BusinessMcpClient();
    }

    async resolve(input: BusinessSystemResolveInput): Promise<BusinessSystemServiceResult> {
        const trigger = detectBusinessSystemTrigger(input.question, input.recentContext);
        if (!trigger.shouldQuery) {
            if (trigger.failureReason === 'missing_query_anchor') {
                return toBusinessSystemFixedReply({
                    status: 'missing_query_anchor',
                    answer: trigger.userMessage || '我可以查业务系统知识源，但现在还缺少要查询的业务线索。',
                });
            }
            return { kind: 'skipped' };
        }

        const source = pickSource(this.credentialsManager.getBusinessSystemKnowledgeSources(), trigger.sourceHint);
        if (!source) {
            return toBusinessSystemFixedReply({ status: 'not_configured' });
        }

        const credentials = this.credentialsManager.getBusinessSystemCredentials(source.id);
        let result: BusinessSystemQueryResult;
        try {
            result = await this.mcpClient.query(source, credentials, {
                query: trigger.query || '',
                sourceHint: trigger.sourceHint,
                recentContext: trigger.recentContext,
            });
        } catch {
            return toBusinessSystemFixedReply({
                status: 'unavailable',
                sourceName: source.name,
            });
        }

        if (result.status !== 'ok' || !result.summary?.trim()) {
            const failureStatus = result.status === 'ok' ? 'error' : result.status;
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
        };
    }
}
