import * as crypto from 'crypto';
import { DatabaseManager } from '../db/DatabaseManager';
import { DEFAULT_MODE_CUSTOM_CONTEXT_BY_TEMPLATE, getDefaultModeCustomContext } from './ModeDefaultContexts';
import { ModeContextRetriever } from './ModeContextRetriever';
import {
    DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE,
    MAX_INTENT_KEYWORDS_CSV_LENGTH,
    isValidIntentKeywordIntent,
    normalizeIntentKeywordsCsv,
    type IntentKeywordConfig,
} from '../llm/IntentKeywordDefaults';
import {
    MODE_GENERAL_PROMPT,
    MODE_LOOKING_FOR_WORK_PROMPT,
    MODE_SALES_PROMPT,
    MODE_FDE_PROMPT,
    MODE_RECRUITING_PROMPT,
    MODE_TEAM_MEET_PROMPT,
    MODE_LECTURE_PROMPT,
    MODE_TECHNICAL_INTERVIEW_PROMPT,
    SHARED_MODE_PREFIX,
    SHARED_MODE_PREFIX_SHORT,
} from '../llm/prompts';

export type ModeTemplateType =
    | 'general'
    | 'looking-for-work'
    | 'sales'
    | 'fde'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'technical-interview';

export interface Mode {
    id: string;
    name: string;
    templateType: ModeTemplateType;
    customContext: string;
    intentKeywords: IntentKeywordConfig[];
    isActive: boolean;
    createdAt: string;
}

export interface ModeReferenceFile {
    id: string;
    modeId: string;
    fileName: string;
    content: string;
    createdAt: string;
}

export interface ModeNoteSection {
    id: string;
    modeId: string;
    title: string;
    description: string;
    sortOrder: number;
    createdAt: string;
}

export const MODE_TEMPLATES: Array<{
    type: ModeTemplateType;
    label: string;
    description: string;
}> = [
    { type: 'general',              label: '通用',              description: '适用于任何会议或对话的通用智能助手。' },
    { type: 'sales',                label: '销售',              description: '通过策略性需求发现和异议处理来促成交易。' },
    { type: 'fde',                  label: 'FDE',               description: '支持前线部署工程师完成客户现场多人会议、需求澄清、技术约束识别与交付推进。' },
    { type: 'recruiting',           label: '招聘',              description: '通过结构化面试洞察来评估候选人。' },
    { type: 'team-meet',            label: '团队会议',          description: '跟踪会议中的行动项和关键决策。' },
    { type: 'looking-for-work',     label: '求职',              description: '自信、清晰地回答面试问题。' },
    { type: 'technical-interview',  label: '技术面试',          description: '白板风格的编码和系统设计支持。' },
    { type: 'lecture',              label: '讲座',              description: '捕捉讲座中的关键概念和内容。' },
];

