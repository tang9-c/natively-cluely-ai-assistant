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

interface GeminiToolAdapterConfig {
    provider: string;
    model: string;
    generateContent: (
        request: Record<string, any>,
        options: { timeout: number; signal?: AbortSignal },
    ) => Promise<any>;
}

function mapTool(tool: Tool): Record<string, unknown> {
    return {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parametersJsonSchema: tool.inputSchema,
        ...(tool.outputSchema ? { responseJsonSchema: tool.outputSchema } : {}),
    };
}

function resultResponse(message: Extract<McpAgentMessage, { role: 'tool' }>): Record<string, unknown> {
    try {
        JSON.stringify(message.result.content);
        return { content: message.result.content };
    } catch (error) {
        throw new McpToolCallingError(
            'mcp_tool_result_unsupported',
            `MCP tool result for ${message.name} cannot be serialized`,
            { cause: error },
        );
    }
}

function mapMessages(messages: McpAgentMessage[]): { systemInstruction?: string; contents: Record<string, any>[] } {
    const systemInstruction = messages
        .filter((message): message is Extract<McpAgentMessage, { role: 'system' }> => message.role === 'system')
        .map((message) => message.text)
        .join('\n\n');
    const contents: Record<string, any>[] = [];

    for (const message of messages) {
        if (message.role === 'system') continue;
        if (message.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: message.text }] });
            continue;
        }
        if (message.role === 'assistant') {
            const parts: Record<string, unknown>[] = [];
            if (message.text) parts.push({ text: message.text });
            for (const call of message.toolCalls || []) {
                parts.push({ functionCall: { id: call.callId, name: call.name, args: call.arguments } });
            }
            contents.push({ role: 'model', parts });
            continue;
        }
        const part = {
            functionResponse: {
                id: message.callId,
                name: message.name,
                response: resultResponse(message),
            },
        };
        const previous = contents.at(-1);
        if (previous?.role === 'user' && Array.isArray(previous.parts)
            && previous.parts.every((item: any) => item?.functionResponse)) {
            previous.parts.push(part);
        } else {
            contents.push({ role: 'user', parts: [part] });
        }
    }
    return { ...(systemInstruction ? { systemInstruction } : {}), contents };
}

function parseCalls(parts: unknown): ModelRequestedToolCall[] {
    if (!Array.isArray(parts)) return [];
    return parts.flatMap((part: any, index) => {
        const call = part?.functionCall;
        if (!call) return [];
        if (typeof call.name !== 'string' || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) {
            throw new McpToolCallingError('mcp_protocol_error', 'Gemini returned an invalid MCP tool call');
        }
        return [{
            callId: typeof call.id === 'string' && call.id ? call.id : `gemini-call-${index}`,
            name: call.name,
            arguments: call.args,
        }];
    });
}

export class GeminiToolAdapter implements ModelToolCallingAdapter {
    readonly provider: string;
    readonly model: string;
    private readonly generateContent: GeminiToolAdapterConfig['generateContent'];

    constructor(config: GeminiToolAdapterConfig) {
        this.provider = config.provider;
        this.model = config.model;
        this.generateContent = config.generateContent;
    }

    async runTurn(input: ModelToolCallingTurnInput): Promise<ModelToolCallingTurn> {
        const mapped = mapMessages(input.messages);
        let response: any;
        try {
            response = await this.generateContent({
                model: this.model,
                contents: mapped.contents,
                config: {
                    ...(mapped.systemInstruction ? { systemInstruction: mapped.systemInstruction } : {}),
                    tools: [{ functionDeclarations: input.tools.map(mapTool) }],
                    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
                },
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
        const parts = response?.candidates?.[0]?.content?.parts;
        const calls = parseCalls(parts);
        if (calls.length > 0) return { type: 'tool_calls', calls };
        const text = Array.isArray(parts)
            ? parts.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('')
            : typeof response?.text === 'string' ? response.text : '';
        return { type: 'answer', text };
    }
}
