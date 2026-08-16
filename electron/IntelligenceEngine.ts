// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import type { StructuredGenerationTimingEvent } from './LLMHelper';
import { SessionTracker, TranscriptSegment, SuggestionTrigger, ContextItem, type SpeakerVerificationSessionOverrideAction } from './SessionTracker';
import {
    AnswerLLM, AssistLLM, BrainstormLLM, ClarifyLLM, CodeHintLLM, RecapLLM,
    WhatToAnswerLLM,
    prepareTranscriptForWhatToAnswer, buildTemporalContext,
    AssistantResponse as LLMAssistantResponse, classifyIntent, planNextAssistantAction, PlannerDecision
} from './llm';
import type { ModeEventContext } from './llm';
import type { WhatToAnswerTraceSink } from './llm/WhatToAnswerLLM';
import type { CodeHintTrace } from './llm/CodeHintLLM';
import type { ProviderDataScope, ProviderDataScopePolicy } from './llm/ProviderRouter';
import type { TranscriptTurn } from './llm';
import type {
    CloudIntentClassifierInput,
    CloudIntentClassifierResult,
    IntentClassificationOptions,
} from './llm/IntentClassifier';
import {
    DynamicActionEngine,
    isDetectorOnlyDynamicActionMode,
} from './services/dynamic-actions/DynamicActionEngine';
import type { DetectedSignalCandidate } from './services/dynamic-actions/DynamicActionEngine';
import { DynamicAction } from './services/dynamic-actions/DynamicAction';
import type { DynamicActionOutputType } from './services/dynamic-actions/DynamicAction';
import {
    buildDynamicActionSpeakerConfirmation,
    sameSpeakerConfirmationSegment,
    type DynamicActionSpeakerConfirmation,
} from '../shared/speakerConfirmation';
import { DynamicActionContinuationService } from './services/dynamic-actions/DynamicActionContinuationService';
import {
    buildFdeContinuationDerivedActionContext,
    buildRecruitingContinuationDerivedActionContext,
    DynamicActionContinuationPlanner,
} from './services/dynamic-actions/DynamicActionContinuationPlanner';
import {
    evaluateDynamicActionAcceptedOutput,
} from './services/dynamic-actions/DynamicActionAcceptedOutputEvaluator';
import {
    buildNotRequiredClaimGroundingVerdict,
    DynamicActionClaimGroundingVerifier,
    type ClaimGroundingVerdict,
} from './services/dynamic-actions/DynamicActionClaimGroundingVerifier';
import type { DynamicActionRuntimeGrounding } from './services/dynamic-actions/DynamicActionRuntimeGrounding';
import {
    buildDynamicActionRuntimeSafeFallback,
    getDynamicActionRuntimeValidationPolicy,
} from './services/dynamic-actions/DynamicActionRuntimeValidationPolicy';
import {
    buildCloudSemanticGatePrompt,
    CloudSemanticGateError,
    cloudFailureReasonFromError,
    parseCloudSemanticGateResponse,
    type CloudSemanticGateInput,
    type CloudSemanticGateResult,
    type ModeEventContextTurn,
    type SemanticGateArbitrationStatus,
    type SemanticGateTrace,
} from './services/dynamic-actions/ModeEventClassifier';
import {
    buildRetrievalQuery,
    isDynamicActionResponseLanguageCompatible,
    resolveDynamicActionResponseLanguage,
} from './services/dynamic-actions/ModeEventUtils';
import { ScreenContext } from './services/screen/types';
import { SettingsManager, type AppSettings } from './services/SettingsManager';
import { SkillActivationManager } from './services/SkillActivationManager';
import { SkillsManager } from './services/SkillsManager';
import { SkillWatcherService, type SkillWatcherSuggestion } from './services/SkillWatcherService';
import { isLocalIntentClassifierAvailable } from './services/LocalModelManager';
import { redactForLog } from './utils/redactForLog';
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

const CLARIFY_NO_TRANSCRIPT_FALLBACK_BY_MODE: Record<string, string> = {
    general: 'General: The meeting has no transcript yet. Generate one concise clarifying question about the user’s goal, constraints, or desired output.',
    sales: 'Sales: The meeting has no transcript yet. Generate one concise clarifying question about customer goals, pain, budget, decision process, timing, technical boundary, or next step.',
    fde: 'FDE: The meeting has no transcript yet. Generate one concise clarifying question about deployment context, system boundaries, data flow, permissions, integration, rollout risk, or validation.',
    recruiting: 'Recruiting: The meeting has no transcript yet. Generate one concise, fair clarifying question about candidate evidence, role requirements, policy constraints, or risk to verify.',
    'team-meet': 'Team Meet: The meeting has no transcript yet. Generate one concise clarifying question about owner, deadline, decision, dependency, blocker, or next action.',
    'looking-for-work': 'Looking for work: The meeting has no transcript yet. Generate one concise clarifying question about the interviewer’s focus, role expectations, or answer constraints.',
    'technical-interview': 'Technical Interview: The meeting has no transcript yet. Generate one concise clarifying question about input size, constraints, edge cases, complexity, or expected approach.',
    lecture: 'Lecture: The meeting has no transcript yet. Generate one concise clarifying question about the topic, definition, example, or key takeaway.',
};

function buildClarifyNoTranscriptFallbackContext(modeTemplateType?: string | null): string {
    return CLARIFY_NO_TRANSCRIPT_FALLBACK_BY_MODE[modeTemplateType || 'general']
        || CLARIFY_NO_TRANSCRIPT_FALLBACK_BY_MODE.general;
}

// Events emitted by IntelligenceEngine
export interface IntelligenceModeEvents {
    'assist_update': (insight: string) => void;
    'suggested_answer': (answer: string, question: string, confidence: number, requestId?: string) => void;
    'suggested_answer_token': (token: string, question: string, confidence: number, requestId?: string) => void;
    'refined_answer': (answer: string, intent: string) => void;
    'refined_answer_token': (token: string, intent: string) => void;
    'recap': (summary: string) => void;
    'recap_token': (token: string) => void;
    'clarify': (clarification: string) => void;
    'clarify_token': (token: string) => void;
    'manual_answer_started': () => void;
    'manual_answer_result': (answer: string, question: string) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode, requestId?: string) => void;
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
    'dynamic_action_gate_availability': (statuses: SemanticGateArbitrationStatus[]) => void;
    'dynamic_action_latency_trace': (trace: DynamicActionLatencyTrace) => void;
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

interface SpeculativeAnswerState {
    requestId: string;
    question: string;
    status: 'streaming' | 'completed';
    accumulatedAnswer: string;
    startedAt: number;
    completedAt?: number;
    expiresAt: number;
    visible: boolean;
}

