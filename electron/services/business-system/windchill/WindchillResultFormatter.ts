import type { BusinessSystemEvidence, BusinessSystemQueryResult } from '../BusinessSystemTypes';
import type { WindchillIntent } from './WindchillQueryPlanner';

function stateText(value: any): string {
    return typeof value === 'string' ? value : value?.Display || value?.display || '';
}

function arrayValue(payload: any): any[] {
    if (Array.isArray(payload?.value)) return payload.value;
    if (Array.isArray(payload?.Components)) return payload.Components;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload)) return payload;
    return [];
}

function compactScalar(value: any): string | null {
    if (value == null) return null;
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    const display = stateText(value);
    return display.trim() || null;
}

const PRIMARY_FIELD_ORDER = [
    'Number',
    'Name',
    'Title',
    'State',
    'ID',
    'Version',
    'Revision',
    'Type',
    'CreatedOn',
    'LastModified',
    'Description',
];

function fieldValue(record: Record<string, any>, key: string): string | null {
    return compactScalar(record[key] ?? record[key[0].toLowerCase() + key.slice(1)]);
}

function shouldSkipField(key: string): boolean {
    return key.startsWith('@odata.') || key.startsWith('@') || /^(Actions|Links)$/i.test(key);
}

function extractEvidenceRecord(row: any): { title?: string; fields: { name: string; value: string }[]; omitted: number } {
    if (!row || typeof row !== 'object') return { fields: [], omitted: 0 };
    const record = row as Record<string, any>;
    const used = new Set<string>();
    const fields: { name: string; value: string }[] = [];

    for (const key of PRIMARY_FIELD_ORDER) {
        const value = fieldValue(record, key);
        if (!value) continue;
        fields.push({ name: key, value });
        used.add(key);
        used.add(key[0].toLowerCase() + key.slice(1));
    }

    for (const key of Object.keys(record)) {
        if (fields.length >= 16) break;
        if (used.has(key) || shouldSkipField(key)) continue;
        const value = compactScalar(record[key]);
        if (!value) continue;
        fields.push({ name: key, value });
        used.add(key);
    }

    const number = fieldValue(record, 'Number');
    const name = fieldValue(record, 'Name') || fieldValue(record, 'Title');
    const id = fieldValue(record, 'ID');
    const title = [number, name].filter(Boolean).join(' / ') || id || undefined;
    const displayableFieldCount = Object.keys(record).filter((key) => !shouldSkipField(key) && compactScalar(record[key])).length;
    return { title, fields, omitted: Math.max(0, displayableFieldCount - fields.length) };
}

function buildEvidence(sourceTool: string, rows: any[]): BusinessSystemEvidence {
    let omittedFieldCount = 0;
    const records = rows.slice(0, 5).map((row) => {
        const record = extractEvidenceRecord(row);
        omittedFieldCount += record.omitted;
        return { title: record.title, fields: record.fields };
    }).filter((record) => record.fields.length > 0);

    return {
        source: 'windchill',
        sourceTool,
        recordCount: rows.length,
        records,
        omittedFieldCount: omittedFieldCount || undefined,
    };
}

export function extractTextJson(result: any): unknown {
    const text = Array.isArray(result?.content)
        ? result.content.find((item: any) => item?.type === 'text' && typeof item.text === 'string')?.text
        : undefined;
    if (!text) return result;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export function firstODataRecord(payload: unknown): Record<string, any> | null {
    const value = arrayValue(payload);
    return value.length === 1 && typeof value[0] === 'object' ? value[0] : null;
}

export function getRecordId(record: Record<string, any> | null): string | null {
    return record?.ID || record?.id || record?.Oid || record?.oid || null;
}

function formatPartSearch(results: Record<string, unknown>, sourceName: string): BusinessSystemQueryResult {
    const parts = arrayValue(results.partSearch);
    if (parts.length === 0) return { status: 'no_result', sourceName };
    if (parts.length > 1) {
        return { status: 'ambiguous', sourceName, summary: `查到 ${parts.length} 个候选物料，请指定编号。`, evidence: buildEvidence('part_search', parts) };
    }
    return {
        status: 'ok',
        sourceName,
        evidence: buildEvidence('part_search', parts),
    };
}

function formatPartStructure(results: Record<string, unknown>, sourceName: string): BusinessSystemQueryResult {
    const part = firstODataRecord(results.partSearch);
    const components = arrayValue(results.partStructure);
    if (!part) return { status: 'ambiguous', sourceName, summary: 'Windchill 返回了多个候选物料，需要你指定是哪一个。' };
    return {
        status: 'ok',
        sourceName,
        evidence: buildEvidence('part_get_structure', components),
    };
}

function formatGenericSearch(intent: WindchillIntent, results: Record<string, unknown>, sourceName: string): BusinessSystemQueryResult {
    const key = Object.keys(results).at(-1) || '';
    const rows = arrayValue((results as any)[key]);
    if (rows.length === 0) return { status: 'no_result', sourceName };
    const evidence = buildEvidence(String(intent), rows);
    if (rows.length > 1) {
        return { status: 'ambiguous', sourceName, summary: `查到 ${rows.length} 个候选结果，需要你指定是哪一个。`, evidence };
    }
    return {
        status: 'ok',
        sourceName,
        evidence,
    };
}

export function formatWindchillResult(
    intent: WindchillIntent,
    results: Record<string, unknown>,
    sourceName: string,
): BusinessSystemQueryResult {
    if (intent === 'part_search') return formatPartSearch(results, sourceName);
    if (intent === 'part_structure') return formatPartStructure(results, sourceName);
    return formatGenericSearch(intent, results, sourceName);
}
