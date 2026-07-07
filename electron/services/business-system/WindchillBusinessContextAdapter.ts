import type {
    BusinessSystemCredentialInput,
    BusinessSystemQueryResult,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';

export interface WindchillBusinessContextAdapterConfig {
    sourceName?: string;
    fetchImpl?: typeof fetch;
}

export interface WindchillBusinessContextQueryInput {
    query: string;
    sourceHint?: BusinessSystemSourceKind;
    recentContext?: string;
    sourceUrl?: string;
}

export interface WindchillBusinessContextAdapter {
    query(
        input: WindchillBusinessContextQueryInput,
        credentials: BusinessSystemCredentialInput | undefined,
        timeoutMs: number,
    ): Promise<BusinessSystemQueryResult>;
}

export function createWindchillBusinessContextAdapter(
    config: WindchillBusinessContextAdapterConfig = {},
): WindchillBusinessContextAdapter {
    const sourceName = config.sourceName || 'Windchill PLM';
    const fetchImpl = config.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);

    return {
        async query(input, credentials, timeoutMs) {
            if (input.sourceHint !== 'plm') {
                return { status: 'no_result', sourceName };
            }
            const url = input.sourceUrl;
            if (!url) {
                return { status: 'not_configured', sourceName, errorCode: 'no_url' };
            }
            const apiKey = credentials?.apiKey;
            if (!apiKey) {
                return { status: 'auth_failed', sourceName, errorCode: 'no_api_key' };
            }
            if (!fetchImpl) {
                return { status: 'unavailable', sourceName, errorCode: 'no_fetch_implementation' };
            }

            const number = extractPartNumberFromQuery(input.query);
            const searchArgs: Record<string, unknown> = number
                ? { number, limit: 5 }
                : { limit: 10 };

            const controller = new AbortController();
            const timeoutHandle = setTimeout(() => controller.abort(), Math.max(50, timeoutMs));
            try {
                const init = await rpcFetch(fetchImpl, url, apiKey, 'initialize', {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'natively-windchill', version: '1.0.0' },
                }, 1, controller.signal);
                if (init.error || !init.result) {
                    return mapInitFailure(init, sourceName);
                }
                const search = await rpcFetch(fetchImpl, url, apiKey, 'tools/call', {
                    name: 'part_search',
                    arguments: searchArgs,
                }, 2, controller.signal);
                if (search.error) {
                    return { status: mapWindchillErrorToStatus(search.error), sourceName, errorCode: 'rpc_error' };
                }
                const textPayload = search.result?.content?.find?.((c: { type?: string; text?: string }) => c?.type === 'text')?.text;
                if (!textPayload) {
                    return { status: 'error', sourceName, errorCode: 'invalid_tool_result' };
                }
                let parsed: unknown;
                try {
                    parsed = JSON.parse(textPayload);
                } catch {
                    return { status: 'error', sourceName, errorCode: 'invalid_tool_result' };
                }
                return wrapWindchillPartResults(parsed as { value?: unknown[] }, sourceName);
            } catch (error) {
                const status = mapWindchillErrorToStatus(error);
                return { status, sourceName, errorCode: `windchill_${status}` };
            } finally {
                clearTimeout(timeoutHandle);
            }
        },
    };
}

function mapInitFailure(init: { error?: unknown }, sourceName: string): BusinessSystemQueryResult {
    const err = init.error as { message?: string; code?: number } | undefined;
    const message = String(err?.message || '');
    if (err && (err.code === 401 || err.code === 403 || /unauthorized|forbidden/i.test(message))) {
        return { status: 'auth_failed', sourceName, errorCode: 'initialize_unauthorized' };
    }
    return { status: mapWindchillErrorToStatus(init.error), sourceName, errorCode: 'initialize_failed' };
}

async function rpcFetch(
    fetchImpl: typeof fetch,
    url: string,
    apiKey: string,
    method: string,
    params: unknown,
    id: number,
    signal: AbortSignal,
): Promise<{ result?: any; error?: any }> {
    const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }),
        signal,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const error = { code: res.status, message: text || `HTTP ${res.status}` };
        return { error };
    }
    return res.json() as Promise<{ result?: any; error?: any }>;
}

/**
 * 从自然语言 query 中抽取 Windchill part number。
 * 识别形态:字母+数字混合、纯数字 ≥3 位、带 * 的通配符、连字符型如 BOLT-001。
 * 找不到时返回 null,意味着需要走"无锚点"或 list-all 路径。
 */
export function extractPartNumberFromQuery(query: string): string | null {
    if (!query) return null;
    const tokens = query.split(/\s+/);
    for (const token of tokens) {
        if (/^[A-Za-z]+\d|^[A-Za-z0-9]+-[A-Za-z0-9]+|^\d{3,}$|^[A-Za-z0-9]*\*[A-Za-z0-9]*$/.test(token)) {
            return token;
        }
    }
    return null;
}

interface WindchillPartRecord {
    ID?: string;
    Name?: string;
    Number?: string;
    State?: { Display?: string } | string;
}

interface WindchillODataResponse {
    value?: WindchillPartRecord[];
}

/**
 * 把 Windchill part_search 返回的 OData `value[]` 转成 BusinessSystemQueryResult。
 * 计数语义:0 → no_result, 1 → ok, ≥2 → ambiguous(项目规定的固定回复链会兜底询问用户)。
 */
export function wrapWindchillPartResults(
    odata: WindchillODataResponse | null | undefined,
    sourceName: string,
): BusinessSystemQueryResult {
    const parts = Array.isArray(odata?.value) ? odata!.value : [];
    if (parts.length === 0) {
        return { status: 'no_result', sourceName };
    }
    const items = parts.map((p) => ({
        id: p.ID || '',
        name: p.Name || '',
        number: p.Number || '',
        state: typeof p.State === 'string' ? p.State : p.State?.Display || '',
    }));

    if (parts.length === 1) {
        const head = items[0];
        return {
            status: 'ok',
            sourceName,
            summary: `物料 ${head.number}${head.name ? ` (${head.name})` : ''}${head.state ? ` 当前 ${head.state}` : ''}。`,
            items,
        };
    }

    return {
        status: 'ambiguous',
        sourceName,
        summary: `查到 ${parts.length} 个候选物料,请指定编号。`,
        items,
    };
}

/**
 * 把异常/错误对象映射到 BusinessSystemQueryResult.status(限定在网络层可能产出的状态)。
 * 优先级:auth → timeout → 其他不可用。这与现有 BusinessMcpClient 的 catch 块语义对齐。
 */
export function mapWindchillErrorToStatus(error: unknown): BusinessSystemQueryResult['status'] {
    const err = error as { code?: string; name?: string; message?: string; statusCode?: number };
    const message = String(err?.message || '');
    const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 0;

    if (
        statusCode === 401 || statusCode === 403 ||
        /\b401\b|\b403\b|unauthorized|forbidden/i.test(message)
    ) {
        return 'auth_failed';
    }
    if (
        err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || err?.code === 'ABORT_ERR' ||
        /timeout|timed out|aborted|deadline/i.test(message)
    ) {
        return 'timeout';
    }
    return 'unavailable';
}
