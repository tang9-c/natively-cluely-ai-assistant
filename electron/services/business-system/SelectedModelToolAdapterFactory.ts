import { AnthropicToolAdapter } from './AnthropicToolAdapter';
import { GeminiToolAdapter } from './GeminiToolAdapter';
import { McpToolCallingError, type ModelToolCallingAdapter } from './ModelToolCallingAdapter';
import { OpenAICompatibleToolAdapter } from './OpenAICompatibleToolAdapter';

type SelectedToolCallingBinding =
    | { kind: 'openai_compatible'; provider: string; model: string; client: any }
    | { kind: 'anthropic'; provider: string; model: string; client: any }
    | { kind: 'gemini'; provider: string; model: string; client: any }
    | { kind: 'unsupported'; provider: string; model: string; client?: null };

interface SelectedModelToolAdapterHost {
    getSelectedToolCallingBinding(): SelectedToolCallingBinding;
    assertMcpToolCallingDataScopes(provider: string, text: string): void;
}

export function createSelectedModelToolAdapter(
    llmHelper: SelectedModelToolAdapterHost,
    payload: { question: string; recentContext: string },
): ModelToolCallingAdapter {
    const binding = llmHelper.getSelectedToolCallingBinding();
    llmHelper.assertMcpToolCallingDataScopes(
        binding.provider,
        [payload.question, payload.recentContext].filter(Boolean).join('\n\n'),
    );
    if (binding.kind === 'unsupported' || !binding.client) {
        throw new McpToolCallingError(
            'mcp_tool_calling_unsupported',
            `Selected model ${binding.model} does not support native MCP tool calling`,
        );
    }
    if (binding.kind === 'openai_compatible') {
        return new OpenAICompatibleToolAdapter({
            provider: binding.provider,
            model: binding.model,
            createCompletion: (request, options) => binding.client.chat.completions.create(request, options),
        });
    }
    if (binding.kind === 'anthropic') {
        return new AnthropicToolAdapter({
            provider: binding.provider,
            model: binding.model,
            createMessage: (request, options) => binding.client.messages.create(request, options),
        });
    }
    return new GeminiToolAdapter({
        provider: binding.provider,
        model: binding.model,
        generateContent: (request, options) => binding.client.models.generateContent({
            ...request,
            config: {
                ...request.config,
                abortSignal: options.signal,
                httpOptions: { timeout: options.timeout },
            },
        }),
    });
}
