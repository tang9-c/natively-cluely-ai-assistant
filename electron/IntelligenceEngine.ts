// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker, TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
import {
    AnswerLLM, AssistLLM, BrainstormLLM, ClarifyLLM, CodeHintLLM, RecapLLM,
    WhatToAnswerLLM,
    prepareTranscriptForWhatToAnswer, buildTemporalContext,
    AssistantResponse as LLMAssistantResponse, classifyIntent, planNextAssistantAction, PlannerDecision
} from './llm';
import type { ModeEventContext } from './llm';
import type { WhatToAnswerTraceSink } from './llm/WhatToAnswerLLM';
import type { CodeHintTrace } from './llm/CodeHintLLM';
import type { ProviderDataScope } from './llm/ProviderRouter';
import type { TranscriptTurn } from './llm';
import type {
    CloudIntentClassifierInput,
    CloudIntentClassifierResult,
    IntentClassificationOptions,
} from './llm/IntentClassifier';
import { DynamicActionEngine } from './services/dynamic-actions/DynamicActionEngine';
import { DynamicAction } from './services/dynamic-actions/DynamicAction';
import type { DynamicActionOutputType } from './services/dynamic-actions/DynamicAction';
import {
    CloudSemanticGateError,
    cloudFailureReasonFromError,
    type CloudSemanticGateInput,
    type CloudSemanticGateResult,
    type ModeEventContextTurn,
    type SemanticGateTrace,
} from './services/dynamic-actions/ModeEventClassifier';
import { ScreenContext } from './services/screen/types';
import { SettingsManager, type AppSettings } from './services/SettingsManager';
import { SkillActivationManager } from './services/SkillActivationManager';
import { SkillsManager } from './services/SkillsManager';
import { SkillWatcherService, type SkillWatcherSuggestion } from './services/SkillWatcherService';
import { isLocalIntentClassifierAvailable } from './services/LocalModelManager';
import { ModesManager } from './services/ModesManager';
import { keywordRowsToMap } from './llm/IntentKeywordDefaults';
import { evaluateSpeakerContextForAnswer } from './services/context/SpeakerContextPolicy';
import { getContextQualityDiagnosticsCollector } from './services/eval/ContextQualityDiagnostics';

// Mode types
export type IntelligenceMode = 'idle' | 'assist' | 'what_to_say' | 'recap' | 'clarify' | 'manual' | 'code_hint' | 'brainstorm';

// Refinement intent detection (refined to avoid false positives)
function detectRefinementIntent(userText: string): { isRefinement: boolean; intent: string } {
    const lowercased = userText.toLowerCase().trim();
    const refinementPatterns = [
        { pattern: /make it longer|expand on this|elaborate more/i, intent: 'expand' },
        { pattern: /rephrase that|say it differently|put it another way/i, intent: 'rephrase' },
        { pattern: /give me an example|provide an instance/i, intent: 'add_example' },
        { pattern: /make it more confident|be more assertive|sound stronger/i, intent: 'more_confident' },
        { pattern: /make it casual|be less formal|sound relaxed/i, intent: 'more_casual' },
        { pattern: /make it formal|be more professional|sound professional/i, intent: 'more_formal' },
        { pattern: /simplify this|make it simpler|explain specifically/i, intent: 'simplify' },
    ];

    for (const { pattern, intent } of refinementPatterns) {
        if (pattern.test(lowercased)) {
            return { isRefinement: true, intent };
        }
    }

    return { isRefinement: false, intent: '' };
}

// Events emitted by IntelligenceEngine
export interface IntelligenceModeEvents {
    'assist_update': (insight: string) => void;
    'suggested_answer': (answer: string, question: string, confidence: number) => void;
    'suggested_answer_token': (token: string, question: string, confidence: number) => void;
    'refined_answer': (answer: string, intent: string) => void;
    'refined_answer_token': (token: string, intent: string) => void;
    'recap': (summary: string) => void;
    'recap_token': (token: string) => void;
    'clarify': (clarification: string) => void;
    'clarify_token': (token: string) => void;
    'manual_answer_started': () => void;
    'manual_answer_result': (answer: string, question: string) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode) => void;
    // ARCHITECTURE: dedicated channel for live negotiation coaching payloads.
    // Previously the coaching JSON was multiplexed into the suggested_answer
    // / suggested_answer_token streams as a sentinel-string, which forced the
    // renderer to JSON.parse every streaming token to detect the marker.
    // Splitting the channel removes that hack and gives coaching its own
    // typed payload.
    'negotiation_coaching': (payload: unknown) => void;
    // Phase 3: Cluely-style auto-detected action card. Engine emits one per
    // newly created candidate action (post-dedupe). Renderer subscribes via
    // window.electronAPI.onIntelligenceDynamicAction and renders cards.
    'dynamic_action_emitted': (action: DynamicAction) => void;
    'dynamic_action_gate_trace': (trace: SemanticGateTrace) => void;
    'code_hint_trace': (trace: CodeHintTrace) => void;
    'skill_watcher_suggestion_created': (suggestion: SkillWatcherSuggestion) => void;
}

/**
 * Structured result for `runClarify()`.
 *
 * Replaces the previous `string | null` signature so callers (and ultimately
 * the IPC layer) can surface a real failure reason to the user instead of
 * papering over every failure with the misleading "no audio context" message.
 */
export type ClarifyFailureReason = 'no_llm' | 'aborted' | 'empty' | 'error';

export type ClarifyResult =
    | { ok: true; clarification: string }
    | { ok: false; reason: ClarifyFailureReason; detail?: string };

export interface RunCodeHintOptions {
    requestedDataScopes?: ProviderDataScope[];
}

const WHAT_TO_ANSWER_FALLBACK = "Could you repeat that? I want to make sure I address your question properly.";
const WHAT_TO_ANSWER_LABEL_EN = 'What to Answer';
const WHAT_TO_ANSWER_LABEL_ZH = '待回答内容';

export class IntelligenceEngine extends EventEmitter {
    // Mode state
    private activeMode: IntelligenceMode = 'idle';

    // Mode-specific LLMs
    private answerLLM: AnswerLLM | null = null;
    private assistLLM: AssistLLM | null = null;
    private clarifyLLM: ClarifyLLM | null = null;
    private recapLLM: RecapLLM | null = null;
    private whatToAnswerLLM: WhatToAnswerLLM | null = null;
    private codeHintLLM: CodeHintLLM | null = null;
    private brainstormLLM: BrainstormLLM | null = null;

    // Concurrency tracking
    private assistCancellationToken: AbortController | null = null;
    private currentGenerationId: number = 0;

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Reference to SessionTracker for context
    private session: SessionTracker;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds

