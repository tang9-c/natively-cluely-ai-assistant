import type {
    BusinessSystemCredentialInput,
    BusinessSystemQueryResult,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';
import { McpRpcClient } from './McpRpcClient';
import { planWindchillQuery, type WindchillPlannedCall } from './windchill/WindchillQueryPlanner';
import {
    extractTextJson,
    firstODataRecord,
    formatWindchillResult,
    getRecordId,
} from './windchill/WindchillResultFormatter';

export interface WindchillBusinessContextAdapterConfig {
    sourceName?: string;
    fetchImpl?: typeof fetch;
    nowMs?: () => number;
}

export interface WindchillBusinessContextQueryInput {
    query: string;
    sourceHint?: BusinessSystemSourceKind;
    recentContext?: string;
    sourceUrl?: string;
}

export interface WindchillBusinessContextAdapter {
    query(
        input: WindchillBusinessContextQueryInput,
        credentials: BusinessSystemCredentialInput | undefined,
        timeoutMs: number,
    ): Promise<BusinessSystemQueryResult>;
}

const TOOL_CACHE_TTL_MS = 10 * 60 * 1000;
const toolCache = new Map<string, { expiresAt: number; names: Set<string> }>();

function resolveCallArguments(call: WindchillPlannedCall, results: Record<string, unknown>): Record<string, unknown> | null {
    if (!call.argumentsFrom) return { ...call.arguments };
    if (call.argumentsFrom === 'partSearch:firstId') {
        const id = getRecordId(firstODataRecord(results.partSearch));
        return id ? { ...call.arguments, id } : null;
    }
    if (call.argumentsFrom === 'changeSearch:firstId') {
        const id = getRecordId(firstODataRecord(results.changeSearch));
        return id ? { ...call.arguments, id } : null;
    }
    return null;
}

export function createWindchillBusinessContextAdapter(
    config: WindchillBusinessContextAdapterConfig = {},
): WindchillBusinessContextAdapter {
    const sourceName = config.sourceName || 'Windchill PLM';
    const nowMs = config.nowMs || Date.now;

    return {
        async query(input, credentials, timeoutMs) {
            if (input.sourceHint !== 'plm') {
                return { status: 'no_result', sourceName };
            }
            const url = input.sourceUrl;
            if (!url) {
                return { status: 'not_configured', sourceName, errorCode: 'no_url' };
            }
            const apiKey = credentials?.apiKey;
            if (!apiKey) {
                return { status: 'auth_failed', sourceName, errorCode: 'no_api_key' };
            }

            const plan = planWindchillQuery({ query: input.query, recentContext: input.recentContext });
            if (plan.kind === 'unsupported_operation') {
                return { status: 'unsupported_operation', sourceName, errorCode: 'unsupported_write_operation' };
            }
            if (plan.kind === 'missing_anchor') {
                return { status: 'missing_query_anchor', sourceName, errorCode: 'missing_query_anchor' };
            }

            try {
                const client = new McpRpcClient({
                    url,
                    authType: 'api_key',
                    credentials,
                    fetchImpl: config.fetchImpl,
                    clientInfo: { name: 'natively-windchill', version: '1.0.0' },
                });
                await client.initialize(Math.min(2000, timeoutMs));

                const cached = toolCache.get(url);
                if (!cached || cached.expiresAt <= nowMs()) {
                    const tools = await client.listTools(Math.min(2000, timeoutMs));
                    toolCache.set(url, {
                        expiresAt: nowMs() + TOOL_CACHE_TTL_MS,
                        names: new Set(tools.map((tool) => tool.name)),
                    });
                }

                const results: Record<string, unknown> = {};
                for (const call of plan.calls.slice(0, 3)) {
                    const args = resolveCallArguments(call, results);
                    if (!args) {
                        return {
                            status: 'ambiguous',
                            sourceName,
                            summary: 'Windchill 返回了多个候选结果，需要你指定是哪一个。',
                        };
                    }
                    const raw = await client.callTool(call.toolName, args, Math.min(2000, timeoutMs));
                    const parsed = extractTextJson(raw);
                    if (!parsed) return { status: 'error', sourceName, errorCode: 'invalid_tool_result' };
                    results[call.resultKey] = parsed;
                }

                return formatWindchillResult(plan.intent, results, sourceName);
            } catch (error) {
                const status = mapWindchillErrorToStatus(error);
                return { status, sourceName, errorCode: `windchill_${status}` };
            }
        },
    };
}

export function extractPartNumberFromQuery(query: string): string | null {
    const match = String(query || '').match(/([A-Za-z]{1,12}[-_ ]?\d{2,}|\d{3,}\*?)/);
    return match?.[1]?.replace(/\s+/g, '-') || null;
}

export function wrapWindchillPartResults(
    odata: { value?: unknown[] } | null | undefined,
    sourceName: string,
): BusinessSystemQueryResult {
    return formatWindchillResult('part_search', { partSearch: odata || { value: [] } }, sourceName);
}

export function mapWindchillErrorToStatus(error: unknown): BusinessSystemQueryResult['status'] {
    const err = error as { code?: string; name?: string; message?: string; statusCode?: number };
    const message = String(err?.message || '');
    const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 0;

    if (
        statusCode === 401 || statusCode === 403 ||
        /\b401\b|\b403\b|unauthorized|forbidden/i.test(message)
    ) {
        return 'auth_failed';
    }
    if (
        err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || err?.code === 'ABORT_ERR' ||
        /timeout|timed out|aborted|deadline/i.test(message)
    ) {
        return 'timeout';
    }
    return 'unavailable';
}
