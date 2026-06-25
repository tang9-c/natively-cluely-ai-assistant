const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'what', 'when', 'where', 'which',
    'how', 'why', 'are', 'was', 'were', 'have', 'has', 'had', 'you', 'your', 'our',
    '我们', '你们', '这个', '那个', '怎么', '什么', '一下', '一个', '是否', '可以',
]);

export function tokenizeForLexicalSearch(text: string): string[] {
    const normalized = (text || '').toLowerCase();
    const latin = normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) ?? [];
    const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    const cjkWindows: string[] = [];
    for (const token of cjk) {
        cjkWindows.push(token);
        for (let size = 2; size <= 4; size++) {
            for (let i = 0; i <= token.length - size; i++) {
                cjkWindows.push(token.slice(i, i + size));
            }
        }
    }
    return [...latin, ...cjkWindows]
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

export function lexicalScore(query: string, text: string): number {
    const terms = [...new Set(tokenizeForLexicalSearch(query))];
    if (terms.length === 0) return 0;
    const haystack = (text || '').toLowerCase();
    let covered = 0;
    let weighted = 0;
    for (const term of terms) {
        if (!haystack.includes(term)) continue;
        covered += 1;
        weighted += term.length >= 4 ? 1.2 : 1;
    }
    const coverage = covered / terms.length;
    const weightedCoverage = Math.min(1, weighted / Math.max(1, terms.length));
    return Number(((coverage * 0.65) + (weightedCoverage * 0.35)).toFixed(4));
}

export function keywordCoverage(query: string, text: string): number {
    return lexicalScore(query, text);
}
