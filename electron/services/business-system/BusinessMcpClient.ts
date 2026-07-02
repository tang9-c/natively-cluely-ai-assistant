import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
    BusinessSystemCredentialInput,
    BusinessSystemKnowledgeSource,
    BusinessSystemQueryResult,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';

export const BUSINESS_CONTEXT_TOOL_NAME = 'business_context.query';

export interface BusinessMcpQueryInput {
    query: string;
    sourceHint?: BusinessSystemSourceKind;
    recentContext?: string;
}

function parseTextContent(result: any): unknown {
    const firstText = Array.isArray(result?.content)
        ? result.content.find((item: any) => item?.type === 'text' && typeof item.text === 'string')
        : null;
    if (!firstText) return null;
    try {
        return JSON.parse(firstText.text);
    } catch {
        return null;
    }
}

function validStatus(status: unknown): status is BusinessSystemQueryResult['status'] {
    return [
        'ok',
        'no_result',
        'ambiguous',
        'auth_failed',
        'unavailable',
        'timeout',
        'error',
    ].includes(status as string);
}

export function normalizeBusinessMcpToolResult(result: any, fallbackSourceName: string): BusinessSystemQueryResult {
    if (result?.isError) {
        return { status: 'error', sourceName: fallbackSourceName, errorCode: 'tool_error' };
    }
    const parsed = parseTextContent(result);
    if (!parsed || typeof parsed !== 'object') {
        return { status: 'error', sourceName: fallbackSourceName, errorCode: 'invalid_tool_result' };
    }
    const record = parsed as Record<string, unknown>;
    const status = validStatus(record.status) ? record.status : 'error';
    const sourceName = typeof record.sourceName === 'string' && record.sourceName.trim()
        ? record.sourceName.trim()
        : fallbackSourceName;
    const summary = typeof record.summary === 'string' ? record.summary.trim() : undefined;
    const items = Array.isArray(record.items) ? record.items : undefined;
    const errorCode = typeof record.errorCode === 'string' ? record.errorCode : undefined;
    return { status, sourceName, summary, items, errorCode };
}

function buildHeaders(source: BusinessSystemKnowledgeSource, credentials?: BusinessSystemCredentialInput): Record<string, string> {
    if (!credentials) return {};
    if (source.authType === 'api_key' && credentials.apiKey) {
        return { Authorization: `Bearer ${credentials.apiKey}` };
    }
    if (source.authType === 'username_password' && credentials.username && credentials.password) {
        const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
        return { Authorization: `Basic ${token}` };
    }
    return {};
}

export class BusinessMcpClient {
    async query(
        source: BusinessSystemKnowledgeSource,
        credentials: BusinessSystemCredentialInput | undefined,
        input: BusinessMcpQueryInput,
        timeoutMs = 2000,
    ): Promise<BusinessSystemQueryResult> {
        const client = new Client({ name: 'natively-business-context', version: '1.0.0' });

        try {
            const transport = new StreamableHTTPClientTransport(new URL(source.url), {
                requestInit: { headers: buildHeaders(source, credentials) },
            } as any);
            await client.connect(transport, { timeout: timeoutMs } as any);
            const result = await client.callTool(
                {
                    name: BUSINESS_CONTEXT_TOOL_NAME,
                    arguments: {
                        query: input.query,
                        sourceHint: input.sourceHint,
                        recentContext: input.recentContext,
                    },
                },
                { timeout: timeoutMs } as any,
            );
            return normalizeBusinessMcpToolResult(result, source.name);
        } catch (error: any) {
            const message = String(error?.message || '');
            if (/timeout|aborted|deadline/i.test(message)) {
                return { status: 'timeout', sourceName: source.name, errorCode: 'timeout' };
            }
            if (/unauthorized|forbidden|401|403/i.test(message)) {
                return { status: 'auth_failed', sourceName: source.name, errorCode: 'auth_failed' };
            }
            return { status: 'unavailable', sourceName: source.name, errorCode: 'mcp_unavailable' };
        } finally {
            await client.close().catch((): undefined => undefined);
        }
    }
}
