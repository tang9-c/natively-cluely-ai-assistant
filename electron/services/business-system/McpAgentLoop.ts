import { randomUUID } from 'node:crypto';

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

import type {
    BusinessSystemCredentialInput,
    BusinessSystemKnowledgeSource,
} from './BusinessSystemTypes';
import { McpToolCatalogCache } from './McpToolCatalogCache';
import { McpProcessTraceLogger } from './McpProcessTraceLogger';
import { McpRpcClient } from './McpRpcClient';
import {
    McpToolCallingError,
    type McpAgentMessage,
    type McpToolCallingErrorCode,
    type ModelToolCallingAdapter,
} from './ModelToolCallingAdapter';

interface McpClientLike {
    connect(timeoutMs: number, signal?: AbortSignal): Promise<unknown>;
    listTools(timeoutMs: number, signal?: AbortSignal): Promise<Tool[]>;
    callTool(
        name: string,
        args: Record<string, unknown>,
        timeoutMs: number,
        signal?: AbortSignal,
    ): Promise<unknown>;
    onToolsChanged(handler: () => void): void;
    close(): Promise<void>;
}

interface CatalogCacheLike {
    getOrLoad(input: {
        sourceId: string;
        credentialRevision: number;
        load: () => Promise<Tool[]>;
    }): Promise<Tool[]>;
    invalidate(sourceId: string): void;
}

interface TraceLoggerLike {
    success(event: string, payload: Record<string, unknown>): void;
    failure(event: string, payload: Record<string, unknown>): void;
}

interface McpAgentLoopDeps {
    clientFactory?: (
        source: BusinessSystemKnowledgeSource,
        credentials?: BusinessSystemCredentialInput,
    ) => McpClientLike;
    catalogCache?: CatalogCacheLike;
    adapterFactory: (input: {
        source: BusinessSystemKnowledgeSource;
        question: string;
        recentContext: string;
    }) => ModelToolCallingAdapter;
    logger?: TraceLoggerLike;
    traceIdFactory?: () => string;
    now?: () => number;
    totalTimeoutMs?: number;
    maxTurns?: number;
}

export interface McpAgentRunInput {
    source: BusinessSystemKnowledgeSource;
    credentials?: BusinessSystemCredentialInput;
    credentialRevision: number;
    question: string;
    recentContext?: string;
    abortSignal?: AbortSignal;
}

export type McpAgentRunResult =
    | { status: 'ok'; answer: string; traceId: string; toolCalls: number }
    | { status: 'error'; errorCode: McpToolCallingErrorCode; traceId: string; toolCalls: number };

const INITIALIZE_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUT_MS = 30_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TURNS = 8;

function stableErrorCode(error: unknown): McpToolCallingErrorCode {
    if (error instanceof McpToolCallingError) return error.code;
    const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof candidate?.code === 'string' && candidate.code.startsWith('mcp_')) {
        return candidate.code as McpToolCallingErrorCode;
    }
    const message = `${String(candidate?.name || '')} ${String(candidate?.message || '')}`;
    if (/unauthorized|forbidden|\b401\b|\b403\b/i.test(message)) return 'mcp_auth_failed';
    if (/timeout|timed out|aborted|aborterror|deadline/i.test(message)) return 'mcp_timeout';
    if (/protocol|json-rpc|repeated tools\/list cursor|invalid mcp/i.test(message)) return 'mcp_protocol_error';
    return 'mcp_unavailable';
}

function argumentShape(value: Record<string, unknown>): Record<string, unknown> {
    const shape: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string') shape[key] = { type: 'string', length: child.length };
        else if (Array.isArray(child)) shape[key] = { type: 'array', length: child.length };
        else if (child && typeof child === 'object') shape[key] = { type: 'object', fields: Object.keys(child).length };
        else shape[key] = { type: child === null ? 'null' : typeof child };
    }
    return shape;
}

