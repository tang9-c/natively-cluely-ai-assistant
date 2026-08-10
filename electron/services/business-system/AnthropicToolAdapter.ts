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

interface AnthropicToolAdapterConfig {
    provider: string;
    model: string;
    createMessage: (
        request: Record<string, unknown>,
        options: { timeout: number; signal?: AbortSignal },
    ) => Promise<any>;
}

function mapTool(tool: Tool): Record<string, unknown> {
    return {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        input_schema: tool.inputSchema,
    };
}

function serializeResult(message: Extract<McpAgentMessage, { role: 'tool' }>): string {
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

function mapMessages(messages: McpAgentMessage[]): { system?: string; messages: Record<string, unknown>[] } {
    const system = messages
        .filter((message): message is Extract<McpAgentMessage, { role: 'system' }> => message.role === 'system')
        .map((message) => message.text)
        .join('\n\n');
    const mapped: Record<string, any>[] = [];

    for (const message of messages) {
        if (message.role === 'system') continue;
        if (message.role === 'user') {
            mapped.push({ role: 'user', content: message.text });
            continue;
        }
        if (message.role === 'assistant') {
            const content: Record<string, unknown>[] = [];
            if (message.text) content.push({ type: 'text', text: message.text });
            for (const call of message.toolCalls || []) {
                content.push({ type: 'tool_use', id: call.callId, name: call.name, input: call.arguments });
            }
            mapped.push({ role: 'assistant', content });
            continue;
        }
        const block = {
            type: 'tool_result',
            tool_use_id: message.callId,
            content: serializeResult(message),
        };
        const previous = mapped.at(-1);
        if (previous?.role === 'user' && Array.isArray(previous.content)
            && previous.content.every((item: any) => item?.type === 'tool_result')) {
            previous.content.push(block);
        } else {
            mapped.push({ role: 'user', content: [block] });
        }
    }

    return { ...(system ? { system } : {}), messages: mapped };
}

function parseCalls(content: unknown): ModelRequestedToolCall[] {
    if (!Array.isArray(content)) return [];
    return content.filter((block: any) => block?.type === 'tool_use').map((block: any) => {
        if (typeof block.id !== 'string' || typeof block.name !== 'string'
            || !block.input || typeof block.input !== 'object' || Array.isArray(block.input)) {
            throw new McpToolCallingError('mcp_protocol_error', 'Anthropic returned an invalid MCP tool call');
        }
        return { callId: block.id, name: block.name, arguments: block.input };
    });
}

export class AnthropicToolAdapter implements ModelToolCallingAdapter {
    readonly provider: string;
    readonly model: string;
    private readonly createMessage: AnthropicToolAdapterConfig['createMessage'];

    constructor(config: AnthropicToolAdapterConfig) {
        this.provider = config.provider;
        this.model = config.model;
        this.createMessage = config.createMessage;
    }

    async runTurn(input: ModelToolCallingTurnInput): Promise<ModelToolCallingTurn> {
        const mapped = mapMessages(input.messages);
        let response: any;
        try {
            response = await this.createMessage({
                model: this.model,
                max_tokens: 4096,
                ...mapped,
                tools: input.tools.map(mapTool),
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
        const calls = parseCalls(response?.content);
        if (calls.length > 0) return { type: 'tool_calls', calls };
        const text = Array.isArray(response?.content)
            ? response.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text || '').join('')
            : '';
        return { type: 'answer', text };
    }
}
