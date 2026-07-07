export const CJK_RETRIEVAL_TERMS = [
    '价格', '产品', '案例', '报价', '报价单', '预算', '成本', '合同', 'roi',
    '竞品', '上线', '回本', '价值', '客户', '异议', '法务', '审批', '折扣',
    '费用', '采购', '实施', '部署', '续约', '试点', '试用',
    '候选人', '岗位', 'jd', '招聘经理', '面试官', '薪资', 'offer', '签证',
    '入职时间', '搬迁', '远程', '混合办公', '背景', '经验', '匹配',
    '简历', '项目', '作品集', '自我介绍', 'star', '领导力', '挑战', '结果', '动机',
    '行动项', '负责人', '截止', '决策', '风险', '阻塞', '依赖', '状态',
    '进度', '延期', '里程碑',
    '概念', '定义', '公式', '定理', '例题', '作业', '阅读', '章节',
    '考试', '测验', '推导', '变量', '证明',
    '算法', '复杂度', '系统设计', 'api', '数据库', '缓存', '吞吐量',
    '边界条件', 'debug', '数据结构', '架构', '优化',
    '降价', '最终报价', '底线', '让步', '承诺', '条款', '价格范围',
];

export const CJK_RELEVANCE_THRESHOLD_MULTIPLIER = 0.45;
export const CJK_CHUNK_UNIQUE_TOKEN_CAP = 80;

export function wordsOf(text: string): string[] {
    const normalized = text
        .toLowerCase()
        .replace(/['’]s\b/g, '')
        .replace(/['’]/g, '');
    const tokens = new Set<string>();

    for (const word of normalized.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? []) {
        if (word.length > 2) tokens.add(word);
    }

    for (const sequence of text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []) {
        if (sequence.length <= 8) tokens.add(sequence);
        for (let i = 0; i < sequence.length - 1; i++) tokens.add(sequence.slice(i, i + 2));
        for (let i = 0; i < sequence.length - 2; i++) tokens.add(sequence.slice(i, i + 3));
    }

    for (const term of CJK_RETRIEVAL_TERMS) {
        if (normalized.includes(term.toLowerCase())) tokens.add(term.toLowerCase());
    }

    return Array.from(tokens);
}

export function hasCjkText(text: string): boolean {
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
}

export function computeLexicalScore(
    chunk: string,
    queryWords: Set<string>,
    hasCjkQuery: boolean,
): number {
    if (queryWords.size === 0) return 0;
    const chunkWords = wordsOf(chunk);
    if (chunkWords.length === 0) return 0;
    let matches = 0;
    const seen = new Set<string>();
    for (const word of chunkWords) {
        if (queryWords.has(word) && !seen.has(word)) {
            matches++;
            seen.add(word);
        }
    }
    const chunkUniqueSize = new Set(chunkWords).size;
    const normalizedChunkSize = hasCjkQuery
        ? Math.min(chunkUniqueSize, CJK_CHUNK_UNIQUE_TOKEN_CAP)
        : chunkUniqueSize;
    return matches / Math.sqrt(queryWords.size * Math.max(1, normalizedChunkSize));
}
