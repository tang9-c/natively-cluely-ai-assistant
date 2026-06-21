import * as crypto from 'crypto';
import { DynamicAction, EvidenceRef } from './DynamicAction';
import { DynamicActionStore } from './DynamicActionStore';
import { DynamicActionDetector, MODE_TRIGGERS } from './DynamicActionDetector';

function detectLanguage(text: string): string {
    const cjkCount = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    const latinWords = text.match(/[A-Za-z][A-Za-z0-9+#.-]*/g)?.length ?? 0;
    if (cjkCount > 0 && latinWords >= 2) return 'mixed';
    if (cjkCount > 0) return 'zh';
    if (latinWords > 0) return 'en';
    return 'unknown';
}

function uniquePush(values: string[], value: string): void {
    const normalized = value.trim();
    if (!normalized) return;
    if (!values.includes(normalized)) values.push(normalized);
}

function extractKeyEntities(text: string): string[] {
    const entities: string[] = [];
    const moneyLike = text.match(/[$￥€£]?\s?\d+(?:[,.]\d+)*(?:\s?(?:k|K|m|M|万|亿|%|percent|天|周|个月|年))?/g) ?? [];
    for (const match of moneyLike) uniquePush(entities, match);

    const domainTerms = [
        '价格', '报价', '预算', '成本', '费用', '合同', '法务', '审批', '老板', 'ROI', '竞品',
        '行动项', '负责人', '截止', '风险', '阻塞', '依赖', 'STAR', 'offer', '薪资',
        '算法', '复杂度', '系统设计', 'debug', 'API', '数据库', '公式', '定理', '作业',
    ];
    for (const term of domainTerms) {
        if (text.toLowerCase().includes(term.toLowerCase())) uniquePush(entities, term);
    }

    const technicalTokens = text.match(/\b[A-Z][A-Za-z0-9+#.-]{1,}\b/g) ?? [];
    for (const token of technicalTokens.slice(0, 8)) uniquePush(entities, token);

    const deadlineTerms = text.match(/(?:周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|后天|下周|月底|季度末|Friday|Monday|Tuesday|Wednesday|Thursday|EOD|tomorrow)/gi) ?? [];
    for (const term of deadlineTerms) uniquePush(entities, term);

    return entities.slice(0, 12);
}

function buildRetrievalQuery(params: {
    modeTemplateType: string;
    intent: string;
    keyEntities: string[];
    latestTurn: string;
    emotion?: string;
    language: string;
}): string {
    const parts = [
        `mode:${params.modeTemplateType}`,
        `intent:${params.intent}`,
        params.keyEntities.length > 0 ? `entities:${params.keyEntities.join(', ')}` : '',
        params.emotion ? `emotion:${params.emotion}` : '',
        `language:${params.language}`,
        `latestTurn:${params.latestTurn}`,
    ].filter(Boolean);
    return parts.join('\n');
}

export class DynamicActionEngine {
    private store: DynamicActionStore;
    private detector: DynamicActionDetector;

    constructor(
        store: DynamicActionStore = new DynamicActionStore(),
        detector: DynamicActionDetector = new DynamicActionDetector(MODE_TRIGGERS)
    ) {
        this.store = store;
        this.detector = detector;
    }

    detectActions(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
        emotion?: string;
        emotionSource?: string;
        language?: string;
    }): DynamicAction[] {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = Date.now();
        const candidateActions: DynamicAction[] = [];
        const language = params.language || detectLanguage(transcript);
        const keyEntities = extractKeyEntities(transcript);

        // Detect triggers using regex patterns
        const matchedTriggers = this.detector.detectTriggers({ transcript, modeTemplateType });

        for (const { trigger, match, index } of matchedTriggers) {
            // Build evidence ref from transcript
            const evidenceRef: EvidenceRef = {
                source: 'transcript',
                text: transcript,
                timestamp: now,
                speaker,
            };
            const autoSurfacePolicy = trigger.priority >= 0.9 ? 'auto' : 'card';
            const retrievalQuery = buildRetrievalQuery({
                modeTemplateType,
                intent: trigger.type,
                keyEntities,
                latestTurn: transcript,
                emotion: params.emotion,
                language,
            });

            // Create candidate action. Loop runs once per matched trigger
            // within a single detectActions() call, so `now` is identical for
            // every action minted here — embedding it in the id is not
            // sufficient on its own. Use a UUID for the id; `now` stays as
            // createdAt (where the shared timestamp is the correct semantic).
            const action: DynamicAction = {
                id: `action_${crypto.randomUUID()}`,
                sessionId,
                modeId,
                modeTemplateType,
                type: trigger.type,
                label: trigger.label,
                description: `Triggered by: "${match}"`,
                confidence: trigger.priority,
                priority: trigger.priority,
                evidenceRefs: [evidenceRef],
                status: 'candidate',
                createdAt: now,
                promptInstruction: trigger.promptInstruction,
                sourceIntent: trigger.type,
                latestTurn: transcript,
                language,
                emotion: params.emotion,
                emotionSource: params.emotionSource,
                keyEntities,
                retrievalQuery,
                autoSurfacePolicy,
                autoTriggerEligible: autoSurfacePolicy === 'auto',
                autoTriggerReason: autoSurfacePolicy === 'auto'
                    ? 'high_confidence_final_transcript'
                    : 'medium_confidence_card',
                answerStyle: trigger.answerStyle,
            };

            // Check deduplication
            const deduplicatedAction = this.store.deduplicate(action);
            if (deduplicatedAction) {
                candidateActions.push(deduplicatedAction);
                this.store.addAction(deduplicatedAction);
            }
        }

        return candidateActions;
    }

    getTopActions(sessionId: string, maxAgeMs: number = 60000): DynamicAction[] {
        // Expire stale actions first
        this.store.expireStaleActions(sessionId, maxAgeMs);

        // Get active actions sorted by priority (descending)
        const activeActions = this.store.getActiveActions(sessionId);
        return activeActions
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 3);
    }

    acceptAction(actionId: string): DynamicAction | null {
        const action = this.store.getAction(actionId);
        if (action) {
            this.store.updateStatus(actionId, 'accepted');
            return action;
        }
        return null;
    }

    dismissAction(actionId: string): void {
        this.store.updateStatus(actionId, 'dismissed');
    }

    completeAction(actionId: string): void {
        this.store.updateStatus(actionId, 'completed');
    }

    getStore(): DynamicActionStore {
        return this.store;
    }

    getDetector(): DynamicActionDetector {
        return this.detector;
    }
}
