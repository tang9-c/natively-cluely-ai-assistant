import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
    McpToolCallingError,
    rethrowToolPayloadError,
    type McpAgentMessage,
    type ModelRequestedToolCall,
    type ModelToolCallingAdapter,
    type ModelToolCallingTurn,
    type ModelToolCallingTurnInput,
} from './ModelToolCallingAdapter';

interface OpenAICompatibleToolAdapterConfig {
    provider: string;
    model: string;
    createCompletion: (
        request: Record<string, unknown>,
        options: { timeout: number; signal?: AbortSignal },
    ) => Promise<any>;
}

function mapTool(tool: Tool): Record<string, unknown> {
    return {
        type: 'function',
        function: {
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            parameters: tool.inputSchema,
        },
    };
}

function serializeToolResult(message: Extract<McpAgentMessage, { role: 'tool' }>): string {
    try {
        return JSON.stringify(message.result.content);
    } catch (error) {
        throw new McpToolCallingError(
            'mcp_tool_result_unsupported',
            `MCP tool result for ${message.name} cannot be serialized`,
            { cause: error },
        );
    }
}

function mapMessage(message: McpAgentMessage): Record<string, unknown> {
    if (message.role === 'system' || message.role === 'user') {
        return { role: message.role, content: message.text };
    }
    if (message.role === 'tool') {
        return {
            role: 'tool',
            tool_call_id: message.callId,
            content: serializeToolResult(message),
        };
    }
    if (message.role === 'assistant') {
        return {
            role: 'assistant',
            content: message.text || null,
            ...(message.toolCalls?.length ? {
                tool_calls: message.toolCalls.map((call) => ({
                    id: call.callId,
                    type: 'function',
                    function: {
                        name: call.name,
                        arguments: JSON.stringify(call.arguments),
                    },
                })),
            } : {}),
        };
    }
    throw new McpToolCallingError('mcp_protocol_error', 'Unsupported MCP agent message role');
}

function parseArguments(raw: unknown, toolName: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(typeof raw === 'string' ? raw : '');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        return parsed as Record<string, unknown>;
    } catch (error) {
        throw new McpToolCallingError(
            'mcp_protocol_error',
            `Model returned invalid arguments for MCP tool ${toolName}`,
            { cause: error },
        );
    }
}

function parseToolCalls(rawCalls: unknown): ModelRequestedToolCall[] {
    if (!Array.isArray(rawCalls)) return [];
    return rawCalls.map((rawCall: any) => {
        const callId = typeof rawCall?.id === 'string' ? rawCall.id : '';
        const name = typeof rawCall?.function?.name === 'string' ? rawCall.function.name : '';
        if (!callId || !name) {
            throw new McpToolCallingError('mcp_protocol_error', 'Model returned an invalid MCP tool call');
        }
        return {
            callId,
            name,
            arguments: parseArguments(rawCall.function.arguments, name),
        };
    });
}

export class OpenAICompatibleToolAdapter implements ModelToolCallingAdapter {
    readonly provider: string;
    readonly model: string;
    private readonly createCompletion: OpenAICompatibleToolAdapterConfig['createCompletion'];

    constructor(config: OpenAICompatibleToolAdapterConfig) {
        this.provider = config.provider;
        this.model = config.model;
        this.createCompletion = config.createCompletion;
    }

    async runTurn(input: ModelToolCallingTurnInput): Promise<ModelToolCallingTurn> {
        let response: any;
        try {
            response = await this.createCompletion({
                model: this.model,
                messages: input.messages.map(mapMessage),
                tools: input.tools.map(mapTool),
                tool_choice: 'auto',
            }, {
                timeout: input.timeoutMs,
                ...(input.abortSignal ? { signal: input.abortSignal } : {}),
            });
        } catch (error) {
            rethrowToolPayloadError(
                error,
                this.provider,
                input.messages.some((message) => message.role === 'tool'),
            );
        }

        const message = response?.choices?.[0]?.message;
        if (!message || typeof message !== 'object') {
            throw new McpToolCallingError('mcp_protocol_error', `${this.provider} returned no assistant message`);
        }
        const calls = parseToolCalls(message.tool_calls);
        if (calls.length > 0) return { type: 'tool_calls', calls };
        return { type: 'answer', text: typeof message.content === 'string' ? message.content : '' };
    }
}
