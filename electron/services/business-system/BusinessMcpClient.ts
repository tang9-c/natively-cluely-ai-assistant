import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
    BusinessSystemCredentialInput,
    BusinessSystemKnowledgeSource,
    BusinessSystemQueryResult,
    BusinessSystemSourceKind,
} from './BusinessSystemTypes';

export const BUSINESS_CONTEXT_TOOL_NAME = 'business_context.query';
const MAX_SOURCE_NAME_CHARS = 80;
const MAX_SUMMARY_CHARS = 1200;
const MAX_RECORDS = 5;
const MAX_FIELDS_PER_RECORD = 16;
const MAX_RECORD_TITLE_CHARS = 120;
const MAX_FIELD_NAME_CHARS = 80;
const MAX_FIELD_VALUE_CHARS = 300;

export interface BusinessMcpQueryInput {
    query: string;
    sourceHint?: BusinessSystemSourceKind;
    recentContext?: string;
}

function parseTextContent(result: any): unknown {
    const firstText = Array.isArray(result?.content)
        ? result.content.find((item: any) => item?.type === 'text' && typeof item.text === 'string')
        : null;
    if (!firstText) return null;
    try {
        return JSON.parse(firstText.text);
    } catch {
        return null;
    }
}

function validStatus(status: unknown): status is BusinessSystemQueryResult['status'] {
    return [
        'ok',
        'no_result',
        'ambiguous',
        'auth_failed',
        'unavailable',
        'timeout',
        'error',
    ].includes(status as string);
}

function cleanText(value: unknown, maxChars: number): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
    if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
    const text = String(value).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return undefined;
    return text.slice(0, maxChars);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function normalizeFields(value: unknown): { fields: NonNullable<BusinessSystemQueryResult['evidence']>['records'][number]['fields']; omitted: number } {
    const rawFields = Array.isArray(value)
        ? value
        : isPlainObject(value)
            ? Object.entries(value).map(([name, fieldValue]) => ({ name, value: fieldValue }))
            : [];
    const fields: NonNullable<BusinessSystemQueryResult['evidence']>['records'][number]['fields'] = [];
    let omitted = 0;
    for (const raw of rawFields) {
        const name = isPlainObject(raw) ? cleanText(raw.name, MAX_FIELD_NAME_CHARS) : undefined;
        const fieldValue = isPlainObject(raw) ? cleanText(raw.value, MAX_FIELD_VALUE_CHARS) : undefined;
        if (!name || fieldValue === undefined) {
            omitted += 1;
            continue;
        }
        if (fields.length >= MAX_FIELDS_PER_RECORD) {
            omitted += 1;
            continue;
        }
        fields.push({ name, value: fieldValue });
    }
    return { fields, omitted };
}

function normalizeEvidence(value: unknown, sourceName: string): BusinessSystemQueryResult['evidence'] | undefined {
    if (!isPlainObject(value)) return undefined;
    const recordsInput = Array.isArray(value.records) ? value.records : [];
    const records: NonNullable<BusinessSystemQueryResult['evidence']>['records'] = [];
    let omittedFieldCount = 0;
    for (const rawRecord of recordsInput) {
        if (!isPlainObject(rawRecord)) continue;
        if (records.length >= MAX_RECORDS) {
            omittedFieldCount += 1;
            continue;
        }
        const { fields, omitted } = normalizeFields(rawRecord.fields);
        omittedFieldCount += omitted;
        if (fields.length === 0) continue;
        records.push({
            title: cleanText(rawRecord.title, MAX_RECORD_TITLE_CHARS),
            fields,
        });
    }
    if (records.length === 0) return undefined;
    return {
        source: cleanText(value.source, 80) || sourceName,
        sourceTool: cleanText(value.sourceTool, 80),
        recordCount: typeof value.recordCount === 'number' && Number.isFinite(value.recordCount)
            ? Math.max(records.length, Math.floor(value.recordCount))
            : records.length,
        records,
        ...(omittedFieldCount > 0 ? { omittedFieldCount } : {}),
    };
}

