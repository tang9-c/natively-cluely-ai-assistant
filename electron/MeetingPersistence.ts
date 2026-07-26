// MeetingPersistence.ts
// Handles meeting lifecycle: stop, save, and recovery.
// Extracted from IntelligenceManager to decouple DB operations from LLM orchestration.

import { SessionTracker, TranscriptSegment } from './SessionTracker';
import { LLMHelper } from './LLMHelper';
import { DatabaseManager, Meeting } from './db/DatabaseManager';
import { GROQ_TITLE_PROMPT, GROQ_SUMMARY_JSON_PROMPT } from './llm';
import { buildPostCallEnhancements } from './services/post-call/PostCallWorkflow';
import { generateFullTranscriptSummary, type PostCallSummaryData } from './services/post-call/PostCallSummaryGenerator';
import { generatePostCallLlmEnhancements } from './services/post-call/PostCallLlmEnhancements';
import { buildDynamicActionArtifacts } from './services/dynamic-actions/DynamicActionArtifacts';
import { telemetryService } from './services/telemetry/TelemetryService';
import type { ProviderDataScopePolicy } from './llm/ProviderRouter';
const crypto = require('crypto');

const DEFAULT_MEETING_TITLE = '会议纪要';
const MAX_MEETING_TITLE_CHARS = 32;

function looksLikeSummaryBody(text: string): boolean {
    return /(^|\n)\s*#{1,6}\s|\n\s*(?:[-*]|\d+\.|[一二三四五六七八九十]+[、.])\s|关键行动项|后续里程碑|核心需求拆解|行动项|会议就到这里|感谢各位|输出《|准确率≥|####/i.test(text);
}

