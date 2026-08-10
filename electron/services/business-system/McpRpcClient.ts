import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type {
    BusinessSystemAuthType,
    BusinessSystemCredentialInput,
} from './BusinessSystemTypes';

export type McpToolDefinition = Tool;

export interface McpSession {
    connect(timeoutMs: number): Promise<unknown>;
    listTools(cursor: string | undefined, timeoutMs: number): Promise<{
        tools: Tool[];
        nextCursor?: string;
    }>;
    callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
    onToolsChanged(handler: () => void): void;
    close(): Promise<void>;
}

interface McpSessionFactoryConfig {
    url: string;
    headers: Record<string, string>;
    fetchImpl?: typeof fetch;
    clientInfo: { name: string; version: string };
}

export interface McpRpcClientConfig {
    url: string;
    authType: BusinessSystemAuthType;
    credentials?: BusinessSystemCredentialInput;
    fetchImpl?: typeof fetch;
    clientInfo?: { name: string; version: string };
    sessionFactory?: (config: McpSessionFactoryConfig) => McpSession;
}

function buildHeaders(authType: BusinessSystemAuthType, credentials?: BusinessSystemCredentialInput): Record<string, string> {
    if (authType === 'api_key' && credentials?.apiKey) {
        return { Authorization: `Bearer ${credentials.apiKey}` };
    }
    if (authType === 'username_password' && credentials?.username && credentials?.password) {
        const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
        return { Authorization: `Basic ${token}` };
    }
    return {};
}

class SdkMcpSession implements McpSession {
    private readonly client: Client;
    private readonly transport: StreamableHTTPClientTransport;
    private readonly toolsChangedHandlers = new Set<() => void>();

    constructor(config: McpSessionFactoryConfig) {
        this.client = new Client(config.clientInfo);
        this.transport = new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: { headers: config.headers },
            ...(config.fetchImpl ? { fetch: config.fetchImpl as any } : {}),
        });
        this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
            for (const handler of this.toolsChangedHandlers) handler();
        });
    }

    async connect(timeoutMs: number): Promise<unknown> {
        await this.client.connect(this.transport, { timeout: timeoutMs });
        return {
            serverInfo: this.client.getServerVersion(),
            capabilities: this.client.getServerCapabilities(),
            instructions: this.client.getInstructions(),
        };
    }

    async listTools(cursor: string | undefined, timeoutMs: number): Promise<{
        tools: Tool[];
        nextCursor?: string;
    }> {
        const result = await this.client.listTools(cursor ? { cursor } : undefined, { timeout: timeoutMs });
        return {
            tools: result.tools,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
    }

    async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
        return this.client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    }

    onToolsChanged(handler: () => void): void {
        this.toolsChangedHandlers.add(handler);
    }

    async close(): Promise<void> {
        await this.client.close();
    }
}

export class McpRpcClient {
    private readonly session: McpSession;

    constructor(config: McpRpcClientConfig) {
        const clientInfo = config.clientInfo || { name: 'natively-mcp-rpc', version: '1.0.0' };
        const sessionConfig: McpSessionFactoryConfig = {
            url: config.url,
            headers: buildHeaders(config.authType, config.credentials),
            fetchImpl: config.fetchImpl,
            clientInfo,
        };
        this.session = config.sessionFactory
            ? config.sessionFactory(sessionConfig)
            : new SdkMcpSession(sessionConfig);
    }

    async initialize(timeoutMs = 2000): Promise<unknown> {
        return this.session.connect(timeoutMs);
    }

    async listTools(timeoutMs = 2000): Promise<McpToolDefinition[]> {
        const tools: Tool[] = [];
        const seenCursors = new Set<string>();
        let cursor: string | undefined;

        do {
            const page = await this.session.listTools(cursor, timeoutMs);
            tools.push(...page.tools);
            cursor = page.nextCursor;
            if (cursor) {
                if (seenCursors.has(cursor)) {
                    throw new Error(`MCP protocol error: repeated tools/list cursor ${cursor}`);
                }
                seenCursors.add(cursor);
            }
        } while (cursor);

        return tools;
    }

    async callTool(name: string, args: Record<string, unknown>, timeoutMs = 2000): Promise<unknown> {
        return this.session.callTool(name, args, timeoutMs);
    }

    onToolsChanged(handler: () => void): void {
        this.session.onToolsChanged(handler);
    }

    async close(): Promise<void> {
        await this.session.close();
    }
}