function normalizeItemsAsEvidence(items: unknown, sourceName: string): BusinessSystemQueryResult['evidence'] | undefined {
    if (!Array.isArray(items)) return undefined;
    const records: NonNullable<BusinessSystemQueryResult['evidence']>['records'] = [];
    let omittedFieldCount = 0;
    for (const item of items) {
        if (!isPlainObject(item)) continue;
        if (records.length >= MAX_RECORDS) {
            omittedFieldCount += 1;
            continue;
        }
        const fieldsInput: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item)) {
            if (key === 'title' || key === 'name') continue;
            fieldsInput[key] = value;
        }
        const { fields, omitted } = normalizeFields(fieldsInput);
        omittedFieldCount += omitted;
        if (fields.length === 0) continue;
        records.push({
            title: cleanText(item.title ?? item.name, MAX_RECORD_TITLE_CHARS),
            fields,
        });
    }
    if (records.length === 0) return undefined;
    return {
        source: sourceName,
        recordCount: records.length,
        records,
        ...(omittedFieldCount > 0 ? { omittedFieldCount } : {}),
    };
}

export function normalizeBusinessMcpToolResult(result: any, fallbackSourceName: string): BusinessSystemQueryResult {
    if (result?.isError) {
        return { status: 'error', sourceName: fallbackSourceName, errorCode: 'tool_error' };
    }
    const parsed = parseTextContent(result);
    if (!parsed || typeof parsed !== 'object') {
        return { status: 'error', sourceName: fallbackSourceName, errorCode: 'invalid_tool_result' };
    }
    const record = parsed as Record<string, unknown>;
    const status = validStatus(record.status) ? record.status : 'error';
    const sourceName = typeof record.sourceName === 'string' && record.sourceName.trim()
        ? cleanText(record.sourceName, MAX_SOURCE_NAME_CHARS) || fallbackSourceName
        : fallbackSourceName;
    const summary = cleanText(record.summary, MAX_SUMMARY_CHARS);
    const items = Array.isArray(record.items) ? record.items : undefined;
    const errorCode = typeof record.errorCode === 'string' ? record.errorCode : undefined;
    const evidence = normalizeEvidence(record.evidence, sourceName)
        || normalizeItemsAsEvidence(items, sourceName);
    return { status, sourceName, summary, evidence, items, errorCode };
}

function buildHeaders(source: BusinessSystemKnowledgeSource, credentials?: BusinessSystemCredentialInput): Record<string, string> {
    if (!credentials) return {};
    if (source.authType === 'api_key' && credentials.apiKey) {
        return { Authorization: `Bearer ${credentials.apiKey}` };
    }
    if (source.authType === 'username_password' && credentials.username && credentials.password) {
        const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
        return { Authorization: `Basic ${token}` };
    }
    return {};
}

export class BusinessMcpClient {
    async query(
        source: BusinessSystemKnowledgeSource,
        credentials: BusinessSystemCredentialInput | undefined,
        input: BusinessMcpQueryInput,
        timeoutMs = 2000,
    ): Promise<BusinessSystemQueryResult> {
        const client = new Client({ name: 'natively-business-context', version: '1.0.0' });

        try {
            const transport = new StreamableHTTPClientTransport(new URL(source.url), {
                requestInit: { headers: buildHeaders(source, credentials) },
            } as any);
            await client.connect(transport, { timeout: timeoutMs } as any);
            const result = await client.callTool(
                {
                    name: BUSINESS_CONTEXT_TOOL_NAME,
                    arguments: {
                        query: input.query,
                        sourceHint: input.sourceHint,
                        recentContext: input.recentContext,
                    },
                },
                { timeout: timeoutMs } as any,
            );
            return normalizeBusinessMcpToolResult(result, source.name);
        } catch (error: any) {
            const message = String(error?.message || '');
            if (/timeout|aborted|deadline/i.test(message)) {
                return { status: 'timeout', sourceName: source.name, errorCode: 'timeout' };
            }
            if (/unauthorized|forbidden|401|403/i.test(message)) {
                return { status: 'auth_failed', sourceName: source.name, errorCode: 'auth_failed' };
            }
            return { status: 'unavailable', sourceName: source.name, errorCode: 'mcp_unavailable' };
        } finally {
            await client.close().catch((): undefined => undefined);
        }
    }
}
