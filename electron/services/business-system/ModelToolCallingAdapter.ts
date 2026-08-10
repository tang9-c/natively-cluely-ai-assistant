import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ModelRequestedToolCall {
    callId: string;
    name: string;
    arguments: Record<string, unknown>;
}

export type McpAgentMessage =
    | { role: 'system'; text: string }
    | { role: 'user'; text: string }
    | { role: 'assistant'; text?: string; toolCalls?: ModelRequestedToolCall[] }
    | { role: 'tool'; callId: string; name: string; result: CallToolResult };

export interface ModelToolCallingTurnInput {
    messages: McpAgentMessage[];
    tools: Tool[];
    timeoutMs: number;
    abortSignal?: AbortSignal;
}

export type ModelToolCallingTurn =
    | { type: 'tool_calls'; calls: ModelRequestedToolCall[] }
    | { type: 'answer'; text: string };

export interface ModelToolCallingAdapter {
    readonly provider: string;
    readonly model: string;
    runTurn(input: ModelToolCallingTurnInput): Promise<ModelToolCallingTurn>;
}

export type McpToolCallingErrorCode =
    | 'mcp_auth_failed'
    | 'mcp_timeout'
    | 'mcp_unavailable'
    | 'mcp_protocol_error'
    | 'mcp_tool_calling_unsupported'
    | 'mcp_tool_catalog_unsupported'
    | 'mcp_tool_result_unsupported'
    | 'mcp_agent_limit_reached';

export class McpToolCallingError extends Error {
    readonly code: McpToolCallingErrorCode;

    constructor(code: McpToolCallingErrorCode, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'McpToolCallingError';
        this.code = code;
    }
}

export function rethrowToolPayloadError(
    error: unknown,
    provider: string,
    hasToolResult: boolean,
): never {
    if (error instanceof McpToolCallingError) throw error;
    const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
    const status = Number(candidate?.status || candidate?.statusCode || candidate?.code);
    const message = String(candidate?.message || '');
    const isRejectedRequest = status === 400 || status === 413 || status === 422;
    const isCatalogSpecific = /(tool(?:s| catalog)?|function(?: declaration)?|schema)/i.test(message);
    const isSizeSpecific = /(context|token|payload|request entity|too large|maximum.{0,16}length|size|limit)/i.test(message);
    if (isRejectedRequest && hasToolResult && isSizeSpecific) {
        throw new McpToolCallingError(
            'mcp_tool_result_unsupported',
            `${provider} rejected the MCP tool result payload`,
            { cause: error },
        );
    }
    if (isRejectedRequest && isCatalogSpecific) {
        throw new McpToolCallingError(
            'mcp_tool_catalog_unsupported',
            `${provider} rejected the MCP tool catalog`,
            { cause: error },
        );
    }
    if (isRejectedRequest && isSizeSpecific) {
        throw new McpToolCallingError(
            'mcp_tool_catalog_unsupported',
            `${provider} rejected the MCP tool catalog`,
            { cause: error },
        );
    }
    throw error;
}
