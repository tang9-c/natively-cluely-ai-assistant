export interface UploadedMaterialContextHit {
    title?: string;
    text?: string;
    parentText?: string;
}

export interface UploadedMaterialContextFormatOptions {
    maxTotalChars?: number;
    maxPerHitChars?: number;
}

const DEFAULT_MAX_TOTAL_CHARS = 4200;
const DEFAULT_MAX_PER_HIT_CHARS = 900;
const TRUNCATED_MARKER = '\n[...uploaded material excerpt truncated]';

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    if (maxChars <= TRUNCATED_MARKER.length) return text.slice(0, Math.max(0, maxChars));
    return `${text.slice(0, maxChars - TRUNCATED_MARKER.length).trimEnd()}${TRUNCATED_MARKER}`;
}

function buildHitBody(hit: UploadedMaterialContextHit, maxChars: number): string {
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

export function formatUploadedMaterialContext(
    hits: UploadedMaterialContextHit[],
    options: UploadedMaterialContextFormatOptions = {},
): string {
    const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
    const maxPerHitChars = options.maxPerHitChars ?? DEFAULT_MAX_PER_HIT_CHARS;
    const header = '<uploaded_material_context>\nUse these uploaded materials only when relevant. Citeable source ids are tracked outside the prompt; do not invent unseen sources.\n';
    const footer = '\n</uploaded_material_context>';
    const bodyBudget = Math.max(0, maxTotalChars - header.length - footer.length);
    const bodyParts: string[] = [];
    let used = 0;

    hits.forEach((hit, index) => {
        if (used >= bodyBudget) return;
        const prefix = `${bodyParts.length > 0 ? '\n\n' : ''}[${index + 1}] `;
        const remaining = bodyBudget - used - prefix.length;
        if (remaining <= 0) return;
        const body = buildHitBody(hit, Math.min(maxPerHitChars, remaining));
        if (!body) return;
        bodyParts.push(`${prefix}${body}`);
        used += prefix.length + body.length;
    });

    return `${header}${bodyParts.join('')}${footer}`;
}
