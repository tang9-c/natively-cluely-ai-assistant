export interface WeightedMaterialQueryTerm {
    term: string;
    weight: number;
    source: 'latestTurn' | 'entity' | 'mode' | 'intent' | 'generated';
    reason: 'strong' | 'optional' | 'generic' | 'negated' | 'metadata_hint';
}

export interface MaterialQueryAnalysis {
    rawQuery: string;
    mode?: string;
    intent?: string;
    language?: string;
    latestTurn: string;
    entities: string[];
    strongTerms: string[];
    optionalTerms: string[];
    downrankTerms: string[];
    weightedTerms: WeightedMaterialQueryTerm[];
    hasCjkQuery: boolean;
}

const GENERIC_TERMS = new Set(['资料', '材料', '产品', '功能', '案例', '文档', '内容', '介绍', '说明']);
const LOW_VALUE_ENTITY_TERMS = new Set(['今天', '明天', '昨天', '价格']);
const NEGATION_WINDOW_RE = /(不谈|先不谈|不用谈|不要谈|暂时不谈|不是|不需要|不用|无需)([^。！？,.，；;]{0,12})/g;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TECH_ACRONYM_RE = /\b[A-Z][A-Z0-9-]{1,}\b/;
const TECH_ACRONYM_GLOBAL_RE = /\b[A-Z][A-Z0-9-]{1,}\b/g;
const LATIN_PROPER_RE = /^[A-Z][A-Za-z0-9-]{2,}$/;

function unique(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const term = value.trim();
        if (!term || seen.has(term)) continue;
        seen.add(term);
        result.push(term);
    }
    return result;
}

function parseStructuredQuery(rawQuery: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const line of rawQuery.split(/\r?\n/)) {
        const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
        if (!match) continue;
        fields[match[1]] = match[2].trim();
    }
    return fields;
}

function extractNegatedTerms(text: string): string[] {
    const terms: string[] = [];
    for (const match of text.matchAll(NEGATION_WINDOW_RE)) {
        const tail = match[2] ?? '';
        for (const known of GENERIC_TERMS) {
            if (tail.includes(known)) terms.push(known);
        }
        if (tail.includes('价格')) terms.push('价格');
    }
    return unique(terms);
}

function extractCjkStrongPhrases(text: string): string[] {
    const phrases: string[] = [];
    if (text.includes('产品定价')) phrases.push('产品定价');
    if (text.includes('定价')) phrases.push('定价');
    if (text.includes('价格')) phrases.push('价格');
    const hasKnownForceModule = text.includes('力学仿真模块');
    if (hasKnownForceModule) phrases.push('力学仿真模块');
    const moduleMatch = hasKnownForceModule
        ? null
        : text.match(/(?:搞清楚|介绍一下|了解|关于|针对|这个|那个)?([\p{Script=Han}]{2,8}模块)/u);
    if (moduleMatch) {
        const phrase = moduleMatch[1];
        phrases.push(phrase);
        const withoutModule = phrase.replace(/模块$/, '');
        if (withoutModule && withoutModule !== phrase) phrases.push(withoutModule);
        if (phrase.length > 4) phrases.push(phrase.slice(Math.max(0, phrase.length - 4)));
    }
    if (text.includes('力学仿真')) phrases.push('力学仿真');
    if (hasKnownForceModule) phrases.push('仿真模块');
    if (text.includes('仿真')) phrases.push('仿真');
    return unique(phrases);
}

function extractOptionalTerms(text: string, entities: string[]): string[] {
    const terms: string[] = [];
    for (const term of GENERIC_TERMS) {
        if (text.includes(term) || entities.includes(term)) terms.push(term);
    }
    if (/适合|适配|匹配/.test(text)) terms.push('产品适配', '适合');
    return unique(terms);
}

function strongWeightFor(term: string): number {
    if (TECH_ACRONYM_RE.test(term) || LATIN_PROPER_RE.test(term)) return 2.5;
    return 2;
}

export function analyzeMaterialQuery(query: string): MaterialQueryAnalysis {
    const rawQuery = String(query || '');
    const fields = parseStructuredQuery(rawQuery);
    const latestTurn = fields.latestTurn || rawQuery;
    const entities = unique((fields.entities || '').split(/[,，]/).map((entity) => entity.trim()).filter(Boolean));
    const downrankTerms = extractNegatedTerms(latestTurn);
    const acronymTerms = unique([
        ...(latestTurn.match(TECH_ACRONYM_GLOBAL_RE) ?? []),
        ...entities.filter((entity) => TECH_ACRONYM_RE.test(entity) || LATIN_PROPER_RE.test(entity)),
    ]);
    const cjkStrongTerms = extractCjkStrongPhrases(latestTurn).filter((term) => !downrankTerms.includes(term));
    const strongTerms = unique([
        ...cjkStrongTerms,
        ...acronymTerms,
        ...entities.filter((entity) => !GENERIC_TERMS.has(entity) && !LOW_VALUE_ENTITY_TERMS.has(entity) && !downrankTerms.includes(entity)),
    ]);
    const optionalTerms = extractOptionalTerms(latestTurn, entities).filter((term) => !strongTerms.includes(term));
    const weightedTerms: WeightedMaterialQueryTerm[] = [
        ...strongTerms.map((term) => ({
            term,
            weight: strongWeightFor(term),
            source: entities.includes(term) ? 'entity' as const : 'latestTurn' as const,
            reason: 'strong' as const,
        })),
        ...optionalTerms.map((term) => ({
            term,
            weight: GENERIC_TERMS.has(term) ? 0.45 : 1,
            source: 'latestTurn' as const,
            reason: GENERIC_TERMS.has(term) ? 'generic' as const : 'optional' as const,
        })),
        ...downrankTerms.map((term) => ({
            term,
            weight: 0.2,
            source: 'latestTurn' as const,
            reason: 'negated' as const,
        })),
    ];

    return {
        rawQuery,
        mode: fields.mode,
        intent: fields.intent,
        language: fields.language,
        latestTurn,
        entities,
        strongTerms,
        optionalTerms,
        downrankTerms,
        weightedTerms,
        hasCjkQuery: CJK_RE.test(latestTurn),
    };
}

export function termsForCandidateFiltering(analysis: MaterialQueryAnalysis, limit = 12): string[] {
    return unique([
        ...analysis.strongTerms,
        ...analysis.optionalTerms.filter((term) => !analysis.downrankTerms.includes(term)),
        ...analysis.downrankTerms,
    ]).slice(0, Math.max(1, limit));
}