// Default note sections seeded when a mode is created from a template
export const TEMPLATE_NOTE_SECTIONS: Record<ModeTemplateType, Array<{ title: string; description: string }>> = {
    general: [
        { title: '摘要',      description: '对话的高级摘要。' },
        { title: '行动项', description: '识别出的任务和后续跟进。' },
        { title: '要点',   description: '讨论中的重要观点。' },
    ],
    'looking-for-work': [
        { title: '后续行动',      description: '下一步面试安排，或我承诺会发送的额外材料。' },
        { title: '概览',               description: '面试、公司和整体流程的概览。' },
        { title: '问题与回答', description: '面试中问到的所有问题以及我给出的回答。' },
        { title: '改进空间',       description: '我在面试中可以做得更好的地方。' },
        { title: '岗位细节',           description: '关于职位、薪资期望等讨论到的任何内容。' },
    ],
    sales: [
        { title: '行动项',         description: '我在会议后需要完成的所有行动项。' },
        { title: '结果',             description: '是否成交以及对话的结果。' },
        { title: '客户背景',  description: '我向其销售的对象的背景信息。' },
        { title: '需求发现',           description: '客户在需求发现阶段说了什么。' },
        { title: '产品',           description: '我是如何介绍产品的，以及客户的反应。' },
        { title: '异议',           description: '客户提出的任何异议。' },
    ],
    fde: [
        { title: '客户目标', description: '客户想达成的业务结果、成功指标和决策背景。' },
        { title: '现场工作流', description: '客户当前如何完成这件事，涉及哪些角色、输入、输出和交接。' },
        { title: '痛点与阻塞', description: '重复劳动、系统限制、数据缺口、流程摩擦和失败成本。' },
        { title: '系统与数据约束', description: '集成系统、API、权限、SSO、数据源、安全和合规约束。' },
        { title: '方案假设', description: '现场形成的技术方案、原型方向、待验证假设和成功门槛。' },
        { title: '风险与未知项', description: '尚未确认、可能影响交付、范围或上线计划的事项。' },
        { title: '行动项', description: '会后要推进的负责人、截止时间、所需资料和交付物。' },
    ],
    recruiting: [
        { title: '行动项',          description: '我在会议后必须完成的所有行动项。' },
        { title: '经验与技能', description: '讨论到的候选人的先前工作经验和技能。' },
        { title: '回答质量',  description: '如果有提问，候选人每个问题回答得有多好、多准确。' },
        { title: '对公司的兴趣',   description: '候选人对其公司兴趣的描述。' },
        { title: '岗位期望',     description: '关于职位、薪资期望等讨论到的任何内容。' },
    ],
    'team-meet': [
        { title: '行动项',          description: '我在会议后需要完成的所有行动项。' },
        { title: '公告',         description: '会议中的任何团队-wide 公告。' },
        { title: '团队更新',           description: '每位团队成员的进展、成果和当前重点。' },
        { title: '挑战或阻塞', description: '任何可能影响进展的问题或障碍。' },
        { title: '已做决策',        description: '会议中达成的关键决策或共识。' },
    ],
    lecture: [
        { title: '后续作业',  description: '课后阅读、作业或需要完成的任务。' },
        { title: '主题',           description: '讲座的主要科目或主题。' },
        { title: '核心概念',    description: '涵盖的核心思想或框架。' },
        { title: '内容',           description: '讲座的全部内容，用非常详细的要点笔记记录。' },
    ],
    'technical-interview': [
        { title: '覆盖的问题',  description: '每个被问到的问题、使用的方法和结果。' },
        { title: '考察的概念',   description: '涉及的关键算法、数据结构或系统设计概念。' },
        { title: '表现出色之处',    description: '哪些方法或解释效果不错。' },
        { title: '待学习领域',    description: '识别出的需要更多准备的主题或知识缺口。' },
        { title: '行动项',      description: '后续步骤——例如发送代码、学习特定主题、等待下一轮。' },
    ],
};

const TEMPLATE_SYSTEM_PROMPTS: Record<ModeTemplateType, string> = {
    // General = universal adaptive copilot (own prompt, not technical interview)
    general: MODE_GENERAL_PROMPT,
    'technical-interview': MODE_TECHNICAL_INTERVIEW_PROMPT,

    'looking-for-work': MODE_LOOKING_FOR_WORK_PROMPT,
    sales: MODE_SALES_PROMPT,
    fde: MODE_FDE_PROMPT,
    recruiting: MODE_RECRUITING_PROMPT,
    'team-meet': MODE_TEAM_MEET_PROMPT,
    lecture: MODE_LECTURE_PROMPT,
};

