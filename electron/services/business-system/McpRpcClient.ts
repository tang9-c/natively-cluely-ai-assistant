import type {
    BusinessSystemAuthType,
    BusinessSystemCredentialInput,
} from './BusinessSystemTypes';

export interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
    };
}

export interface McpRpcClientConfig {
    url: string;
    authType: BusinessSystemAuthType;
    credentials?: BusinessSystemCredentialInput;
    fetchImpl?: typeof fetch;
    clientInfo?: { name: string; version: string };
}

interface JsonRpcEnvelope {
    jsonrpc?: string;
    id?: number;
    result?: any;
    error?: { code?: number | string; message?: string };
}

function buildHeaders(authType: BusinessSystemAuthType, credentials?: BusinessSystemCredentialInput): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
    };
    if (authType === 'api_key' && credentials?.apiKey) {
        headers.Authorization = `Bearer ${credentials.apiKey}`;
    }
    if (authType === 'username_password' && credentials?.username && credentials?.password) {
        const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
        headers.Authorization = `Basic ${token}`;
    }
    return headers;
}

export function parseMcpHttpResponseText(text: string): unknown {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('data:') || trimmed.startsWith('event:') || trimmed.includes('\ndata:')) {
        const payloads: string[] = [];
        for (const line of trimmed.split(/\r?\n/)) {
            if (line.startsWith('data:')) payloads.push(line.slice(5).trim());
        }
        const lastPayload = payloads.filter(Boolean).at(-1);
        return lastPayload ? JSON.parse(lastPayload) : null;
    }
    return JSON.parse(trimmed);
}

export class McpRpcClient {
    private url: string;
    private authType: BusinessSystemAuthType;
    private credentials?: BusinessSystemCredentialInput;
    private fetchImpl: typeof fetch;
    private nextId = 1;
    private clientInfo: { name: string; version: string };

    constructor(config: McpRpcClientConfig) {
        this.url = config.url;
        this.authType = config.authType;
        this.credentials = config.credentials;
        const fetchImpl = config.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
        if (!fetchImpl) {
            throw new Error('MCP fetch implementation unavailable');
        }
        this.fetchImpl = fetchImpl;
        this.clientInfo = config.clientInfo || { name: 'natively-mcp-rpc', version: '1.0.0' };
    }

    async initialize(timeoutMs = 2000): Promise<unknown> {
        const envelope = await this.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: this.clientInfo,
        }, timeoutMs);
        return envelope.result;
    }

    async listTools(timeoutMs = 2000): Promise<McpToolDefinition[]> {
        const envelope = await this.request('tools/list', {}, timeoutMs);
        return Array.isArray(envelope.result?.tools) ? envelope.result.tools : [];
    }

    async callTool(name: string, args: Record<string, unknown>, timeoutMs = 2000): Promise<any> {
        const envelope = await this.request('tools/call', {
            name,
            arguments: args,
        }, timeoutMs);
        return envelope.result;
    }

    private async request(method: string, params: unknown, timeoutMs: number): Promise<JsonRpcEnvelope> {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), Math.max(50, timeoutMs));
        const id = this.nextId++;
        try {
            const res = await this.fetchImpl(this.url, {
                method: 'POST',
                headers: buildHeaders(this.authType, this.credentials),
                body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }),
                signal: controller.signal,
            });
            const text = await res.text().catch(() => '');
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
            }
            const parsed = parseMcpHttpResponseText(text) as JsonRpcEnvelope | null;
            if (!parsed || typeof parsed !== 'object') {
                throw new Error(`Invalid MCP response for ${method}`);
            }
            if (parsed.error) {
                throw new Error(parsed.error.message || `MCP error ${parsed.error.code || 'unknown'}`);
            }
            return parsed;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }
}