function resultShape(result: CallToolResult): Record<string, unknown> {
    let bytes: number;
    try {
        bytes = Buffer.byteLength(JSON.stringify(result.content), 'utf8');
    } catch (error) {
        throw new McpToolCallingError('mcp_tool_result_unsupported', 'MCP tool result cannot be serialized', { cause: error });
    }
    return {
        contentTypes: result.content.map((item) => item.type),
        contentBlocks: result.content.length,
        bytes,
        isError: result.isError === true,
    };
}

function requireCallToolResult(value: unknown): CallToolResult {
    if (!value || typeof value !== 'object' || !Array.isArray((value as any).content)) {
        throw new McpToolCallingError('mcp_tool_result_unsupported', 'MCP server returned an unsupported tool result');
    }
    const result = value as CallToolResult;
    resultShape(result);
    return result;
}

function hostname(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return 'invalid';
    }
}

function combinedSignal(timeoutSignal: AbortSignal, callerSignal?: AbortSignal): AbortSignal {
    if (!callerSignal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeoutSignal, callerSignal]);
    const controller = new AbortController();
    const abort = () => controller.abort();
    timeoutSignal.addEventListener('abort', abort, { once: true });
    callerSignal.addEventListener('abort', abort, { once: true });
    return controller.signal;
}

export class McpAgentLoop {
    private readonly clientFactory: NonNullable<McpAgentLoopDeps['clientFactory']>;
    private readonly catalogCache: CatalogCacheLike;
    private readonly adapterFactory: McpAgentLoopDeps['adapterFactory'];
    private readonly logger: TraceLoggerLike;
    private readonly traceIdFactory: () => string;
    private readonly now: () => number;
    private readonly totalTimeoutMs: number;
    private readonly maxTurns: number;

    constructor(deps: McpAgentLoopDeps) {
        this.clientFactory = deps.clientFactory || ((source, credentials) => new McpRpcClient({
            url: source.url,
            authType: source.authType,
            credentials,
        }));
        this.catalogCache = deps.catalogCache || new McpToolCatalogCache();
        this.adapterFactory = deps.adapterFactory;
        this.logger = deps.logger || new McpProcessTraceLogger();
        this.traceIdFactory = deps.traceIdFactory || randomUUID;
        this.now = deps.now || Date.now;
        this.totalTimeoutMs = deps.totalTimeoutMs || DEFAULT_TOTAL_TIMEOUT_MS;
        this.maxTurns = deps.maxTurns || DEFAULT_MAX_TURNS;
    }