function compactMeetingTitle(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^[#>*\-\s]+/gm, '')
        .replace(/\*\*/g, '')
        .replace(/["'“”‘’`]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[。；;，,：:、\-\s]+$/g, '')
        .trim();
}

function fallbackTitleFromContext(context: string): string {
    const compact = compactMeetingTitle(context);
    if (!compact) return DEFAULT_MEETING_TITLE;

    const match = compact.match(/(?:围绕|关于|讨论|推进|确认|梳理)([^。；;，,]{2,24})/);
    if (match?.[1]) return compactMeetingTitle(match[1]).slice(0, MAX_MEETING_TITLE_CHARS) || DEFAULT_MEETING_TITLE;

    return compact.slice(0, MAX_MEETING_TITLE_CHARS) || DEFAULT_MEETING_TITLE;
}

function sanitizeGeneratedMeetingTitle(rawTitle: string | null | undefined, context: string): string {
    const raw = (rawTitle ?? '').trim();
    if (!raw) return fallbackTitleFromContext(context);

    if (looksLikeSummaryBody(raw)) return fallbackTitleFromContext(context);

    const firstUsefulLine = raw
        .split(/\r?\n/)
        .map(compactMeetingTitle)
        .find((line) => line.length > 0) ?? '';
    if (!firstUsefulLine) return fallbackTitleFromContext(context);

    const title = firstUsefulLine.slice(0, MAX_MEETING_TITLE_CHARS).trim();
    return title || fallbackTitleFromContext(context);
}

export class MeetingPersistence {
    private session: SessionTracker;
    private llmHelper: LLMHelper;

    constructor(session: SessionTracker, llmHelper: LLMHelper) {
        this.session = session;
        this.llmHelper = llmHelper;
    }

    /**
     * Stops the meeting immediately, snapshots data, and triggers background processing.
     * Returns immediately so UI can switch.
     */
    public async stopMeeting(): Promise<string | null> {
        console.log('[MeetingPersistence] Stopping meeting and queueing save...');

        // 0. Force-save any pending interim transcript
        this.session.flushInterimTranscript();

        // 1. Snapshot valid data BEFORE resetting
        const durationMs = Date.now() - this.session.getSessionStartTime();
        if (durationMs < 1000) {
            console.log("Meeting too short, ignoring.");
            this.session.reset();
            return null;
        }

        // Phase 9 — privacy gate: 'never' retention or per-meeting do-not-persist
        // skips persistence entirely. We still emit telemetry (sanitized) so
        // usage analytics work, but NO transcript / NO summary / NO DB row.
        let doNotPersist = false;
        try {
            const { SettingsManager } = require('./services/SettingsManager');
            const retention = SettingsManager.getInstance().get('meetingRetention');
            if (retention === 'never') doNotPersist = true;
            // Per-meeting toggle is read from SessionTracker meeting metadata
            // (e.g. set via the renderer "Do not persist this meeting" toggle).
            const meta = this.session.getMeetingMetadata?.();
            if (meta && (meta as any).doNotPersist === true) doNotPersist = true;
        } catch (err) {
            console.error('[MeetingPersistence] Failed to read retention settings, defaulting to discard for safety:', err);
            doNotPersist = true; // Fail-secure fallback
        }
        if (doNotPersist) {
            console.log('[MeetingPersistence] doNotPersist set — skipping save (no DB row, no summary).');
            try {
                const { telemetryService } = require('./services/telemetry/TelemetryService');
                telemetryService.track({
                    name: 'meeting_stop',
                    properties: { persisted: false, reason: 'do_not_persist', durationMs },
                });
            } catch { /* non-fatal */ }
            this.session.reset();
            return null;
        }

        const snapshot = {
            transcript: [...this.session.getFullTranscript()],
            usage: [...this.session.getFullUsage()],
            startTime: this.session.getSessionStartTime(),
            durationMs: durationMs,
            context: this.session.getFullSessionContext()
        };

        // BUG-04 fix: snapshot metadata BEFORE reset() clears it so the
        // background processAndSaveMeeting worker receives the calendar info.
        const metadataSnapshot = this.session.getMeetingMetadata();

        // BUG-MODE-BLEEDING fix: snapshot the active mode BEFORE reset() so the
        // background processAndSaveMeeting worker uses the correct mode's note
        // sections even if the user switches modes before async processing completes.
        let modeSnapshot: { id: string; name: string; templateType: string } | null = null;
        try {
            const { ModesManager } = require('./services/ModesManager');
            const activeMode = ModesManager.getInstance().getActiveMode();
            if (activeMode) {
                modeSnapshot = { id: activeMode.id, name: activeMode.name, templateType: activeMode.templateType };
                console.log(`[MeetingPersistence] Mode snapshot captured: "${activeMode.name}" (${activeMode.templateType})`);
            }
        } catch (modeErr: any) {
            console.warn('[MeetingPersistence] Failed to capture mode snapshot:', modeErr?.message);
        }

        // 2. Reset state immediately so new meeting can start or UI is clean
        this.session.reset();

        const meetingId = crypto.randomUUID();

        // 4. Initial Save (Placeholder)
        const minutes = Math.floor(durationMs / 60000);
        const seconds = ((durationMs % 60000) / 1000).toFixed(0);
        const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

        const placeholder: Meeting = {
            id: meetingId,
            title: "Processing...",
            date: new Date().toISOString(),
            duration: durationStr,
            summary: "Generating summary...",
            detailedSummary: { actionItems: [], keyPoints: [] },
            transcript: snapshot.transcript,
            usage: snapshot.usage,
            isProcessed: false
        };

        try {
            DatabaseManager.getInstance().saveMeeting(placeholder, snapshot.startTime, durationMs);
            // Notify Frontend
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));
        } catch (e) {
            console.error("Failed to save placeholder", e);
        }

        this.processAndSaveMeeting(snapshot, meetingId, metadataSnapshot, modeSnapshot).catch(err => {
            console.error('[MeetingPersistence] Background processing failed:', err);
        });

        return meetingId;
    }

    /**
     * Heavy lifting: LLM Title, Summary, and DB Write
     */
    private async processAndSaveMeeting(
        data: { transcript: TranscriptSegment[], usage: any[], startTime: number, durationMs: number, context: string },
        meetingId: string,
        // BUG-04 fix: accept metadata snapshot so calendar info is not lost after session.reset()
        metadata?: { title?: string; calendarEventId?: string; source?: 'manual' | 'calendar' } | null,
        // BUG-MODE-BLEEDING fix: accept mode snapshot so async summary uses the mode that was
        // active when meeting stopped, not whatever mode is active when async processing runs.
        modeSnapshot?: { id: string; name: string; templateType: string } | null
    ): Promise<void> {
        let title = "Untitled Session";
        let summaryData: PostCallSummaryData = { actionItems: [], keyPoints: [], decisions: [], openQuestions: [] };
        const hasSummarizableTranscript = data.transcript.length > 2;
        // Phase 6 — post_call_summary lifecycle telemetry. Wrapped in try/catch
        // around track calls so a telemetry sink fault never breaks persistence.
        const _postCallStart = Date.now();
        try {
            telemetryService.track({
                name: 'post_call_summary_started',
                modeId: modeSnapshot?.id,
                properties: {
                    modeTemplateType: modeSnapshot?.templateType,
                    transcriptSegmentCount: data.transcript.length,
                    durationMs: data.durationMs,
                },
            });
        } catch { /* non-fatal */ }

        // Use passed-in metadata snapshot (NOT this.session.getMeetingMetadata() which is already cleared)
        let calendarEventId: string | undefined;
        let source: 'manual' | 'calendar' = 'manual';

        if (metadata) {
            if (metadata.title) title = metadata.title;
            if (metadata.calendarEventId) calendarEventId = metadata.calendarEventId;
            if (metadata.source) source = metadata.source;
        }

        try {
            // Generate Title (only if not set by calendar)
            if (hasSummarizableTranscript && (!metadata || !metadata.title)) {
                const titlePrompt = `为这次会议生成一个简洁的中文标题，长度为 3 到 8 个中文词。只输出标题文本，不要解释，不要引号，不要 markdown，不要包含任何中英文标点符号。`;
                const groqTitlePrompt = GROQ_TITLE_PROMPT;

                try {
                    const generatedTitle = await this.llmHelper.generateMeetingSummary(titlePrompt, data.context.substring(0, 5000), groqTitlePrompt);
                    title = sanitizeGeneratedMeetingTitle(generatedTitle, data.context);
                } catch (error) {
                    console.warn('[MeetingPersistence] Title generation failed; continuing with fallback title', {
                        errorName: error instanceof Error ? error.name : 'UnknownError',
                    });
                }
            }

            // Load template note sections for the mode that was active when meeting stopped.
            // BUG-MODE-BLEEDING fix: use the snapshotted mode, not getActiveMode() which may
            // return a different mode if the user switched modes before async processing completed.
            let modeNoteSections: Array<{ title: string; description: string }> = [];
            let modeContextBlock = '';
            try {
                const { ModesManager, TEMPLATE_NOTE_SECTIONS } = require('./services/ModesManager');
                const modesMgr = ModesManager.getInstance();

                // Use snapshot mode if available, otherwise fall back to current active mode (for recovery scenarios)
                const targetModeId = modeSnapshot?.id ?? modesMgr.getActiveMode()?.id;
                if (!targetModeId) {
                    console.log('[MeetingPersistence] No mode active — using generic summary.');
                } else {
                    // Get the mode's templateType from snapshot or look it up
                    const templateType = modeSnapshot?.templateType ?? modesMgr.getModes().find((m: { id: string; templateType?: string }) => m.id === targetModeId)?.templateType;
                    const modeName = modeSnapshot?.name ?? modesMgr.getModes().find((m: { id: string; name?: string }) => m.id === targetModeId)?.name ?? 'Unknown';

                    // Prefer user's customized DB sections; fall back to canonical template
                    const dbSections: Array<{ title: string; description: string }> = modesMgr.getNoteSections(targetModeId);
                    modeNoteSections = dbSections.length > 0
                        ? dbSections
                        : (templateType ? (TEMPLATE_NOTE_SECTIONS[templateType as keyof typeof TEMPLATE_NOTE_SECTIONS] ?? []) : []);
                    console.log(`[MeetingPersistence] Summary mode: "${modeName}" (${templateType}), sections: ${modeNoteSections.length} (${dbSections.length > 0 ? 'custom DB' : 'canonical template'})`);

                    // Build the summary-safe mode context block.
                    // Phase 6 — never inject raw reference-file bodies into post-call summary
                    // prompts. Use ModesManager.buildSummarySafeModeContextBlock(), which keeps
                    // the mode's customContext (trusted, low-token) and only adds retrieved
                    // reference snippets. Honors the providerDataScopes policy:
                    //   - `post_call_summary === false` → no mode context at all
                    //   - `reference_files === false`   → customContext only, no retrieved snippets
                    if (modeSnapshot) {
                        let scopePolicy: ProviderDataScopePolicy | undefined = undefined;
                        try {
                            const { SettingsManager } = require('./services/SettingsManager');
                            scopePolicy = SettingsManager.getInstance().get('providerDataScopes');
                        } catch { /* non-fatal */ }
                        const summaryAllowed = scopePolicy?.post_call_summary !== false;
                        const referenceSnippetsAllowed = scopePolicy?.reference_files !== false;

                        if (summaryAllowed) {
                            const transcriptHint = data.context.substring(0, 4000);
                            modeContextBlock = modesMgr.buildSummarySafeModeContextBlock(modeSnapshot.id, {
                                query: 'meeting summary',
                                transcript: transcriptHint,
                                tokenBudget: 1200,
                                includeReferenceSnippets: referenceSnippetsAllowed,
                            }) || '';
                        } else {
                            console.warn('[ScopeFallback] post_call_summary denied for cloud; routing to Ollama');
                            modeContextBlock = '';
                        }
                    }
                }
            } catch (modeErr: any) {
                console.warn('[MeetingPersistence] Failed to load mode sections:', modeErr?.message);
            }

            // Generate Structured Summary
            if (hasSummarizableTranscript) {
                const baseRules = `规则：
- 只基于会议中实际出现的信息总结，不编造未提到的事实、数字、结论或责任人。
- 可以自动纠正明显的转录错别字、同音误识别、拼写错误和常见中英文术语识别错误，但不得改变原意；无法确定时保留原表达。
- 对金额、日期、数量、公司名、人名、系统名、合同条款等高风险信息，不要自行猜测修正；只有上下文非常明确时才可规范化。
- 可以提炼会议中明确或高度确定的隐含行动项，但不能把泛泛的“后面看看”“再确认一下”“有机会聊”自动写成行动项。
- 行动项应尽量包含执行人、动作、交付物、时间点或验证方式；缺失关键信息时，放入待确认事项，而不是强行补全。
- 决策项只记录已经明确达成一致、确认、选定、批准或否定的内容。
- 过滤口语填充词、重复表达、语气词和转录噪音，例如“嗯”“啊”“就是说”“然后呢”“我我我”。
- 保留业务事实、客户诉求、约束条件、风险、异议、决策、行动项和待确认问题。
- 不解释或定义会议中提到的概念、系统、缩写或行业术语，除非会议中有人明确解释过。
- 不使用“会议涵盖了”“讨论了各种”“大家围绕”等空泛套话。
- 不提及转录、AI、模型或摘要生成过程。
- 不输出英文标题或英文模板句，除非会议原文中的专有名词必须保留。
- 语气像一位资深产品经理写给内部团队的会议笔记。

风格：
- 使用简体中文。
- 冷静、中立、专业，便于快速浏览。
- 每条 bullet 只表达一个具体事实、结论、风险或动作。
- bullet 要短，不使用子 bullet。
- 优先写具体信息，避免抽象概括。`;

                let groqSummaryPrompt: string;

                if (modeNoteSections.length > 0) {
                    console.log('[MeetingPersistence] Using mode-specific prompt with sections:', modeNoteSections.map(s => s.title));
                    groqSummaryPrompt = GROQ_SUMMARY_JSON_PROMPT;
                } else {
                    groqSummaryPrompt = GROQ_SUMMARY_JSON_PROMPT;
                }

                summaryData = await generateFullTranscriptSummary({
                    llmHelper: this.llmHelper,
                    transcript: data.transcript,
                    context: data.context,
                    modeTemplateType: modeSnapshot?.templateType,
                    modeNoteSections,
                    modeContextBlock,
                    baseRules,
                    groqSummaryPrompt,
                });
            } else {
                console.log("Transcript too short for summary generation.");
            }

            const dynamicActionArtifacts = buildDynamicActionArtifacts({
                actions: buildDynamicActionArtifactActionsFromUsage(data.usage),
                usage: data.usage,
            });

            const deterministicPostCall = buildPostCallEnhancements({
                transcript: data.transcript,
                modeTemplateType: modeSnapshot?.templateType,
                summaryData,
                dynamicActionArtifacts,
            });
            const llmEnhancements = await generatePostCallLlmEnhancements({
                llmHelper: this.llmHelper,
                transcript: data.transcript,
                modeTemplateType: modeSnapshot?.templateType,
                summaryData,
                deterministicEnhancements: deterministicPostCall,
            });

            summaryData = {
                ...summaryData,
                ...deterministicPostCall,
                ...llmEnhancements,
            };
        } catch (e) {
            console.error("Error generating meeting metadata", e);
        }

        try {
            const minutes = Math.floor(data.durationMs / 60000);
            const seconds = ((data.durationMs % 60000) / 1000).toFixed(0);
            const durationStr = `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;

            const meetingData: Meeting = {
                id: meetingId,
                title: title,
                date: new Date().toISOString(),
                duration: durationStr,
                summary: "See detailed summary",
                detailedSummary: summaryData,
                transcript: data.transcript,
                usage: data.usage,
                calendarEventId: calendarEventId,
                source: source,
                isProcessed: true
            };

            DatabaseManager.getInstance().saveMeeting(meetingData, data.startTime, data.durationMs);

            // Metadata was already snapshotted before session.reset() — nothing to clear here.

            // Notify Frontend to refresh list
            const wins = require('electron').BrowserWindow.getAllWindows();
            wins.forEach((w: any) => w.webContents.send('meetings-updated'));

            // Phase 6 — post_call_summary_completed (no transcript / no summary text;
            // counts and durations only).
            try {
                const enhancements = (summaryData as any) || {};
                telemetryService.track({
                    name: 'post_call_summary_completed',
                    modeId: modeSnapshot?.id,
                    durationMs: Date.now() - _postCallStart,
                    properties: {
                        modeTemplateType: modeSnapshot?.templateType,
                        actionItemCount: Array.isArray(enhancements.actionItemsStructured) ? enhancements.actionItemsStructured.length : 0,
                        coachingInsightCount: Array.isArray(enhancements.coachingInsights) ? enhancements.coachingInsights.length : 0,
                        sectionsCount: Array.isArray(enhancements.sections) ? enhancements.sections.length : 0,
                    },
                });
            } catch { /* non-fatal */ }

        } catch (error) {
            console.error('[MeetingPersistence] Failed to save meeting:', error);
            try {
                telemetryService.track({
                    name: 'post_call_summary_failed',
                    modeId: modeSnapshot?.id,
                    durationMs: Date.now() - _postCallStart,
                    properties: { errorClass: (error as Error)?.constructor?.name ?? 'Unknown' },
                });
            } catch { /* non-fatal */ }
        }
    }

    /**
     * Recover meetings that were started but not fully processed (e.g. app crash)
     */
    public async recoverUnprocessedMeetings(): Promise<void> {
        console.log('[MeetingPersistence] Checking for unprocessed meetings...');
        const db = DatabaseManager.getInstance();
        const unprocessed = db.getUnprocessedMeetings();

        if (unprocessed.length === 0) {
            console.log('[MeetingPersistence] No unprocessed meetings found.');
            return;
        }

        console.log(`[MeetingPersistence] Found ${unprocessed.length} unprocessed meetings. recovering...`);

        for (const m of unprocessed) {
            try {
                const details = db.getMeetingDetails(m.id);
                if (!details) continue;

                console.log(`[MeetingPersistence] Recovering meeting ${m.id}...`);

                const context = details.transcript?.map(t => {
                    const label = t.speaker === 'interviewer' ? 'INTERVIEWER' :
                        t.speaker === 'user' ? 'ME' : 'ASSISTANT';
                    return `[${label}]: ${t.text}`;
                }).join('\n') || "";

                const parts = (details.duration || '0:00').split(':');
                // EC-07 fix: guard against malformed duration strings (e.g. corrupted DB row)
                const mins = parseInt(parts[0]) || 0;
                const secs = parseInt(parts[1]) || 0;
                const durationMs = ((mins * 60) + secs) * 1000;
                const startTime = new Date(details.date).getTime();

                const snapshot = {
                    transcript: details.transcript as TranscriptSegment[],
                    usage: details.usage,
                    startTime: startTime,
                    durationMs: durationMs,
                    context: context
                };

                await this.processAndSaveMeeting(snapshot, m.id);
                console.log(`[MeetingPersistence] Recovered meeting ${m.id}`);

            } catch (e) {
                console.error(`[MeetingPersistence] Failed to recover meeting ${m.id}`, e);
            }
        }
    }
}

export function buildDynamicActionArtifactActionsFromUsage(usage: any[]): Array<{
    id: string;
    parentActionId?: string;
    sourceIntent?: string;
    modeTemplateType: string;
    type: string;
    productContract: { outputType: any };
    status: string;
    createdAt: number;
    latestTurn?: string;
    retrievalQuery?: string;
    triggerSource?: 'manual' | 'auto_countdown';
}> {
    const actionsById = new Map<string, {
        id: string;
        parentActionId?: string;
        sourceIntent?: string;
        modeTemplateType: string;
        type: string;
        productContract: { outputType: any };
        status: string;
        createdAt: number;
        latestTurn?: string;
        retrievalQuery?: string;
        triggerSource?: 'manual' | 'auto_countdown';
    }>();

    for (const item of usage) {
        const metadata = item?.metadata;
        if (!metadata || typeof metadata !== 'object') continue;

        if (metadata.source !== 'dynamic_action') continue;

        const actionId = typeof metadata.actionId === 'string' ? metadata.actionId.trim() : '';
        const modeTemplateType = typeof metadata.modeTemplateType === 'string' ? metadata.modeTemplateType.trim() : '';
        const actionType = typeof metadata.actionType === 'string'
            ? metadata.actionType.trim()
            : '';
        const outputType = typeof metadata.outputType === 'string' ? metadata.outputType.trim() : '';
        const parentActionId = typeof metadata.parentActionId === 'string' ? metadata.parentActionId.trim() : '';
        const sourceIntent = typeof metadata.sourceIntent === 'string' ? metadata.sourceIntent.trim() : '';
        const createdAt = typeof item?.timestamp === 'number' ? item.timestamp : 0;
        const generationStatus = normalizeDynamicActionGenerationStatus(item);
        const triggerSource = normalizeDynamicActionTriggerSource(metadata.triggerSource);

        if (!actionId || !actionType || !outputType) continue;

        const latestTurn =
            typeof metadata.latestTurn === 'string'
                ? metadata.latestTurn
                : typeof item?.question === 'string'
                    ? item.question
                    : undefined;
        const retrievalQuery =
            typeof metadata.retrievalQuery === 'string'
                ? metadata.retrievalQuery
                : typeof item?.question === 'string'
                    ? item.question
                    : undefined;
        const existing = actionsById.get(actionId);
        if (!existing) {
            actionsById.set(actionId, {
                id: actionId,
                ...(parentActionId ? { parentActionId } : {}),
                ...(sourceIntent ? { sourceIntent } : {}),
                modeTemplateType,
                type: actionType,
                productContract: { outputType },
                status: generationStatus,
                createdAt,
                latestTurn,
                retrievalQuery,
                ...(triggerSource ? { triggerSource } : {}),
            });
            continue;
        }

        if (dynamicActionStatusPriority(generationStatus) > dynamicActionStatusPriority(existing.status)) {
            existing.status = generationStatus;
        }
        if (!existing.modeTemplateType && modeTemplateType) existing.modeTemplateType = modeTemplateType;
        if (!existing.type && actionType) existing.type = actionType;
        if (!existing.parentActionId && parentActionId) existing.parentActionId = parentActionId;
        if (!existing.sourceIntent && sourceIntent) existing.sourceIntent = sourceIntent;
        if (!existing.productContract?.outputType && outputType) existing.productContract = { outputType };
        if ((!existing.createdAt || createdAt < existing.createdAt) && createdAt > 0) existing.createdAt = createdAt;
        if (!existing.latestTurn && latestTurn) existing.latestTurn = latestTurn;
        if (!existing.retrievalQuery && retrievalQuery) existing.retrievalQuery = retrievalQuery;
        if (!existing.triggerSource && triggerSource) existing.triggerSource = triggerSource;
    }

    return Array.from(actionsById.values());
}

function normalizeDynamicActionTriggerSource(value: unknown): 'manual' | 'auto_countdown' | undefined {
    return value === 'manual' || value === 'auto_countdown' ? value : undefined;
}

function normalizeDynamicActionGenerationStatus(item: any): 'accepted' | 'auto_generated' | 'generated_failed' | 'completed' {
    const status = typeof item?.metadata?.generationStatus === 'string'
        ? item.metadata.generationStatus.trim()
        : '';
    if (status === 'accepted' || status === 'auto_generated' || status === 'generated_failed' || status === 'completed') {
        return status;
    }
    const answer = item?.answer;
    if (typeof answer === 'string' && answer.trim()) return 'completed';
    if (Array.isArray(answer) && answer.some((part) => typeof part === 'string' && part.trim())) return 'completed';
    return 'accepted';
}

function dynamicActionStatusPriority(status: string): number {
    switch (status) {
        case 'completed':
            return 4;
        case 'generated_failed':
            return 3;
        case 'auto_generated':
            return 2;
        case 'accepted':
        default:
            return 1;
    }
}
