export interface UploadedMaterialContextHit {
    title?: string;
    text?: string;
    parentText?: string;
}

export interface UploadedMaterialContextFormatOptions {
    maxTotalChars?: number;
    maxPerHitChars?: number;
}

export interface UploadedMaterialContextFormatResult {
    text: string;
    truncated: boolean;
}

const DEFAULT_MAX_TOTAL_CHARS = 4200;
const DEFAULT_MAX_PER_HIT_CHARS = 900;
const TRUNCATED_MARKER = '\n[...uploaded material excerpt truncated]';

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
    if (text.length <= maxChars) return { text, truncated: false };
    if (maxChars <= TRUNCATED_MARKER.length) {
        return { text: text.slice(0, Math.max(0, maxChars)), truncated: true };
    }
    return {
        text: `${text.slice(0, maxChars - TRUNCATED_MARKER.length).trimEnd()}${TRUNCATED_MARKER}`,
        truncated: true,
    };
}

function buildHitBody(hit: UploadedMaterialContextHit, maxChars: number): { text: string; truncated: boolean } {
    const title = normalizeText(hit.title) || 'Uploaded material';
    const exactText = normalizeText(hit.text);
    const parentText = normalizeText(hit.parentText);
    const contextSupplement = parentText && parentText !== exactText
        ? parentText.replace(exactText, '').trim()
        : '';
    const bodyParts = exactText ? [`Exact match: ${exactText}`] : [];
    if (contextSupplement) {
        bodyParts.push(`Nearby context: ${contextSupplement}`);
    }
    const body = bodyParts.length > 0 ? bodyParts.join('\n') : parentText;
    return truncateText(`${title}\n${body}`, maxChars);
}

function hasMaterialText(hit: UploadedMaterialContextHit): boolean {
    return Boolean(normalizeText(hit.text) || normalizeText(hit.parentText) || normalizeText(hit.title));
}

export function formatUploadedMaterialContext(
    hits: UploadedMaterialContextHit[],
    options: UploadedMaterialContextFormatOptions = {},
): UploadedMaterialContextFormatResult {
    const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
    const maxPerHitChars = options.maxPerHitChars ?? DEFAULT_MAX_PER_HIT_CHARS;
    const header = '<uploaded_material_context>\nUse these uploaded materials only when relevant. Citeable source ids are tracked outside the prompt; do not invent unseen sources.\n';
    const footer = '\n</uploaded_material_context>';
    const bodyBudget = Math.max(0, maxTotalChars - header.length - footer.length);
    const bodyParts: string[] = [];
    let used = 0;
    let truncated = false;

    hits.forEach((hit, index) => {
        if (used >= bodyBudget) {
            if (hasMaterialText(hit)) truncated = true;
            return;
        }
        const prefix = `${bodyParts.length > 0 ? '\n\n' : ''}[${index + 1}] `;
        const remaining = bodyBudget - used - prefix.length;
        if (remaining <= 0) {
            if (hasMaterialText(hit)) truncated = true;
            return;
        }
        const body = buildHitBody(hit, Math.min(maxPerHitChars, remaining));
        if (!body.text) return;
        if (body.truncated) truncated = true;
        bodyParts.push(`${prefix}${body.text}`);
        used += prefix.length + body.text.length;
    });

    return {
        text: `${header}${bodyParts.join('')}${footer}`,
        truncated,
    };
}