    // Speculative inference: start LLM on high-confidence interviewer partials
    private speculativeTimer: ReturnType<typeof setTimeout> | null = null;
    private speculativeText: string | null = null;
    // epoch ms after which speculativeText is stale; Infinity while stream is still running
    private speculativeTextExpiry: number = Infinity;
    private readonly SPECULATIVE_DEBOUNCE_MS = 350;
    private readonly SPECULATIVE_MIN_WORDS = 7;
    private readonly SPECULATIVE_MIN_CONFIDENCE = 0.75;
    private readonly SPECULATIVE_SIMILARITY_THRESHOLD = 0.75;

    // Phase 3 dynamic actions — engine state. Created lazily on first
    // setSessionContext call (or per-test injection). Null while engine has no
    // active meeting, so detectAndEmitDynamicActions becomes a no-op safely.
    private dynamicActionEngine: DynamicActionEngine | null = null;
    private currentSessionId: string | null = null;
    private currentDynamicActionModeId: string | null = null;
    private currentDynamicActionTemplateType: string | null = null;
    private intentClassificationOptionsForTest: IntentClassificationOptions | null = null;

    private static isNonAnswerSentinel(answer: string): boolean {
        const normalized = answer.trim().toLowerCase().replace(/[.!?。！？\s]+$/g, '');
        return normalized === 'nothing actionable right now'
            || normalized === 'nothing to capture right now'
            || normalized === WHAT_TO_ANSWER_FALLBACK.toLowerCase().replace(/[.!?。！？\s]+$/g, '');
    }

    private static inferUsageQuestionLabel(question: string | undefined, transcript: string): string {
        if (question?.trim()) return question.trim();
        return IntelligenceEngine.cjkCharCount(transcript) > 0
            ? WHAT_TO_ANSWER_LABEL_ZH
            : WHAT_TO_ANSWER_LABEL_EN;
    }

    private static normalizeSuggestedAnswer(answer: string): string {
        const normalized = answer.replace(/\r\n/g, '\n').trim();
        const nonEmptyLines = normalized
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        if (nonEmptyLines.length < 4) {
            return normalized.replace(/\n{3,}/g, '\n\n');
        }

        const shortLineCount = nonEmptyLines.filter((line) => line.length <= 6).length;
        const mostlyShortLines = shortLineCount / nonEmptyLines.length >= 0.6;
        const mostlyCjkFragments =
            nonEmptyLines.filter((line) => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{P}\p{Zs}A-Za-z0-9]+$/u.test(line)).length /
                nonEmptyLines.length >=
            0.6;

        if (!mostlyShortLines) {
            return normalized.replace(/\n{3,}/g, '\n\n');
        }

