import type { CredentialsManager } from '../CredentialsManager';
import type { RealtimeContextCandidate } from '../context/RealtimeContextOrchestrator';
import { BusinessMcpClient } from './BusinessMcpClient';
import { detectBusinessSystemTrigger } from './BusinessSystemTriggerDetector';
import type {
    BusinessSystemKnowledgeSource,
    BusinessSystemQueryResult,
    BusinessSystemQueryStatus,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';

export type BusinessSystemServiceResult =
    | { kind: 'skipped' }
    | { kind: 'fixed_reply'; status: BusinessSystemQueryStatus | 'missing_query_anchor' | 'not_configured'; answer: string; sourceName?: string }
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

function mapFailure(result: BusinessSystemQueryResult): { status: BusinessSystemQueryStatus; answer: string; sourceName: string } {
    const sourceName = result.sourceName || '业务系统知识源';
    if (result.status === 'no_result') {
        return { status: result.status, sourceName, answer: `我没有从${sourceName}中确认到相关信息。` };
    }
    if (result.status === 'ambiguous') {
        return { status: result.status, sourceName, answer: `${sourceName}返回了多个可能结果，需要你指定是哪一个。` };
    }
    if (result.status === 'auth_failed') {
        return { status: result.status, sourceName, answer: `${sourceName}认证失败或不可用，无法确认该信息。` };
    }
    if (result.status === 'timeout') {
        return { status: result.status, sourceName, answer: `${sourceName}查询超时，无法从业务系统确认该信息。` };
    }
    if (result.status === 'unavailable') {
        return { status: result.status, sourceName, answer: `${sourceName}当前不可用，无法确认该信息。` };
    }
    return { status: 'error', sourceName, answer: `查询${sourceName}时失败，无法确认该信息。` };
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
                return {
                    kind: 'fixed_reply',
                    status: 'missing_query_anchor',
                    answer: trigger.userMessage || '我可以查业务系统知识源，但现在还缺少要查询的业务线索。',
                };
            }
            return { kind: 'skipped' };
        }

        const source = pickSource(this.credentialsManager.getBusinessSystemKnowledgeSources(), trigger.sourceHint);
        if (!source) {
            return {
                kind: 'fixed_reply',
                status: 'not_configured',
                answer: '当前没有配置可用的业务系统知识源，无法从业务系统确认该信息。',
            };
        }

        const credentials = this.credentialsManager.getBusinessSystemCredentials(source.id);
        const result = await this.mcpClient.query(source, credentials, {
            query: trigger.query || '',
            sourceHint: trigger.sourceHint,
            recentContext: trigger.recentContext,
        });

        if (result.status !== 'ok' || !result.summary?.trim()) {
            const mapped = mapFailure(result.status === 'ok' ? { ...result, status: 'error' } : result);
            return { kind: 'fixed_reply', ...mapped };
        }

        return {
            kind: 'context',
            status: 'ok',
            sourceName: result.sourceName || source.name,
            candidate: buildContextCandidate(source, result),
        };
    }
}