// Startup invariant: every MODE_*_PROMPT must begin with one of the two shared
// prefixes so getActiveModeSystemPromptSuffix() can strip duplicated tokens.
// If a future template diverges, we silently regress to shipping ~1.6K duplicate
// tokens per request. Warn loudly here instead so the regression is caught at
// app launch, not by a prod cost spike.
for (const [templateType, prompt] of Object.entries(TEMPLATE_SYSTEM_PROMPTS)) {
    if (!prompt.startsWith(SHARED_MODE_PREFIX) && !prompt.startsWith(SHARED_MODE_PREFIX_SHORT)) {
        console.warn(
            `[ModesManager] WARN: MODE template '${templateType}' does not start with ` +
            `SHARED_MODE_PREFIX or SHARED_MODE_PREFIX_SHORT. Token deduplication will fall ` +
            `back to sending the full template — duplicate-token regression. See prompts.ts.`
        );
    }
}

export function encodeModeContextPayload(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export { DEFAULT_MODE_CUSTOM_CONTEXT_BY_TEMPLATE };

function rowToMode(row: any): Mode {
    return {
        id: row.id,
        name: row.name,
        templateType: row.template_type as ModeTemplateType,
        customContext: row.custom_context ?? '',
        intentKeywords: row.intentKeywords ?? [],
        isActive: row.is_active === 1,
        createdAt: row.created_at,
    };
}

function rowToIntentKeyword(row: any): IntentKeywordConfig {
    return {
        intent: row.intent,
        keywordsCsv: row.keywords_csv ?? '',
    };
}

function sanitizeIntentKeywordRows(rows: IntentKeywordConfig[]): IntentKeywordConfig[] {
    return rows
        .filter(row => isValidIntentKeywordIntent(row.intent))
        .map(row => ({
            intent: row.intent,
            keywordsCsv: normalizeIntentKeywordsCsv(row.keywordsCsv.slice(0, MAX_INTENT_KEYWORDS_CSV_LENGTH)).join(','),
        }));
}

function rowToFile(row: any): ModeReferenceFile {
    return {
        id: row.id,
        modeId: row.mode_id,
        fileName: row.file_name,
        content: row.content ?? '',
        createdAt: row.created_at,
    };
}

function rowToSection(row: any): ModeNoteSection {
    return {
        id: row.id,
        modeId: row.mode_id,
        title: row.title,
        description: row.description ?? '',
        sortOrder: row.sort_order ?? 0,
        createdAt: row.created_at,
    };
}

export class ModesManager {
    private static instance: ModesManager;
    private static databaseOverride: DatabaseManager | null = null;
    private readonly modeContextRetriever = new ModeContextRetriever();

    private constructor() {}

    public static getInstance(): ModesManager {
        if (!ModesManager.instance) {
            ModesManager.instance = new ModesManager();
        }
        return ModesManager.instance;
    }

    public static __setDatabaseForTests(db: DatabaseManager | null): void {
        ModesManager.databaseOverride = db;
    }

    private static getDatabase(): DatabaseManager {
        return ModesManager.databaseOverride ?? DatabaseManager.getInstance();
    }

    // ── Modes ─────────────────────────────────────────────────────

    public getModes(): Mode[] {
        const db = ModesManager.getDatabase();
        const modes = db.getModes().map((row: any) => this.hydrateModeIntentKeywords(rowToMode(row), db));

        // Always enforce 'general' at the very top of the list.
        // L1: id is the secondary sort key for stable ordering when two modes
        // share createdAt to the millisecond.
        modes.sort((a, b) => {
            if (a.templateType === 'general') return -1;
            if (b.templateType === 'general') return 1;
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            if (ta !== tb) return ta - tb;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        return modes;
    }

    // Seed all seven built-in modes once at app init. Idempotent.
    public ensureSeeded(): void {
        const db = ModesManager.getDatabase();
        const modes = db.getModes().map(rowToMode);
        const existingTypes = new Set(modes.map(m => m.templateType));
        for (const tmpl of MODE_TEMPLATES) {
            if (!existingTypes.has(tmpl.type)) {
                this.createMode({ name: tmpl.label, templateType: tmpl.type });
            }
        }
        for (const mode of db.getModes().map(rowToMode)) {
            db.seedDefaultIntentKeywordsForMode?.(mode.id, mode.templateType);
        }
    }

    public getActiveMode(): Mode | null {
        const db = ModesManager.getDatabase();
        const row = db.getActiveMode();
        return row ? this.hydrateModeIntentKeywords(rowToMode(row), db) : null;
    }

    // Modes where the premium knowledge intercept (negotiation coaching, intro
    // shortcut, premium-flavored systemPromptInjection/contextBlock) is OUT OF
    // SCOPE and would replace the user's expected answer with off-topic content.
    // Technical interviews are coding/system-design only; team meetings and
    // lectures have no candidate/interview scope. Issue #272: technical-
    // interview users were getting one-line salary coaching cards instead of
    // technical answers because the premium tracker fires on any interviewer
    // utterance regardless of the active mode. The fix also closes two sibling
    // vectors of the same bug class — the intro-question shortcut and the
    // premium prompt/context injection — by gating the whole intercept here.
    private static readonly PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES: ReadonlySet<ModeTemplateType> = new Set([
        'fde',
        'technical-interview',
        'team-meet',
        'lecture',
    ]);

    /**
     * True when the premium knowledge intercept (negotiation coaching, intro
     * shortcut, premium system-prompt/context injection) is contextually
     * appropriate for the active mode. False for technical-interview, team-
     * meet, and lecture — modes where premium-flavored interjections overwrite
     * the user's expected answer. Defaults to true when no mode is active.
     */
    public isPremiumKnowledgeInterceptAllowed(): boolean {
        const mode = this.getActiveMode();
        if (!mode) return true;
        return !ModesManager.PREMIUM_INTERCEPT_INCOMPATIBLE_TEMPLATES.has(mode.templateType);
    }

    public createMode(params: { name: string; templateType: ModeTemplateType }): Mode {
        const id = `mode_${crypto.randomUUID()}`;
        const db = ModesManager.getDatabase();
        const defaultCustomContext = getDefaultModeCustomContext(params.templateType);
        db.createMode({
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: defaultCustomContext,
        });
        db.seedDefaultIntentKeywordsForMode?.(id, params.templateType);
        // Seed default note sections for this template type
        const defaultSections = TEMPLATE_NOTE_SECTIONS[params.templateType] ?? [];
        defaultSections.forEach((s, i) => {
            const sectionId = `ns_${crypto.randomUUID()}`;
            db.addNoteSection({
                id: sectionId,
                modeId: id,
                title: s.title,
                description: s.description,
                sortOrder: i,
            });
        });
        return {
            id,
            name: params.name,
            templateType: params.templateType,
            customContext: defaultCustomContext,
            intentKeywords: this.getIntentKeywords(id),
            isActive: false,
            createdAt: new Date().toISOString(),
        };
    }

    public updateMode(id: string, updates: { name?: string; templateType?: ModeTemplateType; customContext?: string; intentKeywords?: IntentKeywordConfig[] }): void {
        const db = ModesManager.getDatabase();
        db.updateMode(id, updates);
        if (updates.intentKeywords !== undefined) {
            db.upsertIntentKeywords(id, sanitizeIntentKeywordRows(updates.intentKeywords));
        }
    }

    public resetModeIntentKeywords(id: string): IntentKeywordConfig[] {
        const mode = this.getModes().find(m => m.id === id);
        if (!mode) return [];
        const db = ModesManager.getDatabase();
        db.resetIntentKeywords(id, mode.templateType);
        return this.getIntentKeywords(id);
    }

    public deleteMode(id: string) {
        return ModesManager.getDatabase().deleteMode(id);
    }

    public setActiveMode(id: string | null): void {
        ModesManager.getDatabase().setActiveMode(id);
    }

    public getIntentKeywords(modeId: string): IntentKeywordConfig[] {
        return ModesManager.getDatabase().getIntentKeywords(modeId)
            .map(rowToIntentKeyword)
            .filter(row => isValidIntentKeywordIntent(row.intent));
    }

    private hydrateModeIntentKeywords(mode: Mode, db = ModesManager.getDatabase()): Mode {
        let intentKeywords = db.getIntentKeywords?.(mode.id)
            .map(rowToIntentKeyword)
            .filter(row => isValidIntentKeywordIntent(row.intent)) ?? [];
        if (intentKeywords.length === 0) {
            intentKeywords = DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE[mode.templateType] ?? DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE.general;
        }
        return { ...mode, intentKeywords };
    }

    // ── Reference Files ───────────────────────────────────────────

    public getReferenceFiles(modeId: string): ModeReferenceFile[] {
        return ModesManager.getDatabase().getReferenceFiles(modeId).map(rowToFile);
    }

    public addReferenceFile(params: { modeId: string; fileName: string; content: string }): ModeReferenceFile {
        const id = `ref_${crypto.randomUUID()}`;
        ModesManager.getDatabase().addReferenceFile({
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
        });
        return {
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
            createdAt: new Date().toISOString(),
        };
    }

    public addReferenceFileWithMetadata(params: {
        modeId: string;
        fileName: string;
        content: string;
        scenarioType: string;
        docSubtype: string;
        parsedJson?: string | null;
        fileHash?: string | null;
    }): ModeReferenceFile {
        const id = `ref_${crypto.randomUUID()}`;
        ModesManager.getDatabase().addReferenceFileWithMetadata(
            {
                id,
                modeId: params.modeId,
                fileName: params.fileName,
                content: params.content,
            },
            {
                referenceFileId: id,
                scenarioType: params.scenarioType,
                docSubtype: params.docSubtype,
                parsedJson: params.parsedJson,
                fileHash: params.fileHash,
            },
        );
        return {
            id,
            modeId: params.modeId,
            fileName: params.fileName,
            content: params.content,
            createdAt: new Date().toISOString(),
        };
    }

    public deleteReferenceFile(id: string) {
        return ModesManager.getDatabase().deleteReferenceFile(id);
    }

    // ── Note Sections ─────────────────────────────────────────────

    public getNoteSections(modeId: string): ModeNoteSection[] {
        return ModesManager.getDatabase().getNoteSections(modeId).map(rowToSection);
    }

    public addNoteSection(params: { modeId: string; title: string; description: string }): ModeNoteSection {
        const existingSections = this.getNoteSections(params.modeId);
        const sortOrder = existingSections.length;
        const id = `ns_${crypto.randomUUID()}`;
        ModesManager.getDatabase().addNoteSection({
            id,
            modeId: params.modeId,
            title: params.title,
            description: params.description,
            sortOrder,
        });
        return {
            id,
            modeId: params.modeId,
            title: params.title,
            description: params.description,
            sortOrder,
            createdAt: new Date().toISOString(),
        };
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string }): void {
        ModesManager.getDatabase().updateNoteSection(id, updates);
    }

    public deleteNoteSection(id: string): void {
        ModesManager.getDatabase().deleteNoteSection(id);
    }

    public removeAllNoteSections(modeId: string): void {
        ModesManager.getDatabase().deleteAllNoteSections(modeId);
    }

    // ── LLM Context ───────────────────────────────────────────────

    /**
     * Returns the system prompt suffix for the active mode's template type.
     * Returns the template's MODE_*_PROMPT (including general's MODE_GENERAL_PROMPT
     * and technical-interview's MODE_TECHNICAL_INTERVIEW_PROMPT). Empty string
     * only when no mode is active.
     */
    public getActiveModeSystemPromptSuffix(): string {
        const mode = this.getActiveMode();
        if (!mode) return '';
        const full = TEMPLATE_SYSTEM_PROMPTS[mode.templateType] ?? '';
        // Strip the shared prefix that's already in HARD_SYSTEM_PROMPT, otherwise
        // CORE_IDENTITY + EXECUTION_CONTRACT + CONTEXT_INTELLIGENCE_LAYER (+
        // SHARED_CODING_RULES for coding modes) ship twice per request — ~1.6K
        // duplicated tokens for coding modes, ~1.2K for non-coding.
        //
        // Try the long (4-block) prefix first to handle coding modes, then the
        // short (3-block) prefix for sales/recruiting/team-meet/lecture which
        // intentionally omit SHARED_CODING_RULES. Fall back to unchanged if
        // neither matches — safe default for future template drift.
        for (const prefix of [SHARED_MODE_PREFIX, SHARED_MODE_PREFIX_SHORT]) {
            if (full.startsWith(prefix)) {
                return full.slice(prefix.length).replace(/^\s+/, '');
            }
        }
        return full;
    }

    /**
     * Builds a context block to inject before the user message for the active mode.
     * Includes custom context text and reference file contents.
     *
     * Limits: each file is capped at MAX_FILE_CHARS to prevent context window overflow.
     * Total block is capped at MAX_TOTAL_CHARS across all files.
     */
    private static readonly MAX_FILE_CHARS = 12_000;
    private static readonly MAX_TOTAL_CHARS = 40_000;

    public buildRetrievedActiveModeContextBlock(query: string, transcript?: string, tokenBudget?: number): string {
        const mode = this.getActiveMode();
        if (!mode) return '';

        const result = this.modeContextRetriever.retrieve(mode, this.getReferenceFiles(mode.id), {
            query,
            transcript,
            tokenBudget,
        });

        return result.formattedContext;
    }

    /**
     * Phase 4 — async hybrid retrieval (FTS + vector + dedupe + lexical fallback).
     * Callers in async paths (WhatToAnswerLLM, LLMHelper paths) should prefer
     * this. If hybrid throws (DB missing, embedding provider unavailable),
     * we fall back to the existing sync lexical path so the answer flow
     * never breaks. Telemetry distinguishes hybrid hits from lexical fallback.
     */
    public async buildRetrievedActiveModeContextBlockHybrid(
        query: string,
        transcript?: string,
        tokenBudget?: number,
        telemetryMetadata?: { benchmarkRunId?: string },
    ): Promise<string> {
        const mode = this.getActiveMode();
        if (!mode) return '';
        const files = this.getReferenceFiles(mode.id);

        // Telemetry: rag_query / rag_hit / rag_miss / rag_lexical_fallback.
        let usedHybrid = false;
        let usedFallback = false;
        let chunkCount = 0;
        const ragStartedAt = performance.now();
        const trackRagQuery = () => {
            try {
                const { telemetryService } = require('./telemetry/TelemetryService');
                telemetryService.track({
                    name: 'rag_query',
                    modeId: mode.id,
                    durationMs: performance.now() - ragStartedAt,
                    properties: {
                        modeTemplateType: mode.templateType,
                        fileCount: files.length,
                        hasTranscript: Boolean(transcript),
                        ...(telemetryMetadata?.benchmarkRunId ? { benchmarkRunId: telemetryMetadata.benchmarkRunId } : {}),
                    },
                });
            } catch { /* non-fatal */ }
        };

        try {
            const result = await this.modeContextRetriever.retrieveHybrid(mode, files, {
                query,
                transcript,
                tokenBudget,
            });
            usedHybrid = result.usedHybrid;
            usedFallback = result.usedFallback;
            chunkCount = result.chunks?.length ?? 0;
            if (result.formattedContext) {
                trackRagQuery();
                try {
                    const { telemetryService } = require('./telemetry/TelemetryService');
                    telemetryService.track({
                        name: usedHybrid ? 'rag_hit' : 'rag_lexical_fallback',
                        modeId: mode.id,
                        properties: { chunkCount, modeTemplateType: mode.templateType },
                    });
                } catch { /* non-fatal */ }
                return result.formattedContext;
            }
            // Empty hybrid result — fall through to lexical so we still try.
        } catch (err) {
            console.warn('[ModesManager] hybrid retrieval failed, falling back to lexical:', (err as Error)?.message);
        }

        const lexical = this.buildRetrievedActiveModeContextBlock(query, transcript, tokenBudget);
        trackRagQuery();
        try {
            const { telemetryService } = require('./telemetry/TelemetryService');
            telemetryService.track({
                name: lexical ? 'rag_lexical_fallback' : 'rag_miss',
                modeId: mode.id,
                properties: { modeTemplateType: mode.templateType, fileCount: files.length },
            });
        } catch { /* non-fatal */ }
        return lexical;
    }

    /**
     * Phase 6 — summary-safe context block for post-call summarization.
     *
     * Includes the mode's `customContext` (low-token, user-authored, trusted) plus
     * up to a small budget of *retrieved* reference snippets. Never returns full
     * raw reference file bodies, even when retrieval misses — that data path is
     * covered by `buildActiveModeContextBlock()` and remains legacy/supporting.
     *
     * Callers can opt out of the retrieved-snippets portion via
     * `options.includeReferenceSnippets = false` to honor the
     * `reference_files` provider data scope without losing mode customContext.
     */
    public buildSummarySafeModeContextBlock(
        modeId: string,
        options?: { query?: string; transcript?: string; tokenBudget?: number; includeReferenceSnippets?: boolean }
    ): string {
        const mode = this.getModes().find(m => m.id === modeId);
        if (!mode) return '';

        const parts: string[] = [];

        if (mode.customContext.trim()) {
            parts.push(`<active_mode_custom_instructions format="json">\n${encodeModeContextPayload({ content: mode.customContext.trim() })}\n</active_mode_custom_instructions>`);
        }

        const includeReferenceSnippets = options?.includeReferenceSnippets !== false;
        if (includeReferenceSnippets) {
            try {
                const result = this.modeContextRetriever.retrieve(mode, this.getReferenceFiles(mode.id), {
                    query: options?.query ?? '',
                    transcript: options?.transcript ?? '',
                    tokenBudget: options?.tokenBudget ?? 1200,
                });
                if (result?.formattedContext) {
                    parts.push(result.formattedContext);
                }
            } catch (err) {
                console.warn('[ModesManager] summary-safe retrieval failed (non-fatal):', (err as Error)?.message);
            }
        }

        return parts.length > 0 ? '\n' + parts.join('\n\n') + '\n' : '';
    }

    public buildActiveModeContextBlock(): string {
        const mode = this.getActiveMode();
        if (!mode) return '';

        const parts: string[] = [];

        if (mode.customContext.trim()) {
            parts.push(`<active_mode_custom_instructions format="json">\n${encodeModeContextPayload({ content: mode.customContext.trim() })}\n</active_mode_custom_instructions>`);
        }

        const files = this.getReferenceFiles(mode.id);
        const MARKER = '[...truncated]';
        let totalChars = 0;

        for (const file of files) {
            const raw = file.content.trim();
            if (!raw) continue;

            const remaining = ModesManager.MAX_TOTAL_CHARS - totalChars;
            if (remaining <= 0) break;

            // Cap per-file. Only append the truncation marker when there's
            // headroom for the full marker — never emit a partial '[...truncat'.
            const fileCap = ModesManager.MAX_FILE_CHARS;
            let capped: string;
            if (raw.length > fileCap) {
                if (fileCap > MARKER.length + 1) {
                    capped = raw.slice(0, fileCap - MARKER.length - 1) + '\n' + MARKER;
                } else {
                    capped = raw.slice(0, fileCap);
                }
            } else {
                capped = raw;
            }

            // Apply the cross-file budget. If the slice would split the marker, drop it.
            let content: string;
            if (capped.length <= remaining) {
                content = capped;
            } else if (remaining >= MARKER.length + 1) {
                content = capped.slice(0, remaining - MARKER.length - 1) + '\n' + MARKER;
            } else {
                content = capped.slice(0, remaining);
            }

            const payload = encodeModeContextPayload({ fileName: file.fileName, content });
            parts.push(`<reference_file format="json">\n${payload}\n</reference_file>`);
            totalChars += content.length;
        }

        return parts.join('\n\n');
    }
}