        const joiner = mostlyCjkFragments ? '' : ' ';
        return nonEmptyLines
            .join(joiner)
            .replace(/\s+([，。！？；：、,.!?;:])/g, '$1')
            .replace(/([（《“‘(])\s+/g, '$1')
            .replace(/\s+([）》”’)])/g, '$1')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private buildIntentClassificationOptions(): IntentClassificationOptions {
        if (this.intentClassificationOptionsForTest) {
            return this.intentClassificationOptionsForTest;
        }
        let providerDataScopes: IntentClassificationOptions['providerDataScopes'];
        let localIntentEnhancementEnabled = false;
        let localIntentEnhancementAvailable = false;
        let customIntentKeywords: IntentClassificationOptions['customIntentKeywords'];

        try {
            const settings = SettingsManager.getInstance();
            providerDataScopes = settings.get('providerDataScopes');
            localIntentEnhancementEnabled = settings.getLocalIntentEnhancementEnabled();
            localIntentEnhancementAvailable = isLocalIntentClassifierAvailable();
            const activeMode = ModesManager.getInstance().getActiveMode();
            if (activeMode?.intentKeywords?.length) {
                customIntentKeywords = keywordRowsToMap(activeMode.intentKeywords);
            }
        } catch (error) {
            console.warn('[IntelligenceEngine] Intent settings unavailable', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return {
            providerDataScopes,
            localIntentEnhancementEnabled,
            localIntentEnhancementAvailable,
            customIntentKeywords,
            cloudIntentClassifier: (input) => this.classifyIntentWithCloud(input),
        };
    }

    private async classifyIntentWithCloud(
        input: CloudIntentClassifierInput,
    ): Promise<CloudIntentClassifierResult | null> {
        const candidateSet = new Set(input.candidateIntents);
        const prompt = [
            '你是会议实时助手的意图分类器，只返回 JSON，不生成回答建议。',
            '根据最新一句中文原文、最近短上下文、当前模式、候选 intent 和轻量实体，选择最合适的 intent。',
            '只能从 candidateIntents 中选择 intent。confidence 必须是 0 到 1 的数字。',
            '如果证据不足，选择 general 或 silence，并降低 confidence。',
            '',
            `modeTemplateType: ${input.modeTemplateType ?? 'general'}`,
            `candidateIntents: ${JSON.stringify(input.candidateIntents)}`,
            `keyEntities: ${JSON.stringify(input.keyEntities)}`,
            `latestTurn: ${JSON.stringify(input.latestTurn)}`,
            `recentTranscript: ${JSON.stringify(input.recentTranscript.slice(-1600))}`,
            '',
            '返回格式: {"intent":"...","confidence":0.0}',
        ].join('\n');

        try {
            const raw = await this.llmHelper.generateContentStructured(prompt, {
                taskLabel: 'intent-classification',
                maxOutputTokens: 96,
                perProviderTimeoutMs: 2500,
                maxRotations: 1,
            });
            const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
            if (!jsonText) return null;

            const parsed = JSON.parse(jsonText) as Partial<CloudIntentClassifierResult>;
            const intent = parsed.intent;
            const confidence = Number(parsed.confidence);
            if (!intent || !candidateSet.has(intent) || !Number.isFinite(confidence)) {
                return null;
            }
            return {
                intent,
                confidence: Math.max(0, Math.min(1, confidence)),
            };
        } catch (error) {
            console.warn('[IntelligenceEngine] Cloud intent classifier failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    private buildDynamicActionContextTurns(turns: TranscriptTurn[]): ModeEventContextTurn[] {
        return turns
            .slice(-6)
            .map((turn) => ({
                role: turn.role,
                speaker: turn.speakerLabel ?? turn.speakerId ?? turn.role,
                text: turn.text,
                timestamp: turn.timestamp,
            }));
    }

    private async classifyDynamicActionWithCloud(
        input: CloudSemanticGateInput,
    ): Promise<CloudSemanticGateResult[] | null> {
        const candidateTypes = new Set(input.candidates.map(candidate => candidate.actionType));
        const prompt = [
            '你是会议实时助手的动态动作语义门控，只返回 JSON，不生成回答建议。',
            '根据当前 final transcript、最近几轮上下文、当前 mode、说话人、已有 intentResult 和候选动作，判断每个候选动作是否应该通过。',
            'regex 只是候选来源；必须理解整体语义后再决定 pass、reject 或 defer。',
            '中性提及、被否定、先放一边、只是页面/列表/数据名词，不应触发高风险动作。',
            '只能返回 candidates 中存在的 actionType。confidence 必须是 0 到 1 的数字。',
            '',
            `modeTemplateType: ${input.modeTemplateType}`,
            `speaker: ${input.speaker ?? ''}`,
            `intentResult: ${JSON.stringify(input.intentResult ?? null)}`,
            `currentFinalTranscript: ${JSON.stringify(input.transcript)}`,
            `recentContextTurns: ${JSON.stringify(input.recentContextTurns.slice(-6))}`,
            `candidates: ${JSON.stringify(input.candidates)}`,
            '',
            '返回格式: {"actions":[{"actionType":"...","decision":"pass|reject|defer","confidence":0.0,"semanticIntent":"...","reasons":["..."],"rejectedCandidates":["..."]}]}',
        ].join('\n');

        let raw: string;
        try {
            raw = await this.llmHelper.generateContentStructured(prompt, {
                taskLabel: 'dynamic-action-semantic-gate',
                maxOutputTokens: 256,
                perProviderTimeoutMs: 2500,
                maxRotations: 1,
            });
        } catch (error) {
            throw new CloudSemanticGateError(cloudFailureReasonFromError(error));
        }

        const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonText) throw new CloudSemanticGateError('cloud_invalid_json');

        let parsed: { actions?: Array<Partial<CloudSemanticGateResult>> };
        try {
            parsed = JSON.parse(jsonText) as {
                actions?: Array<Partial<CloudSemanticGateResult>>;
            };
        } catch {
            throw new CloudSemanticGateError('cloud_invalid_json');
        }
        if (!Array.isArray(parsed.actions)) throw new CloudSemanticGateError('cloud_invalid_json');

        const results: CloudSemanticGateResult[] = [];
        for (const item of parsed.actions) {
            const actionType = item.actionType;
            const decision = item.decision;
            const confidence = Number(item.confidence);
            if (!actionType || !candidateTypes.has(actionType)) continue;
            if (decision !== 'pass' && decision !== 'reject' && decision !== 'defer') continue;
            if (!Number.isFinite(confidence)) continue;
            results.push({
                actionType,
                decision,
                confidence: Math.max(0, Math.min(1, confidence)),
                semanticIntent: typeof item.semanticIntent === 'string' ? item.semanticIntent : undefined,
                reasons: Array.isArray(item.reasons)
                    ? item.reasons.filter(reason => typeof reason === 'string').slice(0, 5)
                    : undefined,
                rejectedCandidates: Array.isArray(item.rejectedCandidates)
                    ? item.rejectedCandidates.filter(candidate => typeof candidate === 'string').slice(0, 10)
                    : undefined,
            });
        }
        if (parsed.actions.length > 0 && results.length === 0) throw new CloudSemanticGateError('cloud_invalid_json');
        return results.length > 0 ? results : null;
    }

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.initializeLLMs();

        // Dedicated channel: LLMHelper invokes this when KnowledgeOrchestrator
        // produces a live-negotiation-coaching payload. We forward it on the
        // typed 'negotiation_coaching' event — no in-band JSON sentinels.
        this.llmHelper.setNegotiationCoachingHandler((payload) => {
            this.emit('negotiation_coaching', payload);
        });
    }

    getLLMHelper(): LLMHelper {
        return this.llmHelper;
    }

    getRecapLLM(): RecapLLM | null {
        return this.recapLLM;
    }

    // ============================================
    // LLM Initialization
    // ============================================

    /**
     * Initialize or Re-Initialize mode-specific LLMs with shared Gemini client and Groq client
     * Must be called after API keys are updated.
     */
    initializeLLMs(): void {
        console.log(`[IntelligenceEngine] Initializing LLMs with LLMHelper`);
        this.answerLLM = new AnswerLLM(this.llmHelper);
        this.assistLLM = new AssistLLM(this.llmHelper);
        this.clarifyLLM = new ClarifyLLM(this.llmHelper);
        this.recapLLM = new RecapLLM(this.llmHelper);
        this.whatToAnswerLLM = new WhatToAnswerLLM(this.llmHelper);
        this.codeHintLLM = new CodeHintLLM(this.llmHelper);
        this.brainstormLLM = new BrainstormLLM(this.llmHelper);

        // Sync RecapLLM reference to SessionTracker for epoch compaction
        this.session.setRecapLLM(this.recapLLM);
    }

    reinitializeLLMs(): void {
        this.initializeLLMs();
    }

    // ============================================
    // Transcript Handling (delegates to SessionTracker)
    // ============================================

    private static wordsOf(text: string): Set<string> {
        return new Set(text.toLowerCase().match(/\b\w+\b/g) ?? []);
    }

    private static cjkCharCount(text: string): number {
        return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    }

    // Returns a score in [0,1] that accounts for partial-to-final comparisons.
    // Pure Jaccard underestimates similarity when the speculative text is a prefix of the final
    // transcript (e.g., "Can you walk me through" vs. "Can you walk me through your design process?").
    // We blend Jaccard with a containment score (what fraction of speculative words appear in final).
    private static jaccardSimilarity(a: string, b: string): number {
        const setA = IntelligenceEngine.wordsOf(a);
        const setB = IntelligenceEngine.wordsOf(b);
        if (setA.size === 0 && setB.size === 0) return 1;
        let intersection = 0;
        setA.forEach(w => { if (setB.has(w)) intersection++; });
        const jaccard = intersection / (setA.size + setB.size - intersection);
        // Containment: fraction of setA (speculative/partial) covered by setB (final)
        const containment = setA.size > 0 ? intersection / setA.size : 0;
        return Math.max(jaccard, containment * 0.9); // weight containment slightly below pure Jaccard
    }

    private static hasQuestionSignal(text: string): boolean {
        if (/[?？]\s*$/.test(text)) return true;
        return /\b(what|how|why|where|when|which|who|can you|could you|tell me|explain|describe|walk me through|talk me through)\b/i.test(text)
            || /(什么|怎么|如何|为什么|为何|哪里|什么时候|哪一个|哪个|谁|能不能|可以|可否|请问|解释|说明|描述|讲一下|说一下|介绍一下|展开讲讲|怎么看|你认为|考虑一下|你的问题|我的经验|类似案例|类似情况|类似问题)/u.test(text);
    }

    // Fires speculative LLM inference on a stable high-confidence interviewer partial.
    // Debounced so rapid word-by-word partials don't spawn multiple streams.
    private maybeSpeculate(segment: TranscriptSegment): void {
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') return;

        // Snapshot values now — STT adapters may mutate the same segment object in place.
        const text = segment.text;
        const confidence = segment.confidence ?? 0;
        const words = text.trim().split(/\s+/).filter(Boolean);
        const hasEnoughContent = words.length >= this.SPECULATIVE_MIN_WORDS ||
            IntelligenceEngine.cjkCharCount(text) >= 12;
        if (
            confidence < this.SPECULATIVE_MIN_CONFIDENCE ||
            !hasEnoughContent ||
            !IntelligenceEngine.hasQuestionSignal(text)
        ) return;

        if (this.speculativeTimer !== null) {
            clearTimeout(this.speculativeTimer);
        }

        this.speculativeTimer = setTimeout(() => {
            this.speculativeTimer = null;
            // Re-check mode: a high-priority mode may have started during the debounce window.
            if (this.activeMode !== 'idle' && this.activeMode !== 'assist') return;
            // Don't overwrite a speculative stream that is already in flight.
            if (this.speculativeText !== null) return;
            if (Date.now() - this.lastTriggerTime < this.triggerCooldown) return;
            console.log(`[IntelligenceEngine] Speculative inference fired on interim`, { length: text.length, confidence });
            this.runWhatShouldISay(text, confidence || 0.8, undefined, { speculative: true })
                .catch(err => console.error('[IntelligenceEngine] Speculative run error:', err));
        }, this.SPECULATIVE_DEBOUNCE_MS);
    }

    /**
     * Process transcript from native audio, and trigger follow-up if appropriate
     */
    handleTranscript(segment: TranscriptSegment, skipRefinementCheck: boolean = false): void {
        const result = this.session.handleTranscript(segment);
        this.lastTranscriptTime = Date.now();

        if (segment.speaker !== 'assistant' && !segment.final) {
            this.maybeSpeculate(segment);
        } else if (segment.final && this.speculativeTimer !== null) {
            // Final arrived — cancel debounce; handleSuggestionTrigger will do Jaccard check
            clearTimeout(this.speculativeTimer);
            this.speculativeTimer = null;
        }

        // Phase 3: confirm dynamic action triggers on every final segment.
        // Fire-and-forget by design: intent confirmation is auxiliary and must
        // never block or break the primary transcript path.
        if (segment.final) {
            this.detectConfirmAndEmitDynamicActions(segment).catch((err) => {
                console.warn('[IntelligenceEngine] detectConfirmAndEmitDynamicActions failed', (err as Error)?.message);
            });
            this.runSkillWatcher(segment).catch((err) => {
                console.warn('[IntelligenceEngine] runSkillWatcher failed', (err as Error)?.message);
            });
        }

    }

    // Phase 3 dynamic actions — public API ===========================================================

    /**
     * Bind the engine to the active meeting/mode. Called by IntelligenceManager
     * at meeting start and on every mode switch. Re-binding clears the per-session
     * action store (see ModeBleeding tests) so old-mode candidates do not leak.
     */
    setDynamicActionContext(params: {
        sessionId: string;
        modeId: string;
        modeTemplateType: string;
    }): void {
        const { sessionId, modeId, modeTemplateType } = params;
        if (!this.dynamicActionEngine) {
            this.dynamicActionEngine = new DynamicActionEngine();
        }
        // If session changed, drop store so we don't bleed actions across meetings.
        if (this.currentSessionId && this.currentSessionId !== sessionId) {
            this.dynamicActionEngine = new DynamicActionEngine();
        }
        this.currentSessionId = sessionId;
        this.currentDynamicActionModeId = modeId;
        this.currentDynamicActionTemplateType = modeTemplateType;
    }

    clearDynamicActionContext(): void {
        this.currentSessionId = null;
        this.currentDynamicActionModeId = null;
        this.currentDynamicActionTemplateType = null;
        this.dynamicActionEngine = null;
    }

    acceptDynamicAction(actionId: string, options?: { triggerSource?: import('./services/dynamic-actions/DynamicAction').DynamicActionAcceptTriggerSource }): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        return this.dynamicActionEngine.acceptAction(actionId, options);
    }

    markDynamicActionShown(actionId: string): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        return this.dynamicActionEngine.markShown(actionId);
    }

