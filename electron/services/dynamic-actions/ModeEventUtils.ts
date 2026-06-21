export function detectLanguage(text: string): string {
    const cjkCount = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    const latinWords = text.match(/[A-Za-z][A-Za-z0-9+#.-]*/g)?.length ?? 0;
    if (cjkCount > 0 && latinWords >= 2) return 'mixed';
    if (cjkCount > 0) return 'zh';
    if (latinWords > 0) return 'en';
    return 'unknown';
}

export function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function uniquePush(values: string[], value: string): void {
    const normalized = value.trim();
    if (!normalized) return;
    if (!values.includes(normalized)) values.push(normalized);
}

const DOMAIN_ENTITY_TERMS = [
    '价格', '报价', '预算', '成本', '费用', '合同', '法务', '审批', '老板', 'ROI', '竞品',
    '行动项', '负责人', '截止', '风险', '阻塞', '依赖', 'STAR', 'offer', '薪资',
    '算法', '复杂度', '系统设计', 'debug', 'API', '数据库', '公式', '定理', '作业',
];

export function extractKeyEntities(text: string): string[] {
    const entities: string[] = [];
    const moneyLike = text.match(/[$￥€£]?\s?\d+(?:[,.]\d+)*(?:\s?(?:k|K|m|M|万|亿|%|percent|天|周|个月|年))?/g) ?? [];
    for (const match of moneyLike) uniquePush(entities, match);

    const technicalTokens = text.match(/\b[A-Z][A-Za-z0-9+#.-]{1,}\b/g) ?? [];
    for (const token of technicalTokens.slice(0, 8)) uniquePush(entities, token);

    const deadlineTerms = text.match(/(?:周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|下周|月底|季度末|Friday|Monday|Tuesday|Wednesday|Thursday|EOD|tomorrow)/gi) ?? [];
    for (const term of deadlineTerms) uniquePush(entities, term);

    for (const term of DOMAIN_ENTITY_TERMS) {
        if (text.toLowerCase().includes(term.toLowerCase())) uniquePush(entities, term);
    }

    return entities.slice(0, 12);
}

export function buildRetrievalQuery(params: {
    modeTemplateType?: string;
    intent: string;
    keyEntities?: string[];
    latestTurn: string;
    emotion?: string;
    language: string;
}): string {
    const parts = [
        params.modeTemplateType ? `mode:${params.modeTemplateType}` : '',
        `intent:${params.intent}`,
        params.keyEntities && params.keyEntities.length > 0 ? `entities:${params.keyEntities.join(', ')}` : '',
        params.emotion ? `emotion:${params.emotion}` : '',
        `language:${params.language}`,
        `latestTurn:${params.latestTurn}`,
    ].filter(Boolean);
    return parts.join('\n');
}

export function buildAutoSurfaceFingerprint(params: {
    modeTemplateType?: string;
    intent: string;
    latestTurn: string;
}): string {
    return [
        params.modeTemplateType || 'unknown',
        params.intent,
        params.latestTurn.toLowerCase().replace(/\s+/g, ' ').trim(),
    ].join('|');
}