    async run(input: McpAgentRunInput): Promise<McpAgentRunResult> {
        const traceId = this.traceIdFactory();
        const startedAt = this.now();
        const timeoutController = new AbortController();
        const timeoutHandle = setTimeout(() => timeoutController.abort(), this.totalTimeoutMs);
        timeoutHandle.unref?.();
        const signal = combinedSignal(timeoutController.signal, input.abortSignal);
        const client = this.clientFactory(input.source, input.credentials);
        const baseLog = {
            traceId,
            sourceId: input.source.id,
            hostname: hostname(input.source.url),
        };
        let toolCalls = 0;
        let stage = 'initialize';
        const remaining = (stageLimit?: number): number => {
            const value = this.totalTimeoutMs - (this.now() - startedAt);
            if (signal.aborted || value <= 0) {
                throw new McpToolCallingError('mcp_timeout', 'MCP agent total timeout reached');
            }
            return Math.max(1, stageLimit ? Math.min(stageLimit, value) : value);
        };

        try {
            client.onToolsChanged(() => this.catalogCache.invalidate(input.source.id));
            const connectStarted = this.now();
            await client.connect(remaining(INITIALIZE_TIMEOUT_MS), signal);
            this.logger.success('mcp_connected', {
                ...baseLog,
                stage,
                durationMs: this.now() - connectStarted,
                status: 'ok',
            });

            stage = 'discovery';
            const discoveryStarted = this.now();
            const tools = await this.catalogCache.getOrLoad({
                sourceId: input.source.id,
                credentialRevision: input.credentialRevision,
                load: () => client.listTools(remaining(DISCOVERY_TIMEOUT_MS), signal),
            });
            this.logger.success('mcp_tools_discovered', {
                ...baseLog,
                stage,
                toolCount: tools.length,
                schemaBytes: Buffer.byteLength(JSON.stringify(tools), 'utf8'),
                durationMs: this.now() - discoveryStarted,
                status: 'ok',
            });

            stage = 'model';
            const adapter = this.adapterFactory({
                source: input.source,
                question: input.question,
                recentContext: input.recentContext || '',
            });
            const messages: McpAgentMessage[] = [
                { role: 'system', text: 'Use the available MCP tools when needed, then answer the user directly.' },
                {
                    role: 'user',
                    text: input.recentContext
                        ? `${input.question}\n\nRecent conversation context:\n${input.recentContext}`
                        : input.question,
                },
            ];

            for (let turn = 1; turn <= this.maxTurns; turn += 1) {
                const decision = await adapter.runTurn({
                    messages,
                    tools,
                    timeoutMs: remaining(),
                    abortSignal: signal,
                });
                if (decision.type === 'answer') {
                    this.logger.success('mcp_agent_completed', {
                        ...baseLog,
                        stage,
                        provider: adapter.provider,
                        model: adapter.model,
                        turn,
                        toolCalls,
                        durationMs: this.now() - startedAt,
                        status: 'ok',
                    });
                    return { status: 'ok', answer: decision.text, traceId, toolCalls };
                }

                messages.push({ role: 'assistant', toolCalls: decision.calls });
                for (let callIndex = 0; callIndex < decision.calls.length; callIndex += 1) {
                    const call = decision.calls[callIndex];
                    toolCalls += 1;
                    stage = 'tool_call';
                    const callStarted = this.now();
                    let result: CallToolResult;
                    try {
                        result = requireCallToolResult(await client.callTool(
                            call.name,
                            call.arguments,
                            remaining(TOOL_TIMEOUT_MS),
                            signal,
                        ));
                        this.logger.success('mcp_tool_call_completed', {
                            ...baseLog,
                            stage,
                            provider: adapter.provider,
                            model: adapter.model,
                            toolName: call.name,
                            argumentShape: argumentShape(call.arguments),
                            resultShape: resultShape(result),
                            turn,
                            callIndex,
                            durationMs: this.now() - callStarted,
                            status: result.isError ? 'tool_error' : 'ok',
                        });
                    } catch (error) {
                        const errorCode = stableErrorCode(error);
                        result = {
                            isError: true,
                            content: [{ type: 'text', text: errorCode }],
                        };
                        this.logger.failure('mcp_tool_call_failed', {
                            ...baseLog,
                            stage,
                            provider: adapter.provider,
                            model: adapter.model,
                            toolName: call.name,
                            errorCode,
                            turn,
                            callIndex,
                            durationMs: this.now() - callStarted,
                            status: 'error',
                        });
                    }
                    messages.push({
                        role: 'tool',
                        callId: call.callId,
                        name: call.name,
                        result,
                    });
                }
                stage = 'model';
            }

            const errorCode = 'mcp_agent_limit_reached' as const;
            this.logger.failure('mcp_agent_failed', {
                ...baseLog,
                stage,
                provider: adapter.provider,
                model: adapter.model,
                errorCode,
                toolCalls,
                status: 'error',
            });
            return { status: 'error', errorCode, traceId, toolCalls };
        } catch (error) {
            const errorCode = stableErrorCode(error);
            this.logger.failure('mcp_agent_failed', {
                ...baseLog,
                stage,
                errorCode,
                toolCalls,
                durationMs: this.now() - startedAt,
                status: 'error',
            });
            return { status: 'error', errorCode, traceId, toolCalls };
        } finally {
            clearTimeout(timeoutHandle);
            await client.close().catch((): undefined => undefined);
        }
    }
}