    completeDynamicAction(actionId: string): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        this.dynamicActionEngine.completeAction(actionId);
        return this.dynamicActionEngine.getStore().getAction(actionId) ?? null;
    }

    markDynamicActionGenerationFailed(actionId: string): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        return this.dynamicActionEngine.markGenerationFailed(actionId);
    }

    dismissDynamicAction(actionId: string): void {
        if (!this.dynamicActionEngine) return;
        this.dynamicActionEngine.dismissAction(actionId);
    }

    getActiveDynamicActions(): DynamicAction[] {
        if (!this.dynamicActionEngine || !this.currentSessionId) return [];
        return this.dynamicActionEngine.getTopActions(this.currentSessionId);
    }

    // For tests — injection seam.
    _setDynamicActionEngineForTest(engine: DynamicActionEngine | null): void {
        this.dynamicActionEngine = engine;
    }

    _setIntentClassificationOptionsForTest(options: IntentClassificationOptions | null): void {
        this.intentClassificationOptionsForTest = options;
    }

    private contextItemToTranscriptTurn(item: ContextItem): TranscriptTurn {
        return {
            role: item.role,
            text: item.text,
            timestamp: item.timestamp,
            speakerId: item.speakerId,
            speakerLabel: item.speakerLabel,
            speakerVerification: item.speakerVerification,
        };
    }

    private buildTranscriptTurns(contextItems: ContextItem[]): TranscriptTurn[] {
        return contextItems.map(item => this.contextItemToTranscriptTurn(item));
    }

    private appendSegmentAnchorIfMissing(
        turns: TranscriptTurn[],
        segment: TranscriptSegment,
        role: TranscriptTurn['role'],
    ): void {
        const text = (segment.text || '').trim();
        if (!text) return;
        const duplicate = turns.some(turn =>
            turn.role === role &&
            turn.text === text &&
            Math.abs(turn.timestamp - segment.timestamp) < 1000
        );
        if (duplicate) return;
        turns.push({
            role,
            text,
            timestamp: segment.timestamp,
            speakerId: segment.speakerId,
            speakerLabel: segment.speakerLabel,
            providerSpeakerId: segment.providerSpeakerId,
            diarizationProvider: segment.diarizationProvider,
            speakerVerification: segment.speakerVerification,
        });
    }

    private async detectConfirmAndEmitDynamicActions(segment: TranscriptSegment): Promise<void> {
        if (!this.dynamicActionEngine || !this.currentSessionId
            || !this.currentDynamicActionModeId || !this.currentDynamicActionTemplateType) {
            return;
        }
        if (segment.speaker !== 'interviewer' && segment.speaker !== 'user') {
            return;
        }
        const text = (segment.text || '').trim();
        if (!text) return;

        const contextItems = this.session.getContext(180);
        const transcriptTurns = this.buildTranscriptTurns(contextItems);
        const anchorRole = segment.speaker === 'user' ? 'user' : 'interviewer';
        this.appendSegmentAnchorIfMissing(transcriptTurns, segment, anchorRole);
        const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);
        const intentOptions = {
            ...this.buildIntentClassificationOptions(),
            cloudFirst: true,
        };
        const intentResult = await classifyIntent(
            text,
            preparedTranscript,
            this.session.getAssistantResponseHistory().length,
            this.currentDynamicActionTemplateType,
            intentOptions,
        );

        const newActions = await this.dynamicActionEngine.assessSignals({
            transcript: text,
            speaker: segment.speaker,
            modeTemplateType: this.currentDynamicActionTemplateType,
            modeId: this.currentDynamicActionModeId,
            sessionId: this.currentSessionId,
            emotion: segment.emotion,
            emotionSource: segment.emotionSource,
            intentResult,
            recentContextTurns: this.buildDynamicActionContextTurns(transcriptTurns),
            providerDataScopes: intentOptions.providerDataScopes,
            cloudClassifier: (input) => this.classifyDynamicActionWithCloud(input),
            semanticGateTraceSink: (trace: SemanticGateTrace) => {
                getContextQualityDiagnosticsCollector().recordDynamicActionTrace(trace);
                this.emit('dynamic_action_gate_trace', trace);
            },
        });

        // The store dedupes within the per-session store, so each emitted action
        // is a *new* candidate — safe to forward to renderer for rendering.
        for (const action of newActions) {
            this.emit('dynamic_action_emitted', action);
        }
    }

    private async runSkillWatcher(segment: TranscriptSegment): Promise<void> {
        if (segment.speaker !== 'interviewer' && segment.speaker !== 'user') {
            return;
        }
        if (!segment.text?.trim()) {
            return;
        }

        const watcher = SkillWatcherService.getInstance();
        const skills = SkillsManager.getInstance().listSkills().map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            source: skill.source,
        }));
        const transcriptWindow = this.session.getFullTranscript().slice(-12).map((item) => ({
            speaker: item.speaker,
            text: item.text,
            timestamp: item.timestamp,
        }));
        const activations = SkillActivationManager.getInstance().listActivations();

        const decision = watcher.evaluate({
            transcriptWindow,
            skills,
            activations,
        });

        if (decision.action === 'activate') {
            SkillActivationManager.getInstance().activateSkill({
                skillId: decision.skillId,
                source: 'auto',
                scope: 'ephemeral',
                ttlMs: 3 * 60 * 1000,
                reason: decision.reason,
            });
            console.log('[Skills] Watcher activated skill', {
                skillId: decision.skillId,
                scope: decision.scope,
                confidence: decision.confidence,
                action: decision.action,
            });
            return;
        }

        if (decision.action === 'suggest') {
            const suggestion = watcher.listSuggestions().find((item) => item.id === decision.id);
            if (suggestion) {
                this.emit('skill_watcher_suggestion_created', suggestion);
            }
        }
    }

    /**
     * Handle suggestion trigger from native audio service
     * This is the primary auto-trigger path
     */
    async handleSuggestionTrigger(trigger: SuggestionTrigger): Promise<void> {
        if (trigger.confidence < 0.5) return;

        const plannerDecision = await this.planSuggestionTrigger(trigger);
        if (plannerDecision.kind === 'silent') {
            console.log('[IntelligenceEngine] Planner stayed silent', { reason: plannerDecision.reason, confidence: plannerDecision.confidence });
            return;
        }

        if (plannerDecision.kind !== 'answer') {
            await this.runPlannerDecision(plannerDecision, trigger.lastQuestion);
            return;
        }

        // If a speculative stream answered (or is answering) this question, reuse it.
        if (this.speculativeText !== null) {
            const expired = Date.now() > this.speculativeTextExpiry;
            const stale = expired || !trigger.lastQuestion; // empty question — reject conservatively
            if (!stale) {
                const similarity = IntelligenceEngine.jaccardSimilarity(this.speculativeText, trigger.lastQuestion);
                this.speculativeText = null;
                this.speculativeTextExpiry = Infinity;
                if (similarity >= this.SPECULATIVE_SIMILARITY_THRESHOLD) {
                    console.log(`[IntelligenceEngine] Speculative stream accepted (Jaccard=${similarity.toFixed(2)}) — continuing`);
                    this.lastTriggerTime = Date.now();
                    return;
                }
                console.log(`[IntelligenceEngine] Speculative stream rejected (Jaccard=${similarity.toFixed(2)}) — restarting`);
            } else {
                console.log(`[IntelligenceEngine] Speculative result discarded (expired=${expired}, noQuestion=${!trigger.lastQuestion})`);
                this.speculativeText = null;
                this.speculativeTextExpiry = Infinity;
            }
            // IMPORTANT: no await between this increment and runWhatShouldISay below —
            // the increment must be synchronous with the new stream launch to preserve generation-id ordering.
            ++this.currentGenerationId;
        }

        await this.runWhatShouldISay(trigger.lastQuestion, trigger.confidence);
    }

    private async planSuggestionTrigger(trigger: SuggestionTrigger): Promise<PlannerDecision> {
        const contextItems = this.session.getContext(180);
        const transcriptContext = contextItems.map(item => item.text).join('\n');
        const preparedTranscript = prepareTranscriptForWhatToAnswer(this.buildTranscriptTurns(contextItems), 12);
        const lastInterviewerTurn = this.session.getLastInterviewerTurn();
        const intentResult = await classifyIntent(
            lastInterviewerTurn,
            preparedTranscript,
            this.session.getAssistantResponseHistory().length,
            this.currentDynamicActionTemplateType,
            this.buildIntentClassificationOptions(),
        );
        const activeDynamicAction = this.dynamicActionEngine && this.currentSessionId && this.currentDynamicActionTemplateType
            ? this.dynamicActionEngine.findRecentActionForIntent({
                sessionId: this.currentSessionId,
                modeTemplateType: this.currentDynamicActionTemplateType,
                intent: intentResult.intent,
            })
            : null;
        if (activeDynamicAction) {
            return {
                kind: 'silent',
                reason: 'dynamic_action_already_active',
                confidence: Math.max(trigger.confidence, activeDynamicAction.confidence, intentResult.confidence),
            };
        }
        const detectedCodingQuestion = this.session.getDetectedCodingQuestion();

        return planNextAssistantAction({
            triggerQuestion: trigger.lastQuestion,
            confidence: trigger.confidence,
            transcriptContext,
            intentResult,
            hasRecentAssistantResponse: this.session.getAssistantResponseHistory().length > 0,
            hasDetectedCodingQuestion: Boolean(detectedCodingQuestion.question),
            now: Date.now(),
            lastTriggerTime: this.lastTriggerTime,
            cooldownMs: this.triggerCooldown,
            modeTemplateType: this.currentDynamicActionTemplateType,
        });
    }

    private async runPlannerDecision(decision: PlannerDecision, question?: string): Promise<void> {
        switch (decision.kind) {
            case 'clarify':
                await this.runClarify();
                return;
            case 'recap':
                await this.runRecap();
                return;
            case 'brainstorm':
                await this.runBrainstorm(undefined, question);
                return;
            case 'answer':
            case 'silent':
                return;
        }
    }

    // ============================================
    // Mode Executors
    // ============================================

    /**
     * MODE 1: Assist (Passive)
     * Low-priority observational insights
     */
    async runAssistMode(): Promise<string | null> {
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
        }

        this.assistCancellationToken = new AbortController();
        this.setMode('assist');

        try {
            if (!this.assistLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            if (!context) {
                this.setMode('idle');
                return null;
            }

            const insight = await this.assistLLM.generate(context);

            if (this.assistCancellationToken?.signal.aborted) {
                return null;
            }

            if (insight) {
                this.emit('assist_update', insight);
            }
            this.setMode('idle');
            return insight;

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return null;
            }
            this.emit('error', error as Error, 'assist');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 2: What Should I Say (Primary)
     * Manual trigger - uses clean transcript pipeline for question inference
     * NEVER returns null - always provides a usable response
     */
    async runWhatShouldISay(question?: string, confidence: number = 0.8, imagePaths?: string[], options?: { speculative?: boolean; skipCooldown?: boolean; screenContext?: ScreenContext; promptInstruction?: string; uploadedMaterialContext?: string; persist?: boolean; source?: string; activeSkill?: { id: string; name: string; promptBlock: string }; modeEvent?: ModeEventContext; contextDegradedReasons?: string[]; traceSink?: WhatToAnswerTraceSink; providerScopePolicy?: import('./llm/ProviderRouter').ProviderDataScopePolicy }): Promise<string | null> {
        const now = Date.now();
        const isSpeculative = options?.speculative === true;
        const skipCooldown = options?.skipCooldown === true;
        const shouldPersist = options?.persist !== false;

        // Cooldown bypass: explicit images (user intent), speculative pre-fetch, or test harness.
        const hasImages = imagePaths && imagePaths.length > 0;
        if (!hasImages && !isSpeculative && !skipCooldown && now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('what_to_say');
        // Speculative runs don't stamp lastTriggerTime at start — the cooldown slot
        // is reserved for the real trigger. We stamp it only on successful completion.
        if (!isSpeculative) {
            this.lastTriggerTime = now;
        }
        // Record the question text so handleSuggestionTrigger can do Jaccard comparison.
        // Expiry stays at Infinity while the stream is running — set to a close window only on completion.
        if (isSpeculative) {
            this.speculativeText = question ?? null;
            this.speculativeTextExpiry = Infinity;
        }

        try {
            if (!this.whatToAnswerLLM) {
                if (!this.answerLLM) {
                    if (isSpeculative) { this.speculativeText = null; this.speculativeTextExpiry = Infinity; }
                    this.setMode('idle');
                    return "Please configure your API Keys in Settings to use this feature.";
                }
                const context = this.session.getFormattedContext(180);
                const answer = await this.answerLLM.generate(question || '', context);
                if (isSpeculative) {
                    this.speculativeText = null;
                    this.speculativeTextExpiry = Infinity;
                    this.lastTriggerTime = Date.now();
                    this.setMode('idle');
                    return answer || WHAT_TO_ANSWER_FALLBACK;
                }
                if (answer) {
                    if (shouldPersist) {
                        this.session.addAssistantMessage(answer);
                    }
                    this.emit('suggested_answer', answer, question || 'inferred', confidence);
                }
                this.setMode('idle');
                return answer || WHAT_TO_ANSWER_FALLBACK;
            }

            const contextItems = this.session.getContext(180);

            // Inject latest interim transcript if available.
            const pendingInterims = [
                { role: 'interviewer' as const, segment: this.session.getLastInterimInterviewer() },
                { role: 'user' as const, segment: this.session.getLastInterimUser() },
            ]
                .filter((entry): entry is { role: 'interviewer' | 'user'; segment: TranscriptSegment } =>
                    Boolean(entry.segment && entry.segment.text.trim().length > 0))
                .sort((a, b) => b.segment.timestamp - a.segment.timestamp);
            const latestInterim = pendingInterims[0];
            if (latestInterim) {
                const { role, segment: lastInterim } = latestInterim;
                const lastItem = contextItems[contextItems.length - 1];
                const isDuplicate = lastItem &&
                    lastItem.role === role &&
                    (lastItem.text === lastInterim.text || Math.abs(lastItem.timestamp - lastInterim.timestamp) < 1000);

                if (!isDuplicate) {
                    console.log(`[IntelligenceEngine] Injecting interim transcript`, { length: lastInterim.text.length });
                    contextItems.push({
                        role,
                        text: lastInterim.text,
                        timestamp: lastInterim.timestamp,
                        speakerId: lastInterim.speakerId,
                        speakerLabel: lastInterim.speakerLabel,
                        speakerVerification: lastInterim.speakerVerification,
                    });
                }
            }

            const transcriptTurns = this.buildTranscriptTurns(contextItems);
            const speakerContext = evaluateSpeakerContextForAnswer(transcriptTurns);
            const contextDegradedReasons = options?.contextDegradedReasons ?? [];
            for (const reason of speakerContext.degradedReasons) {
                if (!contextDegradedReasons.includes(reason)) contextDegradedReasons.push(reason);
            }
            const traceSink: WhatToAnswerTraceSink | undefined = options?.traceSink
                ? (trace) => options.traceSink?.({
                    ...trace,
                    observability: {
                        ...(trace.observability ?? {}),
                        speakerContext: speakerContext.trace,
                    },
                })
                : undefined;

            const preparedTranscript = prepareTranscriptForWhatToAnswer(speakerContext.turns, 12);

            const temporalContext = buildTemporalContext(
                contextItems,
                this.session.getAssistantResponseHistory(),
                180
            );

            const lastInterviewerTurn = this.session.getLastInterviewerTurn();
            const intentResult = await classifyIntent(
                lastInterviewerTurn,
                preparedTranscript,
                this.session.getAssistantResponseHistory().length,
                this.currentDynamicActionTemplateType,
                this.buildIntentClassificationOptions(),
            );

            const screenContext = options?.screenContext;
            const resolvedSkill = options?.activeSkill
                ? options.activeSkill
                : SkillActivationManager.getInstance().resolveActiveSkill({
                    requestType: 'what_to_answer',
                    latestText: question || lastInterviewerTurn || preparedTranscript,
                }) || undefined;

            console.log('[IntelligenceEngine] Temporal RAG', {
                previousResponses: temporalContext.previousResponses.length,
                tone: temporalContext.toneSignals[0]?.type || 'neutral',
                intent: intentResult.intent,
                intentConfidence: intentResult.confidence,
                modeTemplateType: this.currentDynamicActionTemplateType ?? 'general',
                imageCount: imagePaths?.length || 0,
                screenOcrAvailable: Boolean(screenContext?.ocrText),
                screenOcrTextLength: screenContext?.ocrText?.length || 0,
                activeSkillId: resolvedSkill?.id,
            });

            const generationId = ++this.currentGenerationId;
            let fullAnswer = "";
            // RC-03 fix: hold a reference to the generator so we can call .return()
            // to properly terminate the network request when a new generation starts.
            const stream = this.whatToAnswerLLM.generateStream(
                preparedTranscript,
                temporalContext,
                intentResult,
                imagePaths,
                screenContext,
                options?.promptInstruction,
                options?.uploadedMaterialContext,
                resolvedSkill,
                options?.modeEvent,
                contextDegradedReasons,
                traceSink,
                options?.providerScopePolicy,
            );
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _what_to_say stream aborted by new generation');
                    // RC-03 fix: .return() signals the generator to clean up and stops
                    // the underlying network request (SDK generators honour this).
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                fullAnswer += token;
            }

            if (streamAborted) {
                // Aborted mid-stream — don't update session or emit final event
                if (isSpeculative) {
                    this.speculativeText = null;
                    this.speculativeTextExpiry = Infinity;
                    // Stamp lastTriggerTime so the real trigger that caused this abort
                    // doesn't allow a rapid second trigger within the cooldown window.
                    this.lastTriggerTime = Date.now();
                }
                this.setMode('idle');
                return null;
            }

            if (!fullAnswer || fullAnswer.trim().length < 5) {
                fullAnswer = WHAT_TO_ANSWER_FALLBACK;
            }

            fullAnswer = IntelligenceEngine.normalizeSuggestedAnswer(fullAnswer);


            if (IntelligenceEngine.isNonAnswerSentinel(fullAnswer)) {
                if (isSpeculative) {
                    this.speculativeText = null;
                    this.speculativeTextExpiry = Infinity;
                    this.lastTriggerTime = Date.now();
                }
                this.setMode('idle');
                return null;
            }

            if (isSpeculative) {
                this.lastTriggerTime = Date.now();
                this.speculativeTextExpiry = this.lastTriggerTime + this.triggerCooldown + 500;
                this.setMode('idle');
                return fullAnswer;
            }

            const usageQuestion = IntelligenceEngine.inferUsageQuestionLabel(question, preparedTranscript);
            const dynamicActionModeEvent = options?.modeEvent as (ModeEventContext & {
                actionId?: string;
                sourceIntent?: string;
                productContract?: {
                    outputType?: DynamicActionOutputType;
                };
            }) | undefined;
            const isDynamicActionUsage = options?.source === 'dynamic_action' || Boolean(dynamicActionModeEvent?.actionId);
            const usageEntry: any = {
                type: 'assist',
                timestamp: Date.now(),
                question: usageQuestion,
                answer: fullAnswer,
                ...(isDynamicActionUsage ? {
                    metadata: {
                        source: 'dynamic_action',
                        actionType: dynamicActionModeEvent?.sourceIntent ?? dynamicActionModeEvent?.intent,
                        actionId: dynamicActionModeEvent?.actionId,
                        modeTemplateType: dynamicActionModeEvent?.modeTemplateType,
                        retrievalQuery: dynamicActionModeEvent?.retrievalQuery,
                        outputType: dynamicActionModeEvent?.productContract?.outputType,
                        groundedSources: [],
                    },
                } : {}),
            };

            this.emit('suggested_answer_token', fullAnswer, usageQuestion, confidence);

            if (shouldPersist) {
                this.session.addAssistantMessage(fullAnswer);
                this.session.pushUsage(usageEntry);
            }

            this.emit('suggested_answer', fullAnswer, usageQuestion, confidence);

            this.setMode('idle');
            return fullAnswer;

        } catch (error) {
            if (isSpeculative) { this.speculativeText = null; this.speculativeTextExpiry = Infinity; }
            this.emit('error', error as Error, 'what_to_say');
            this.setMode('idle');
            return WHAT_TO_ANSWER_FALLBACK;
        }
    }

    /**
     * MODE 3: Recap (Summary)
     * Neutral conversation summary
     */
    async runRecap(): Promise<string | null> {
        console.log('[IntelligenceEngine] runRecap called');
        this.setMode('recap');

        try {
            if (!this.recapLLM) {
                console.error('[IntelligenceEngine] RecapLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for recap');
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            let fullSummary = "";
            const stream = this.recapLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _recap stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('recap_token', token);
                fullSummary += token;
            }

            // Only emit final if not aborted
            if (!streamAborted && fullSummary && this.currentGenerationId === generationId) {
                this.emit('recap', fullSummary);

                // Track recap as an assistant message.
                this.session.addAssistantMessage(fullSummary);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Recap Meeting',
                    answer: fullSummary
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullSummary;

        } catch (error) {
            this.emit('error', error as Error, 'recap');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE: Clarify
     * Ask a clarifying question to the interviewer
     *
     * Returns a structured `ClarifyResult` so the caller can distinguish the
     * real failure reason (no LLM configured, aborted by a new request, empty
     * stream, thrown error) instead of treating every failure as the same
     * generic "no audio context" error.
     */
    async runClarify(): Promise<ClarifyResult> {
        console.log('[IntelligenceEngine] runClarify called');
        this.setMode('clarify');

        try {
            if (!this.clarifyLLM) {
                console.error('[IntelligenceEngine] ClarifyLLM not initialized');
                this.setMode('idle');
                return { ok: false, reason: 'no_llm' };
            }

            const rawContext = this.session.getFormattedContext(180);
            // If no transcript yet, use a generic prompt — the LLM will ask a scoping question
            const context = rawContext || '[No transcript available yet. The candidate just joined the interview. Generate an opening clarifying question to understand the scope and constraints of the upcoming problem.]';

            const generationId = ++this.currentGenerationId;
            let fullClarification = "";
            const stream = this.clarifyLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] _clarify stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('clarify_token', token);
                fullClarification += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return { ok: false, reason: 'aborted' };
            }

            // Only update history and emit final if not aborted
            if (fullClarification && this.currentGenerationId === generationId) {
                this.emit('clarify', fullClarification);
                this.session.addAssistantMessage(fullClarification);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Clarify Question',
                    answer: fullClarification
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }

            if (!fullClarification) {
                // Stream finished with no tokens — usually means the LLM provider
                // errored and the inner `ClarifyLLM` swallowed it. Surface as
                // 'empty' so the user sees a real message, not a false
                // "audio context" hint.
                return { ok: false, reason: 'empty' };
            }

            return { ok: true, clarification: fullClarification };

        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.emit('error', error as Error, 'clarify');
            this.setMode('idle');
            return { ok: false, reason: 'error', detail };
        }
    }

    /**
     * MODE 5: Manual Answer (Fallback)
     * Explicit bypass when auto-detection fails
     */
    async runManualAnswer(question: string): Promise<string | null> {
        this.emit('manual_answer_started');
        this.setMode('manual');

        try {
            if (!this.answerLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            const answer = await this.answerLLM.generate(question, context);

            if (answer) {
                this.session.addAssistantMessage(answer);
                this.emit('manual_answer_result', answer, question);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: question,
                    answer: answer
                });
            }

            this.setMode('idle');
            return answer;

        } catch (error) {
            this.emit('error', error as Error, 'manual');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 7: Code Hint (Live Code Reviewer)
     * Analyzes a screenshot of partially written code against the detected/provided question
     * and returns a short targeted hint. Question comes from (priority order):
     *   1. problemStatement passed in from ipcHandler (screenshot extraction — highest confidence)
     *   2. session.detectedCodingQuestion (detected from interviewer transcript)
     *   3. transcriptContext (last N seconds of conversation — fallback for inference)
     */
    async runCodeHint(imagePaths?: string[], problemStatement?: string, options?: RunCodeHintOptions): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('code_hint');

        try {
            if (!this.codeHintLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            // Resolve question context from available sources (priority order)
            const sessionQuestion = this.session.getDetectedCodingQuestion();
            const questionContext = problemStatement ?? sessionQuestion.question ?? null;
            const questionSource = problemStatement
                ? 'screenshot'
                : sessionQuestion.source;

            // Pull transcript as fallback context when no question is pinned
            const transcriptContext = questionContext === null
                ? this.session.getFormattedContext(180)
                : null;

            console.log(`[IntelligenceEngine] Code hint — question source: ${questionContext ? (questionSource ?? 'passed') : 'none'}, transcript lines: ${transcriptContext ? transcriptContext.split('\n').length : 0}, images: ${imagePaths?.length ?? 0}`);

            const generationId = ++this.currentGenerationId;
            let fullHint = "";
            let providerScopePolicy: AppSettings['providerDataScopes'] | undefined;
            try {
                providerScopePolicy = SettingsManager.getInstance().get('providerDataScopes');
            } catch {
                providerScopePolicy = undefined;
            }
            const traceSink = (trace: CodeHintTrace) => {
                try {
                    getContextQualityDiagnosticsCollector().recordCodeHintTrace(trace);
                } catch {
                    // Diagnostics collector must not affect CodeHint behavior.
                }
                try {
                    this.emit('code_hint_trace', trace);
                } catch {
                    // Diagnostics event listeners must not affect CodeHint behavior.
                }
            };
            const stream = this.codeHintLLM.generateStream(
                imagePaths,
                questionContext ?? undefined,
                questionSource,
                transcriptContext ?? undefined,
                {
                    providerScopePolicy,
                    requestedDataScopes: options?.requestedDataScopes,
                    traceSink,
                }
            );

            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] code_hint stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, 'Code Hint', 1.0);
                fullHint += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (!fullHint || fullHint.trim().length < 5) {
                fullHint = "I couldn't detect any code in the screenshot. Try screenshotting your code editor directly.";
            }

            this.session.addAssistantMessage(fullHint);
            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Code Hint',
                answer: fullHint
            });

            this.emit('suggested_answer', fullHint, 'Code Hint', 1.0);
            this.setMode('idle');
            return fullHint;

        } catch (error) {
            this.emit('error', error as Error, 'code_hint');
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 8: Brainstorm (Strategic Approach Generator)
     * Generates a spoken script outlining 2-3 problem-solving approaches with trade-offs.
     */
    async runBrainstorm(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('brainstorm');

        try {
            if (!this.brainstormLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            let context = this.session.getFormattedContext(180);
            // Prepend the problem statement so the LLM knows exactly what to brainstorm
            const resolvedProblem = problemStatement?.trim() ||
                this.session.getDetectedCodingQuestion().question?.trim();

            if (!context.trim() && !resolvedProblem && (!imagePaths || imagePaths.length === 0)) {
                this.setMode('idle');
                const msg = "There's nothing to brainstorm right now. Make sure your question is visible or spoken aloud, then try again.";
                this.session.addAssistantMessage(msg);
                this.emit('suggested_answer', msg, 'Brainstorming Approaches', 1.0);
                return msg;
            }

            if (resolvedProblem) {
                context = `<problem_statement>\n${resolvedProblem}\n</problem_statement>\n\n${context}`;
            }
            const generationId = ++this.currentGenerationId;
            let fullResult = "";
            const stream = this.brainstormLLM.generateStream(context, imagePaths);
            let streamAborted = false;

            for await (const token of stream) {
                if (this.currentGenerationId !== generationId) {
                    console.log('[IntelligenceEngine] brainstorm stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, 'Brainstorming Approaches', 1.0);
                fullResult += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (!fullResult || fullResult.trim().length < 5) {
                fullResult = "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";
            }

            this.session.addAssistantMessage(fullResult);
            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Brainstorm',
                answer: fullResult
            });

            this.emit('suggested_answer', fullResult, 'Brainstorming Approaches', 1.0);
            this.setMode('idle');
            return fullResult;

        } catch (error) {
            this.emit('error', error as Error, 'brainstorm');
            this.setMode('idle');
            return null;
        }
    }

    // ============================================
    // State Management
    // ============================================

    private setMode(mode: IntelligenceMode): void {
        if (this.activeMode !== mode) {
            this.activeMode = mode;
            this.emit('mode_changed', mode);
        }
    }

    getActiveMode(): IntelligenceMode {
        return this.activeMode;
    }

    /**
     * Reset engine state (cancels any in-flight operations)
     */
    reset(): void {
        this.activeMode = 'idle';
        this.currentGenerationId++; // Increment to break all active LLM streams
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }
        if (this.speculativeTimer !== null) {
            clearTimeout(this.speculativeTimer);
            this.speculativeTimer = null;
        }
        this.speculativeText = null;
        this.speculativeTextExpiry = Infinity;
        SkillActivationManager.getInstance().clearMeetingActivations();
        SkillWatcherService.getInstance().clearSessionState();
    }
}
