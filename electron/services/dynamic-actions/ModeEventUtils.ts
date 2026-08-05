export function detectLanguage(text: string): string {
    const cjkCount = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    const latinWords = text.match(/[A-Za-z][A-Za-z0-9+#.-]*/g)?.length ?? 0;
    if (cjkCount > 0 && latinWords >= 2) return 'mixed';
    if (cjkCount > 0) return 'zh';
    if (latinWords > 0) return 'en';
    return 'unknown';
}

export type DynamicActionResponseLanguage = 'zh' | 'en' | 'unknown';

export function resolveDynamicActionResponseLanguage(
    detectedLanguage: string | undefined,
    latestTurn: string | undefined,
): DynamicActionResponseLanguage {
    if (detectedLanguage === 'zh' || detectedLanguage === 'en') return detectedLanguage;
    if (detectedLanguage === 'mixed') {
        return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(latestTurn || '')
            ? 'zh'
            : 'en';
    }
    const inferred = detectLanguage(latestTurn || '');
    if (inferred === 'zh' || inferred === 'en') return inferred;
    if (inferred === 'mixed') return 'zh';
    return 'unknown';
}

export function isDynamicActionResponseLanguageCompatible(
    answer: string,
    expectedLanguage: DynamicActionResponseLanguage,
): boolean {
    if (expectedLanguage === 'unknown') return true;
    const cjkCount = answer.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    if (expectedLanguage === 'zh') return cjkCount >= 2;
    const latinWordCount = answer.match(/[A-Za-z][A-Za-z0-9+#.-]*/g)?.length ?? 0;
    const latinLetterCount = answer.match(/[A-Za-z]/g)?.length ?? 0;
    return latinWordCount >= 2 && latinLetterCount >= Math.max(4, cjkCount * 2);
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

const MODE_ENTITY_TERMS: Record<string, string[]> = {
    sales: [
        '价格', '报价', '预算', '成本', '费用', '合同', '法务', '审批', '老板', 'ROI',
        '竞品', '案例', '回本', '折扣', '采购', '续约', '试点',
    ],
    negotiation: [
        '预算', '报价', '降价', '折扣', '最终报价', '底线', '让步', '承诺', '条款', '价格范围',
    ],
    fde: [
        'API', 'SSO', 'SAML', 'OAuth', 'SCIM', '数据源', '数据库', '数仓', '生产环境',
        '测试环境', '权限', 'PII', 'SOC2', '审计日志', '安全评审', '合规', '隐私',
        '阻塞', '依赖', '迁移', '回滚', '上线风险', '验收标准', '试点', 'KPI',
        '负责人', '下一步', '上线计划',
    ],
    recruiting: [
        '候选人', '岗位', 'JD', '招聘经理', '面试官', '薪资', 'offer', '签证', '入职时间',
        '搬迁', '远程', '混合办公', '背景', '经验', '匹配',
    ],
    'looking-for-work': [
        '简历', '项目', '岗位', 'JD', '面试官', '经验', '作品集', '自我介绍', 'STAR',
        '领导力', '挑战', '结果', '薪资', '动机',
    ],
    'technical-interview': [
        '算法', '复杂度', '系统设计', 'API', '数据库', '缓存', '吞吐量', '边界条件',
        'debug', '数据结构', '架构', '优化',
    ],
    'team-meet': [
        '行动项', '负责人', '截止', '决策', '风险', '阻塞', '依赖', '状态', '进度',
        '上线', '延期', '里程碑',
    ],
    lecture: [
        '概念', '定义', '公式', '定理', '例题', '作业', '阅读', '章节', '考试',
        '测验', '推导', '变量', '证明',
    ],
};

function normalizeModeTemplateType(modeTemplateType?: string | null): string | undefined {
    if (!modeTemplateType) return undefined;
    if (modeTemplateType === 'team_meeting') return 'team-meet';
    if (modeTemplateType === 'technical_interview') return 'technical-interview';
    if (modeTemplateType === 'interview') return 'looking-for-work';
    return modeTemplateType;
}

export function extractKeyEntities(text: string, modeTemplateType?: string | null): string[] {
    const entities: string[] = [];
    const moneyLike = text.match(/[$￥€£]?\s?\d+(?:[,.]\d+)*(?:\s?(?:k|K|m|M|万|亿|%|percent|天|周|个月|年))?/g) ?? [];
    for (const match of moneyLike) uniquePush(entities, match);

    const technicalTokens = text.match(/\b[A-Z][A-Za-z0-9+#.-]{1,}\b/g) ?? [];
    for (const token of technicalTokens.slice(0, 8)) uniquePush(entities, token);

    const deadlineTerms = text.match(/(?:周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|下周|月底|季度末|Friday|Monday|Tuesday|Wednesday|Thursday|EOD|tomorrow)/gi) ?? [];
    for (const term of deadlineTerms) uniquePush(entities, term);

    const modeKey = normalizeModeTemplateType(modeTemplateType);
    const modeTerms = modeKey ? MODE_ENTITY_TERMS[modeKey] ?? [] : [];
    for (const term of modeTerms) {
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