export interface DynamicActionRuntimeValidation {
    actionType: string;
    sourceIntent?: string;
    parentActionId?: string;
    grounding: DynamicActionRuntimeGrounding;
    providerDataScopes?: ProviderDataScopePolicy;
    deferUserVisibleEmission: boolean;
    language?: string;
    sourceUtterance?: string;
    transcriptEvidence?: string[];
}

export interface DynamicActionRuntimeEvaluationTrace {
    actionType: string;
    parentActionId?: string;
    result: 'passed' | 'safe_fallback';
    failureCodes: string[];
    claimGroundingVerdict: ClaimGroundingVerdict['verdict'];
    claimGroundingReasonCode: ClaimGroundingVerdict['reasonCode'];
}

export type DynamicActionLatencyStage =
    | StructuredGenerationTimingEvent['stage']
    | 'complete_json'
    | 'card_emitted';

export interface DynamicActionLatencyTrace {
    requestId: string;
    stage: DynamicActionLatencyStage;
    elapsedMs: number;
    provider?: string;
    durationMs?: number;
    measurement?: StructuredGenerationTimingEvent['measurement'];
    candidateCount?: number;
}

interface DynamicActionLatencyContext {
    requestId: string;
    startedAt: number;
    candidateCount?: number;
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
    private reservedWhatToSayRequestId: string | null = null;
    private activeWhatToSayAbortController: AbortController | null = null;

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
    private speculativeAnswerState: SpeculativeAnswerState | null = null;
    private readonly SPECULATIVE_DEBOUNCE_MS = 350;
    private readonly SPECULATIVE_MIN_WORDS = 7;
    private readonly SPECULATIVE_MIN_CONFIDENCE = 0.75;
    private readonly SPECULATIVE_SIMILARITY_THRESHOLD = 0.75;

    // Phase 3 dynamic actions — engine state. Created lazily on first
    // setSessionContext call (or per-test injection). Null while engine has no
    // active meeting, so detectAndEmitDynamicActions becomes a no-op safely.
    private dynamicActionEngine: DynamicActionEngine | null = null;
    private dynamicActionContinuationService: DynamicActionContinuationService;
    private dynamicActionClaimGroundingVerifier: DynamicActionClaimGroundingVerifier;
    private currentSessionId: string | null = null;
    private currentDynamicActionModeId: string | null = null;
    private currentDynamicActionTemplateType: string | null = null;
    private intentClassificationOptionsForTest: IntentClassificationOptions | null = null;
    private dynamicActionLatencySequence = 0;
    private dynamicActionGateRuns = new Map<string, {
        fingerprint: string;
        controller: AbortController;
        promise: Promise<void>;
    }>();

    private static isNonAnswerSentinel(answer: string): boolean {
        const normalized = answer.trim().toLowerCase().replace(/[.!?。！？\s]+$/g, '');
        return normalized === 'nothing actionable right now'
            || normalized === 'nothing to capture right now'
            || normalized === WHAT_TO_ANSWER_FALLBACK.toLowerCase().replace(/[.!?。！？\s]+$/g, '');
    }

    private getActiveClarifyModeTemplateType(): string | null {
        try {
            return ModesManager.getInstance().getActiveMode()?.templateType
                || this.currentDynamicActionTemplateType
                || null;
        } catch {
            return this.currentDynamicActionTemplateType || null;
        }
    }

    private static isPotentialNonAnswerSentinelPrefix(answer: string): boolean {
        const normalized = answer.trim().toLowerCase().replace(/[.!?。！？\s]+$/g, '');
        if (!normalized) return true;
        return [
            'nothing actionable right now',
            'nothing to capture right now',
            WHAT_TO_ANSWER_FALLBACK.toLowerCase(),
        ].some(candidate => candidate.startsWith(normalized));
    }

    private clearSpeculativeAnswerState(): void {
        this.speculativeAnswerState = null;
        this.speculativeText = null;
        this.speculativeTextExpiry = Infinity;
    }

    public reserveWhatShouldISayRequest(requestId?: string): void {
        if (!requestId) return;
        this.reservedWhatToSayRequestId = requestId;
        this.activeWhatToSayAbortController?.abort(new Error('what_to_say request superseded'));
        this.activeWhatToSayAbortController = null;
        ++this.currentGenerationId;
        this.clearSpeculativeAnswerState();
    }

