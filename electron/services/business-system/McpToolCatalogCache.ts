import type { Tool } from '@modelcontextprotocol/sdk/types.js';

interface McpToolCatalogCacheConfig {
    ttlMs?: number;
    now?: () => number;
}

interface CatalogEntry {
    sourceId: string;
    expiresAt: number;
    tools: Tool[];
}

interface CatalogLoadInput {
    sourceId: string;
    credentialRevision: number;
    load: () => Promise<Tool[]>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class McpToolCatalogCache {
    private readonly ttlMs: number;
    private readonly now: () => number;
    private readonly entries = new Map<string, CatalogEntry>();
    private readonly pendingLoads = new Map<string, Promise<Tool[]>>();
    private readonly sourceGenerations = new Map<string, number>();

    constructor(config: McpToolCatalogCacheConfig = {}) {
        this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
        this.now = config.now ?? Date.now;
    }

    async getOrLoad(input: CatalogLoadInput): Promise<Tool[]> {
        const key = this.key(input.sourceId, input.credentialRevision);
        const cached = this.entries.get(key);
        if (cached && cached.expiresAt > this.now()) return cached.tools;
        if (cached) this.entries.delete(key);

        const pending = this.pendingLoads.get(key);
        if (pending) return pending;

        const generation = this.sourceGenerations.get(input.sourceId) || 0;
        const loadPromise = input.load().then((tools) => {
            if ((this.sourceGenerations.get(input.sourceId) || 0) === generation) {
                this.entries.set(key, {
                    sourceId: input.sourceId,
                    expiresAt: this.now() + this.ttlMs,
                    tools,
                });
            }
            return tools;
        }).finally(() => {
            if (this.pendingLoads.get(key) === loadPromise) this.pendingLoads.delete(key);
        });
        this.pendingLoads.set(key, loadPromise);
        return loadPromise;
    }

    invalidate(sourceId: string): void {
        this.sourceGenerations.set(sourceId, (this.sourceGenerations.get(sourceId) || 0) + 1);
        for (const [key, entry] of this.entries) {
            if (entry.sourceId === sourceId) this.entries.delete(key);
        }
        for (const key of this.pendingLoads.keys()) {
            if (key.startsWith(`${JSON.stringify(sourceId)}:`)) this.pendingLoads.delete(key);
        }
    }

    private key(sourceId: string, credentialRevision: number): string {
        return `${JSON.stringify(sourceId)}:${credentialRevision}`;
    }
}