    private tryPublishSpeculativeAnswer(trigger: SuggestionTrigger): boolean {
        const speculative = this.speculativeAnswerState;
        if (!speculative || !trigger.lastQuestion) return false;

        const expired = Date.now() > speculative.expiresAt;
        const similarity = expired
            ? 0
            : IntelligenceEngine.jaccardSimilarity(speculative.question, trigger.lastQuestion);
        if (expired || similarity < this.SPECULATIVE_SIMILARITY_THRESHOLD) {
            console.log(`[IntelligenceEngine] Speculative result rejected (expired=${expired}, similarity=${similarity.toFixed(2)})`);
            this.clearSpeculativeAnswerState();
            ++this.currentGenerationId;
            return false;
        }

        console.log(`[IntelligenceEngine] Speculative stream accepted (Jaccard=${similarity.toFixed(2)})`);
        this.lastTriggerTime = Date.now();
        speculative.visible = true;
        const usageQuestion = IntelligenceEngine.inferUsageQuestionLabel(trigger.lastQuestion, trigger.context);
        if (speculative.accumulatedAnswer) {
            this.emit('suggested_answer_token', speculative.accumulatedAnswer, usageQuestion, trigger.confidence, speculative.requestId);
        }
        if (speculative.status === 'completed') {
            this.session.addAssistantMessage(speculative.accumulatedAnswer);
            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: usageQuestion,
                answer: speculative.accumulatedAnswer,
            });
            this.emit('suggested_answer', speculative.accumulatedAnswer, usageQuestion, trigger.confidence, speculative.requestId);
            this.clearSpeculativeAnswerState();
        }
        return true;
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
                perProviderTimeoutMs: 6000,
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
        abortSignal?: AbortSignal,
        latencyContext?: DynamicActionLatencyContext,
    ): Promise<CloudSemanticGateResult[] | null> {
        const prompt = buildCloudSemanticGatePrompt(input);

        let raw: string;
        try {
            raw = await this.llmHelper.generateContentStructured(prompt, {
                taskLabel: 'dynamic-action-semantic-gate',
                maxOutputTokens: 256,
                perProviderTimeoutMs: 6000,
                totalTimeoutMs: 6000,
                maxRotations: 1,
                providerStrategy: 'selected_model_only',
                dataScopes: ['transcript'],
                abortSignal,
                requestId: latencyContext?.requestId,
                qcloudRequestClass: 'dynamic_action',
                timingSink: (event) => {
                    if (!latencyContext || abortSignal?.aborted) return;
                    this.emitDynamicActionLatency(latencyContext, event.stage, {
                        provider: event.provider,
                        durationMs: event.durationMs,
                        measurement: event.measurement,
                    });
                },
            });
            if (abortSignal?.aborted) {
                throw abortSignal.reason ?? new Error('dynamic_action_gate_aborted');
            }
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? String((error as { code?: unknown }).code ?? '')
                : '';
            if (code === 'selected_model_not_configured') {
                throw new CloudSemanticGateError('selected_model_not_configured');
            }
            if (code === 'selected_model_unavailable') {
                throw new CloudSemanticGateError('selected_model_unavailable');
            }
            if (code === 'selected_cloud_model_timeout') {
                throw new CloudSemanticGateError('cloud_timeout');
            }
            throw new CloudSemanticGateError(cloudFailureReasonFromError(error));
        }

        try {
            const parsed = parseCloudSemanticGateResponse(raw, input.candidates);
            if (latencyContext && !abortSignal?.aborted) {
                this.emitDynamicActionLatency(latencyContext, 'complete_json');
            }
            return parsed;
        } catch (error) {
            if (this.llmHelper.getCurrentModelExecutionKind() !== 'cloud') {
                throw new CloudSemanticGateError('selected_model_unavailable');
            }
            throw error;
        }
    }

    private emitDynamicActionLatency(
        context: DynamicActionLatencyContext,
        stage: DynamicActionLatencyStage,
        details: Omit<DynamicActionLatencyTrace, 'requestId' | 'stage' | 'elapsedMs'> = {},
    ): void {
        const trace: DynamicActionLatencyTrace = {
            requestId: context.requestId,
            stage,
            elapsedMs: Math.max(0, Number((performance.now() - context.startedAt).toFixed(3))),
            candidateCount: context.candidateCount,
            ...details,
        };
        console.log('[DynamicActionLatency]', trace);
        this.emit('dynamic_action_latency_trace', trace);
    }

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.dynamicActionContinuationService = new DynamicActionContinuationService({
            planner: new DynamicActionContinuationPlanner((prompt, options) =>
                this.llmHelper.generateContentStructured(prompt, options)),
            traceSink: (event) =>
                getContextQualityDiagnosticsCollector().recordDynamicActionContinuationTrace(event),
        });
        this.dynamicActionClaimGroundingVerifier = new DynamicActionClaimGroundingVerifier((prompt, options) =>
            this.llmHelper.generateContentStructured(prompt, options));
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
    handleTranscript(
        segment: TranscriptSegment,
        skipRefinementCheck: boolean = false,
    ): { role: 'interviewer' | 'user' | 'assistant'; segment: TranscriptSegment; mergedIntoPrevious?: boolean } | null {
        const result = this.session.handleTranscript(segment);
        this.lastTranscriptTime = Date.now();

        if (segment.speaker !== 'assistant' && !segment.final) {
            this.maybeSpeculate(segment);
        } else if (segment.final && this.speculativeTimer !== null) {
            // Final arrived — cancel debounce; handleSuggestionTrigger will do Jaccard check
            clearTimeout(this.speculativeTimer);
            this.speculativeTimer = null;
        }

        // Dynamic action gating gets first access to the selected model. The
        // transcript path remains fire-and-forget; continuation starts after
        // the gate settles so the two structured requests do not contend.
        if (segment.final) {
            const effectiveSegment = this.session.applySpeakerVerificationOverride(segment);
            const providerDataScopes = this.buildIntentClassificationOptions().providerDataScopes;
            const latencyContext: DynamicActionLatencyContext = {
                requestId: `dynamic_gate_${segment.timestamp}_${++this.dynamicActionLatencySequence}`,
                startedAt: performance.now(),
            };
            const dynamicActionGate = this.detectConfirmAndEmitDynamicActions(effectiveSegment, latencyContext).catch((err) => {
                console.warn('[IntelligenceEngine] detectConfirmAndEmitDynamicActions failed', (err as Error)?.message);
            });
            void dynamicActionGate.then(() =>
                this.observeDynamicActionContinuation(effectiveSegment, providerDataScopes)
            ).catch((error) => {
                console.warn('[IntelligenceEngine] continuation observation failed', redactForLog([error]));
            });
            this.runSkillWatcher(effectiveSegment).catch((err) => {
                console.warn('[IntelligenceEngine] runSkillWatcher failed', (err as Error)?.message);
            });
        }

        return result;
    }

    handleSpeakerVerificationSessionOverride(
        segment: TranscriptSegment,
        action: SpeakerVerificationSessionOverrideAction,
    ): void {
        if (!segment.final) return;

        if (action === 'force_not_me') {
            this.retractDynamicActionsForSpeakerCorrection(segment, true);
            const latencyContext: DynamicActionLatencyContext = {
                requestId: `dynamic_override_${segment.timestamp}_${++this.dynamicActionLatencySequence}`,
                startedAt: performance.now(),
            };
            this.detectConfirmAndEmitDynamicActions(segment, latencyContext).catch((err) => {
                console.warn('[IntelligenceEngine] speaker override dynamic action retry failed', (err as Error)?.message);
            });
            return;
        }

        if (action !== 'force_me' || !this.dynamicActionEngine || !this.currentSessionId) {
            return;
        }

        this.retractDynamicActionsForSpeakerCorrection(segment, false);
    }

    private retractDynamicActionsForSpeakerCorrection(
        segment: TranscriptSegment,
        discardWithoutCooldown: boolean,
    ): void {
        if (!this.dynamicActionEngine || !this.currentSessionId) return;

        const normalizedText = (segment.text || '').replace(/\s+/g, ' ').trim();
        if (!normalizedText) return;
        for (const activeAction of this.getActiveDynamicActions()) {
            const confirmation = activeAction.speakerConfirmation;
            const matchesTargetSegment = confirmation
                ? confirmation.timestamp === segment.timestamp
                    && confirmation.text.replace(/\s+/g, ' ').trim() === normalizedText
                : activeAction.evidenceRefs.some((evidence) =>
                    (evidence.text || '').replace(/\s+/g, ' ').trim() === normalizedText
                );
            if (!matchesTargetSegment) continue;
            if (discardWithoutCooldown) {
                this.dynamicActionEngine.discardAction(activeAction.id);
            } else {
                this.dynamicActionEngine.dismissAction(activeAction.id);
            }
            this.emit('dynamic_action_emitted', { ...activeAction, status: 'dismissed' });
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
        const previousSessionId = this.currentSessionId;
        const contextChanged = Boolean(
            previousSessionId &&
            (previousSessionId !== sessionId ||
                this.currentDynamicActionModeId !== modeId ||
                this.currentDynamicActionTemplateType !== modeTemplateType)
        );
        if (!this.dynamicActionEngine) {
            this.dynamicActionEngine = new DynamicActionEngine();
        }
        // If session changed, drop store so we don't bleed actions across meetings.
        if (this.currentSessionId && this.currentSessionId !== sessionId) {
            this.dynamicActionEngine = new DynamicActionEngine();
        }
        if (contextChanged) {
            this.dynamicActionContinuationService.cancelForContext(previousSessionId ?? undefined);
            this.cancelDynamicActionGateRuns('dynamic_action_context_changed');
        }
        this.currentSessionId = sessionId;
        this.currentDynamicActionModeId = modeId;
        this.currentDynamicActionTemplateType = modeTemplateType;
    }

    clearDynamicActionContext(): void {
        this.dynamicActionContinuationService.cancelForContext(this.currentSessionId ?? undefined);
        this.cancelDynamicActionGateRuns('dynamic_action_context_cleared');
        this.currentSessionId = null;
        this.currentDynamicActionModeId = null;
        this.currentDynamicActionTemplateType = null;
        this.dynamicActionEngine = null;
    }

    acceptDynamicAction(actionId: string, options?: { triggerSource?: import('./services/dynamic-actions/DynamicAction').DynamicActionAcceptTriggerSource }): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        const action = this.dynamicActionEngine.acceptAction(actionId, options);
        if (action) {
            this.recordDynamicActionUsage(
                action,
                options?.triggerSource === 'auto_countdown' ? 'auto_generated' : 'accepted',
                options?.triggerSource === 'auto_countdown' ? 'auto_countdown' : 'manual',
            );
        }
        return action;
    }

    confirmDynamicActionSpeaker(confirmation: DynamicActionSpeakerConfirmation): DynamicAction[] {
        if (!this.dynamicActionEngine || !this.currentSessionId) return [];
        return this.dynamicActionEngine.getStore().getActiveActions(this.currentSessionId).filter((action) => {
            if (!action.speakerConfirmation
                || !sameSpeakerConfirmationSegment(action.speakerConfirmation, confirmation)) {
                return false;
            }
            delete action.speakerConfirmation;
            action.autoTriggerEligible = false;
            action.autoTriggerReason = 'speaker_confirmed_manual_only';
            return true;
        });
    }

    markDynamicActionShown(actionId: string): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        return this.dynamicActionEngine.markShown(actionId);
    }

    getDynamicActionById(actionId: string): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        return this.dynamicActionEngine.getStore().getAction(actionId) ?? null;
    }

    completeDynamicAction(actionId: string): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        this.dynamicActionEngine.completeAction(actionId);
        const action = this.dynamicActionEngine.getStore().getAction(actionId) ?? null;
        const belongsToCurrentContext = Boolean(
            action &&
            action.sessionId === this.currentSessionId &&
            action.modeId === this.currentDynamicActionModeId &&
            action.modeTemplateType === this.currentDynamicActionTemplateType
        );
        if (action && belongsToCurrentContext && this.hasCompletedDynamicActionUsage(actionId)) {
            this.dynamicActionContinuationService.registerCompletedAction(action);
        }
        return action;
    }

    markDynamicActionGenerationFailed(actionId: string): DynamicAction | null {
        if (!this.dynamicActionEngine) return null;
        const action = this.dynamicActionEngine.markGenerationFailed(actionId);
        if (action) {
            this.recordDynamicActionUsage(action, 'generated_failed');
        }
        return action;
    }

    dismissDynamicAction(actionId: string): void {
        if (!this.dynamicActionEngine) return;
        this.dynamicActionEngine.dismissAction(actionId);
    }

    getActiveDynamicActions(): DynamicAction[] {
        if (!this.dynamicActionEngine || !this.currentSessionId) return [];
        return this.dynamicActionEngine.getTopActions(this.currentSessionId);
    }

    getActiveDynamicActionsWithExpired(): { actions: DynamicAction[]; expired: DynamicAction[] } {
        if (!this.dynamicActionEngine || !this.currentSessionId) return { actions: [], expired: [] };
        return this.dynamicActionEngine.getTopActionsWithExpired(this.currentSessionId);
    }

    private recordDynamicActionUsage(
        action: Pick<DynamicAction, 'id' | 'type' | 'label' | 'modeTemplateType' | 'sourceIntent' | 'retrievalQuery' | 'productContract'>,
        generationStatus: 'accepted' | 'auto_generated' | 'generated_failed',
        triggerSource?: 'manual' | 'auto_countdown',
    ): void {
        const validationPolicy = getDynamicActionRuntimeValidationPolicy(action.type);
        this.session.pushUsage({
            type: 'assist',
            timestamp: Date.now(),
            question: action.productContract?.userAction || action.label || action.type,
            answer: null,
            metadata: validationPolicy?.evidenceKind === 'transcript_evidence'
                ? {
                    source: 'dynamic_action',
                    actionType: action.type,
                    actionId: action.id,
                    modeTemplateType: action.modeTemplateType,
                    sourceIntent: action.sourceIntent,
                    evidenceKind: validationPolicy.evidenceKind,
                    outputType: action.productContract?.outputType,
                    generationStatus,
                    ...(triggerSource ? { triggerSource } : {}),
                }
                : {
                    source: 'dynamic_action',
                    actionType: action.type,
                    actionId: action.id,
                    modeTemplateType: action.modeTemplateType,
                    sourceIntent: action.sourceIntent,
                    retrievalQuery: action.retrievalQuery,
                    outputType: action.productContract?.outputType,
                    generationStatus,
                    ...(triggerSource ? { triggerSource } : {}),
                    groundedSources: [],
                },
        });
    }

    private hasCompletedDynamicActionUsage(actionId: string): boolean {
        return this.session.getFullUsage().some((entry) =>
            entry?.metadata?.source === 'dynamic_action' &&
            entry?.metadata?.actionId === actionId &&
            entry?.metadata?.generationStatus === 'completed' &&
            (Array.isArray(entry.answer)
                ? entry.answer.join('\n').trim().length > 0
                : typeof entry.answer === 'string' && entry.answer.trim().length > 0)
        );
    }

    private async observeDynamicActionContinuation(
        segment: TranscriptSegment,
        providerDataScopes?: ProviderDataScopePolicy,
    ): Promise<void> {
        if (!this.currentSessionId || !this.currentDynamicActionModeId || !this.currentDynamicActionTemplateType) return;
        const outcome = await this.dynamicActionContinuationService.observeFinalCustomerTurn({
            sessionId: this.currentSessionId,
            modeId: this.currentDynamicActionModeId,
            modeTemplateType: this.currentDynamicActionTemplateType,
            speaker: segment.speaker === 'interviewer' ? 'interviewer' : 'user',
            text: segment.text,
            timestamp: segment.timestamp,
            providerDataScopes,
        });
        if (outcome.kind !== 'ready' || !outcome.continuation || !outcome.plannerResult) return;
        const continuation = outcome.continuation;
        const slots = outcome.plannerResult.extractedSlots;
        const latestTurn = continuation.collectedCustomerTurns.at(-1)?.text ?? continuation.originalTurn;
        const baseEvidenceRefs = [
            ...continuation.originalEvidenceRefs.slice(0, 1),
            ...continuation.collectedCustomerTurns.slice(-1).map((turn) => ({
                source: 'transcript' as const,
                text: turn.text,
                timestamp: turn.timestamp,
                speaker: 'interviewer',
            })),
        ];

        const derivedContext = continuation.modeTemplateType === 'fde'
            ? buildFdeContinuationDerivedActionContext({
                originalTurn: continuation.originalTurn,
                currentTurn: latestTurn,
                slots,
            })
            : continuation.modeTemplateType === 'recruiting'
                ? buildRecruitingContinuationDerivedActionContext({
                    originalTurn: continuation.originalTurn,
                    currentTurn: latestTurn,
                    slots,
                })
                : (() => {
                const slotEntities = [
                    slots.object,
                    slots.workflow,
                    slots.environment,
                    slots.validationNeed,
                    ...(slots.metrics ?? []),
                    ...(slots.systemObjects ?? []),
                ].filter((value): value is string => Boolean(value?.trim()));
                const keyEntities = [...continuation.keyEntities, ...slotEntities];
                return {
                    keyEntities,
                    retrievalQuery: buildRetrievalQuery({
                        modeTemplateType: 'sales',
                        intent: continuation.sourceIntent,
                        keyEntities,
                        latestTurn,
                        language: continuation.language,
                    }),
                };
            })();

        const dynamicActionEngine = this.dynamicActionEngine;
        if (!dynamicActionEngine) return;
        const derivedActionType = continuation.modeTemplateType === 'fde'
            ? 'fde_grounded_answer'
            : continuation.modeTemplateType === 'recruiting'
                ? 'candidate_evidence_summary'
                : 'capability_fit_answer';
        const action = dynamicActionEngine.enqueueDerivedAction({
            sessionId: continuation.sessionId,
            modeId: continuation.modeId,
            modeTemplateType: continuation.modeTemplateType,
            type: derivedActionType,
            parentActionId: continuation.parentActionId,
            sourceIntent: continuation.sourceIntent,
            latestTurn,
            evidenceRefs: baseEvidenceRefs,
            keyEntities: [...continuation.keyEntities, ...derivedContext.keyEntities],
            retrievalQuery: derivedContext.retrievalQuery,
            confidence: outcome.plannerResult.confidence,
            language: continuation.language,
        });
        if (action) {
            this.dynamicActionContinuationService.markEmitted(continuation.sessionId, continuation.parentActionId);
            this.emit('dynamic_action_emitted', action);
        } else if (dynamicActionEngine.getStore().getAllActions(continuation.sessionId).some((existing) =>
            existing.type === derivedActionType && existing.parentActionId === continuation.parentActionId
        )) {
            this.dynamicActionContinuationService.markEmitted(
                continuation.sessionId,
                continuation.parentActionId,
                'derived_action_deduplicated',
            );
        }
    }

    // For tests — injection seam.
    _setDynamicActionEngineForTest(engine: DynamicActionEngine | null): void {
        this.dynamicActionEngine = engine;
    }

    _setDynamicActionContinuationServiceForTest(
        service: Pick<DynamicActionContinuationService, 'registerCompletedAction' | 'cancelForContext'>,
    ): void {
        this.dynamicActionContinuationService = service as DynamicActionContinuationService;
    }

    _setDynamicActionClaimGroundingVerifierForTest(service: Pick<DynamicActionClaimGroundingVerifier, 'verify'>): void {
        this.dynamicActionClaimGroundingVerifier = service as DynamicActionClaimGroundingVerifier;
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

    private cancelDynamicActionGateRuns(reason: string): void {
        for (const run of this.dynamicActionGateRuns.values()) {
            run.controller.abort(new Error(reason));
        }
        this.dynamicActionGateRuns.clear();
    }

    private shouldSkipDynamicActionForSpeaker(segment: TranscriptSegment): boolean {
        const verification = segment.speakerVerification;
        if (!verification
            || verification.provider !== 'local-speaker-verification'
            || verification.profileId !== 'me'
            || verification.isMe !== true) {
            return false;
        }

        const { confidence, threshold } = verification;
        return Number.isFinite(confidence)
            && Number.isFinite(threshold)
            && confidence >= threshold;
    }

    private async detectConfirmAndEmitDynamicActions(
        segment: TranscriptSegment,
        latencyContext?: DynamicActionLatencyContext,
    ): Promise<void> {
        if (!this.dynamicActionEngine || !this.currentSessionId
            || !this.currentDynamicActionModeId || !this.currentDynamicActionTemplateType) {
            return;
        }
        if (this.shouldSkipDynamicActionForSpeaker(segment)) {
            return;
        }
        if (segment.speaker !== 'interviewer' && segment.speaker !== 'user') {
            return;
        }
        const text = (segment.text || '').trim();
        if (!text) return;

        const detectorOnlyMode = isDetectorOnlyDynamicActionMode(this.currentDynamicActionTemplateType);
        const detectedTriggers = detectorOnlyMode
            ? this.dynamicActionEngine.detectSignalCandidates({
                transcript: text,
                modeTemplateType: this.currentDynamicActionTemplateType,
                speaker: segment.speaker,
            })
            : undefined;
        if (latencyContext) {
            latencyContext.candidateCount = detectedTriggers?.length;
        }

        if (!detectorOnlyMode || !detectedTriggers) {
            return this.runDynamicActionGate(
                segment,
                text,
                detectorOnlyMode,
                detectedTriggers,
                undefined,
                latencyContext,
            );
        }

        const candidateTypes = [...new Set(detectedTriggers.map(candidate => candidate.trigger.type))].sort();
        const fingerprint = text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
        const candidateKey = candidateTypes.length > 0
            ? candidateTypes.join(',')
            : `detectorless:${fingerprint}`;
        const gateKey = [
            this.currentSessionId,
            this.currentDynamicActionModeId,
            this.currentDynamicActionTemplateType,
            candidateKey,
        ].join('|');
        const existingRun = this.dynamicActionGateRuns.get(gateKey);
        if (existingRun?.fingerprint === fingerprint) {
            return existingRun.promise;
        }
        if (existingRun) {
            existingRun.controller.abort(new Error('dynamic_action_gate_superseded'));
        }

        const controller = new AbortController();
        const promise = this.runDynamicActionGate(
            segment,
            text,
            detectorOnlyMode,
            detectedTriggers,
            controller.signal,
            latencyContext,
        ).finally(() => {
            if (this.dynamicActionGateRuns.get(gateKey)?.controller === controller) {
                this.dynamicActionGateRuns.delete(gateKey);
            }
        });
        this.dynamicActionGateRuns.set(gateKey, { fingerprint, controller, promise });
        return promise;
    }

    private async runDynamicActionGate(
        segment: TranscriptSegment,
        text: string,
        detectorOnlyMode: boolean,
        detectedTriggers?: DetectedSignalCandidate[],
        abortSignal?: AbortSignal,
        latencyContext?: DynamicActionLatencyContext,
    ): Promise<void> {
        const contextItems = this.session.getContext(180);
        const transcriptTurns = this.buildTranscriptTurns(contextItems);
        const anchorRole = segment.speaker === 'user' ? 'user' : 'interviewer';
        this.appendSegmentAnchorIfMissing(transcriptTurns, segment, anchorRole);
        const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);
        const baseIntentOptions = this.buildIntentClassificationOptions();
        const intentOptions = detectorOnlyMode
            ? {
                ...baseIntentOptions,
                cloudIntentClassifier: undefined,
                cloudFirst: false,
                localIntentEnhancementEnabled: false,
                localIntentEnhancementAvailable: false,
            }
            : {
                ...baseIntentOptions,
                cloudFirst: true,
            };
        const intentResult = await classifyIntent(
            text,
            preparedTranscript,
            this.session.getAssistantResponseHistory().length,
            this.currentDynamicActionTemplateType,
            intentOptions,
        );
        if (abortSignal?.aborted) return;

        const gateArbitrationStatuses: SemanticGateArbitrationStatus[] = [];
        const dynamicActionAssessmentNow = Date.now();
        const newActions = await this.dynamicActionEngine.assessSignals({
            transcript: text,
            speaker: segment.speaker,
            modeTemplateType: this.currentDynamicActionTemplateType,
            modeId: this.currentDynamicActionModeId,
            sessionId: this.currentSessionId,
            emotion: segment.emotion,
            emotionSource: segment.emotionSource,
            emotionDegree: segment.emotionDegree,
            emotionScore: segment.emotionScore,
            emotionDegreeScore: segment.emotionDegreeScore,
            intentResult,
            detectedTriggers,
            recentContextTurns: this.buildDynamicActionContextTurns(transcriptTurns),
            providerDataScopes: intentOptions.providerDataScopes,
            selectedModelRunsLocally: this.llmHelper.getCurrentModelExecutionKind() === 'local',
            cloudClassifier: (input) =>
                this.classifyDynamicActionWithCloud(input, abortSignal, latencyContext),
            semanticGateTraceSink: (trace: SemanticGateTrace) => {
                if (abortSignal?.aborted) return;
                getContextQualityDiagnosticsCollector().recordDynamicActionTrace(trace);
                gateArbitrationStatuses.push(trace.arbitrationStatus);
                this.emit('dynamic_action_gate_trace', trace);
            },
            now: dynamicActionAssessmentNow,
        });
        if (abortSignal?.aborted) return;
        if (gateArbitrationStatuses.length > 0) {
            this.emit('dynamic_action_gate_availability', gateArbitrationStatuses);
        }

        const effectiveSegment = this.session.findEffectiveSpeakerVerificationSegment(segment)
            ?? this.session.applySpeakerVerificationOverride(segment);
        if (this.shouldSkipDynamicActionForSpeaker(effectiveSegment)) {
            this.dynamicActionEngine.discardSignalsForAssessment({
                transcript: text,
                speaker: segment.speaker,
                modeTemplateType: this.currentDynamicActionTemplateType,
                sessionId: this.currentSessionId,
                intentResult,
                detectedTriggers,
                now: dynamicActionAssessmentNow,
            });
            for (const action of newActions) {
                this.dynamicActionEngine.discardAction(action.id, { clearSignalState: false });
            }
            return;
        }

        const speakerConfirmation = buildDynamicActionSpeakerConfirmation({
            segment: effectiveSegment,
            hasConsequentialAction: newActions.length > 0,
        });

        // The store dedupes within the per-session store, so each emitted action
        // is a *new* candidate — safe to forward to renderer for rendering.
        for (const action of newActions) {
            if (speakerConfirmation) action.speakerConfirmation = speakerConfirmation;
            this.emit('dynamic_action_emitted', action);
            if (latencyContext) {
                this.emitDynamicActionLatency(latencyContext, 'card_emitted');
            }
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
        const transcriptWindow = this.session.getEffectiveTranscriptTail(12).map((item) => ({
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

        if (this.tryPublishSpeculativeAnswer(trigger)) return;

        const plannerDecision = await this.planSuggestionTrigger(trigger);
        if (plannerDecision.kind === 'silent') {
            console.log('[IntelligenceEngine] Planner stayed silent', { reason: plannerDecision.reason, confidence: plannerDecision.confidence });
            return;
        }

        if (plannerDecision.kind !== 'answer') {
            await this.runPlannerDecision(plannerDecision, trigger.lastQuestion);
            return;
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
    async runWhatShouldISay(question?: string, confidence: number = 0.8, imagePaths?: string[], options?: { speculative?: boolean; skipCooldown?: boolean; screenContext?: ScreenContext; promptInstruction?: string; uploadedMaterialContext?: string; persist?: boolean; source?: string; requestId?: string; activeSkill?: { id: string; name: string; promptBlock: string }; modeEvent?: ModeEventContext; contextDegradedReasons?: string[]; traceSink?: WhatToAnswerTraceSink; providerScopePolicy?: import('./llm/ProviderRouter').ProviderDataScopePolicy; dynamicActionValidation?: DynamicActionRuntimeValidation; dynamicActionEvaluationSink?: (trace: DynamicActionRuntimeEvaluationTrace) => void }): Promise<string | null> {
        const now = Date.now();
        const isSpeculative = options?.speculative === true;
        const skipCooldown = options?.skipCooldown === true;
        const shouldPersist = options?.persist !== false;
        const dynamicActionModeEvent = options?.modeEvent as (ModeEventContext & {
            actionId?: string;
            parentActionId?: string;
            actionType?: string;
            sourceIntent?: string;
            productContract?: {
                outputType?: DynamicActionOutputType;
            };
        }) | undefined;
        const isDynamicActionUsage = options?.source === 'dynamic_action' || Boolean(dynamicActionModeEvent?.actionId);
        const requestId = options?.requestId || `what_${now}_${this.currentGenerationId + 1}`;
        if (
            options?.requestId &&
            this.reservedWhatToSayRequestId &&
            options.requestId !== this.reservedWhatToSayRequestId
        ) {
            return null;
        }

        // Cooldown bypass: explicit images (user intent), speculative pre-fetch, or test harness.
        const hasImages = imagePaths && imagePaths.length > 0;
        if (!hasImages && !isSpeculative && !skipCooldown && now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }

        this.activeWhatToSayAbortController?.abort(new Error('what_to_say request superseded'));
        const requestAbortController = new AbortController();
        this.activeWhatToSayAbortController = requestAbortController;

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
            this.speculativeAnswerState = {
                requestId,
                question: question ?? '',
                status: 'streaming',
                accumulatedAnswer: '',
                startedAt: now,
                expiresAt: Infinity,
                visible: false,
            };
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
            if (
                requestAbortController.signal.aborted ||
                (
                    options?.requestId &&
                    this.reservedWhatToSayRequestId &&
                    this.reservedWhatToSayRequestId !== options.requestId
                )
            ) {
                return null;
            }
            let fullAnswer = "";
            // RC-03 fix: hold a reference to the generator so we can call .return()
            // to properly terminate the network request when a new generation starts.
            const createAnswerStream = (promptInstruction?: string) => this.whatToAnswerLLM.generateStream(
                preparedTranscript,
                temporalContext,
                intentResult,
                imagePaths,
                screenContext,
                promptInstruction,
                options?.uploadedMaterialContext,
                resolvedSkill,
                options?.modeEvent,
                contextDegradedReasons,
                traceSink,
                options?.providerScopePolicy,
                {
                    requestId,
                    requestSource: isSpeculative
                        ? 'automatic'
                        : options?.source === 'dynamic_action'
                            ? 'dynamic_action'
                            : options?.source
                                ? 'manual'
                                : 'automatic',
                    abortSignal: requestAbortController.signal,
                },
            );
            const stream = createAnswerStream(options?.promptInstruction);
            let streamAborted = false;
            let emittedStreamingContent = false;
            const expectedResponseLanguage = resolveDynamicActionResponseLanguage(
                dynamicActionModeEvent?.language,
                dynamicActionModeEvent?.latestTurn,
            );
            const shouldValidateDynamicActionLanguage = isDynamicActionUsage && expectedResponseLanguage !== 'unknown';
            const deferUserVisibleEmission =
                options?.dynamicActionValidation?.deferUserVisibleEmission === true ||
                shouldValidateDynamicActionLanguage;

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
                if (isSpeculative) {
                    if (this.speculativeAnswerState?.requestId === requestId) {
                        this.speculativeAnswerState.accumulatedAnswer = fullAnswer;
                        if (this.speculativeAnswerState.visible) {
                            this.emit('suggested_answer_token', token, question || 'inferred', confidence, requestId);
                        }
                    }
                } else if (deferUserVisibleEmission) {
                    // Capability-fit answers are shown only after grounding verification.
                } else if (!emittedStreamingContent) {
                    if (!IntelligenceEngine.isPotentialNonAnswerSentinelPrefix(fullAnswer)) {
                        this.emit('suggested_answer_token', fullAnswer, question || 'inferred', confidence, requestId);
                        emittedStreamingContent = true;
                    }
                } else {
                    this.emit('suggested_answer_token', token, question || 'inferred', confidence, requestId);
                }
            }

            if (streamAborted) {
                // Aborted mid-stream — don't update session or emit final event
                if (isSpeculative) {
                    this.clearSpeculativeAnswerState();
                    // Stamp lastTriggerTime so the real trigger that caused this abort
                    // doesn't allow a rapid second trigger within the cooldown window.
                    this.lastTriggerTime = Date.now();
                }
                if (this.activeWhatToSayAbortController === requestAbortController) {
                    this.setMode('idle');
                }
                return null;
            }

            if (!fullAnswer || fullAnswer.trim().length < 5) {
                if (isDynamicActionUsage) {
                    throw new Error('dynamic_action_generation_failed');
                }
                fullAnswer = WHAT_TO_ANSWER_FALLBACK;
            }

            fullAnswer = IntelligenceEngine.normalizeSuggestedAnswer(fullAnswer);

            if (
                shouldValidateDynamicActionLanguage &&
                !isDynamicActionResponseLanguageCompatible(fullAnswer, expectedResponseLanguage)
            ) {
                const languageName = expectedResponseLanguage === 'zh' ? 'Simplified Chinese' : 'English';
                const correctionInstruction = `${options?.promptInstruction?.trim() || ''}\n\n` +
                    `[OUTPUT LANGUAGE CORRECTION — HIGHEST PRIORITY]\n` +
                    `The previous answer used the wrong language. Regenerate the complete answer in ${languageName}. ` +
                    `Do not mention this correction and do not translate or quote the previous answer.\n` +
                    `[END OUTPUT LANGUAGE CORRECTION]`;
                const retryStream = createAnswerStream(correctionInstruction);
                let retryAnswer = '';
                for await (const token of retryStream) {
                    if (this.currentGenerationId !== generationId) {
                        await retryStream.return(undefined);
                        streamAborted = true;
                        break;
                    }
                    retryAnswer += token;
                }
                if (streamAborted) {
                    if (this.activeWhatToSayAbortController === requestAbortController) {
                        this.setMode('idle');
                    }
                    return null;
                }
                retryAnswer = IntelligenceEngine.normalizeSuggestedAnswer(retryAnswer);
                if (
                    !retryAnswer ||
                    !isDynamicActionResponseLanguageCompatible(retryAnswer, expectedResponseLanguage)
                ) {
                    throw new Error('dynamic_action_language_mismatch');
                }
                fullAnswer = retryAnswer;
            }

            if (IntelligenceEngine.isNonAnswerSentinel(fullAnswer)) {
                if (isDynamicActionUsage) {
                    throw new Error('dynamic_action_generation_failed');
                }
                if (isSpeculative) {
                    this.clearSpeculativeAnswerState();
                    this.lastTriggerTime = Date.now();
                }
                this.setMode('idle');
                return null;
            }

            let visibleAnswer = fullAnswer;
            let evaluationResult: 'passed' | 'safe_fallback' | undefined;
            let claimGrounding: ClaimGroundingVerdict | undefined;
            const runtimeValidationPolicy = options?.dynamicActionValidation
                ? getDynamicActionRuntimeValidationPolicy(options.dynamicActionValidation.actionType)
                : null;
            if (options?.dynamicActionValidation) {
                claimGrounding = runtimeValidationPolicy?.evidenceKind === 'transcript_evidence'
                    ? buildNotRequiredClaimGroundingVerdict()
                    : await this.dynamicActionClaimGroundingVerifier.verify({
                        answerText: fullAnswer,
                        evidence: options.dynamicActionValidation.grounding.injectedEvidence,
                        claimDomain: runtimeValidationPolicy?.claimDomain ?? 'capability',
                        providerDataScopes: options.dynamicActionValidation.providerDataScopes,
                    });
                const evaluation = evaluateDynamicActionAcceptedOutput({
                    actionType: options.dynamicActionValidation.actionType,
                    outputType: dynamicActionModeEvent?.productContract?.outputType ?? 'spoken_response',
                    answerText: fullAnswer,
                    groundedSources: options.dynamicActionValidation.grounding.groundedSources,
                    claimGrounding,
                    sourceIntent: options.dynamicActionValidation.sourceIntent,
                    sourceUtterance: options.dynamicActionValidation.sourceUtterance ?? question,
                    transcriptEvidence: options.dynamicActionValidation.transcriptEvidence,
                });
                evaluationResult = evaluation.passed ? 'passed' : 'safe_fallback';
                if (!evaluation.passed) {
                    visibleAnswer = buildDynamicActionRuntimeSafeFallback(
                        options.dynamicActionValidation.actionType,
                        expectedResponseLanguage,
                    ) ?? fullAnswer;
                }
                options.dynamicActionEvaluationSink?.({
                    actionType: options.dynamicActionValidation.actionType,
                    parentActionId: options.dynamicActionValidation.parentActionId,
                    result: evaluationResult,
                    failureCodes: [
                        ...evaluation.requiredPatternFailures,
                        ...evaluation.forbiddenPatternFailures,
                        ...evaluation.groundingFailures,
                        ...evaluation.missingFieldFailures,
                    ],
                    claimGroundingVerdict: claimGrounding.verdict,
                    claimGroundingReasonCode: claimGrounding.reasonCode,
                });
            }

            if (isSpeculative) {
                this.lastTriggerTime = Date.now();
                this.speculativeTextExpiry = this.lastTriggerTime + this.triggerCooldown + 500;
                const speculative = this.speculativeAnswerState?.requestId === requestId
                    ? this.speculativeAnswerState
                    : null;
                if (speculative) {
                    speculative.status = 'completed';
                    speculative.accumulatedAnswer = visibleAnswer;
                    speculative.completedAt = this.lastTriggerTime;
                    speculative.expiresAt = this.speculativeTextExpiry;
                }
                if (!speculative?.visible) {
                    this.setMode('idle');
                    return visibleAnswer;
                }
            }

            const usageQuestion = IntelligenceEngine.inferUsageQuestionLabel(question, preparedTranscript);
            const usageEntry: any = {
                type: 'assist',
                timestamp: Date.now(),
                question: usageQuestion,
                answer: visibleAnswer,
                ...(isDynamicActionUsage ? {
                    metadata: runtimeValidationPolicy?.evidenceKind === 'transcript_evidence'
                        ? {
                            source: 'dynamic_action',
                            actionType: dynamicActionModeEvent?.actionType ?? dynamicActionModeEvent?.intent,
                            sourceIntent: dynamicActionModeEvent?.sourceIntent,
                            actionId: dynamicActionModeEvent?.actionId,
                            parentActionId: dynamicActionModeEvent?.parentActionId,
                            modeTemplateType: dynamicActionModeEvent?.modeTemplateType,
                            evidenceKind: runtimeValidationPolicy.evidenceKind,
                            outputType: dynamicActionModeEvent?.productContract?.outputType,
                            generationStatus: 'completed',
                            ...(evaluationResult ? { evaluationResult } : {}),
                            ...(claimGrounding ? {
                                claimGroundingVerdict: claimGrounding.verdict,
                                claimGroundingReasonCode: claimGrounding.reasonCode,
                            } : {}),
                        }
                        : {
                            source: 'dynamic_action',
                            actionType: dynamicActionModeEvent?.actionType ?? dynamicActionModeEvent?.intent,
                            sourceIntent: dynamicActionModeEvent?.sourceIntent,
                            actionId: dynamicActionModeEvent?.actionId,
                            parentActionId: dynamicActionModeEvent?.parentActionId,
                            modeTemplateType: dynamicActionModeEvent?.modeTemplateType,
                            retrievalQuery: dynamicActionModeEvent?.retrievalQuery,
                            outputType: dynamicActionModeEvent?.productContract?.outputType,
                            generationStatus: 'completed',
                            groundedSources: options?.dynamicActionValidation?.grounding.groundedSources ?? [],
                            ...(evaluationResult ? { evaluationResult } : {}),
                            ...(claimGrounding ? {
                                claimGroundingVerdict: claimGrounding.verdict,
                                claimGroundingReasonCode: claimGrounding.reasonCode,
                            } : {}),
                        },
                } : {}),
            };

            if (!isSpeculative && !emittedStreamingContent) {
                this.emit('suggested_answer_token', visibleAnswer, usageQuestion, confidence, requestId);
            }

            if (shouldPersist) {
                this.session.addAssistantMessage(visibleAnswer);
                this.session.pushUsage(usageEntry);
            }

            this.emit('suggested_answer', visibleAnswer, usageQuestion, confidence, requestId);

            if (isSpeculative) this.clearSpeculativeAnswerState();

            this.setMode('idle');
            return visibleAnswer;

        } catch (error) {
            if (isSpeculative) this.clearSpeculativeAnswerState();
            if (requestAbortController.signal.aborted) {
                if (this.activeWhatToSayAbortController === requestAbortController) {
                    this.setMode('idle');
                }
                return null;
            }
            this.emit('error', error as Error, 'what_to_say', requestId);
            this.setMode('idle');
            const message = error instanceof Error ? error.message : String(error);
            if (isDynamicActionUsage || /QCLOUD|stream_interrupted/i.test(message)) {
                throw error;
            }
            return WHAT_TO_ANSWER_FALLBACK;
        } finally {
            if (this.activeWhatToSayAbortController === requestAbortController) {
                this.activeWhatToSayAbortController = null;
            }
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
            // If no transcript exists yet, ask a mode-aware scoping question.
            const context = rawContext || buildClarifyNoTranscriptFallbackContext(this.getActiveClarifyModeTemplateType());

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
        this.speculativeAnswerState = null;
        this.cancelDynamicActionGateRuns('intelligence_engine_reset');
        SkillActivationManager.getInstance().clearMeetingActivations();
        SkillWatcherService.getInstance().clearSessionState();
    }
}
