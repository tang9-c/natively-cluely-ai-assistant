// IntelligenceManager.ts
// Thin facade that delegates to focused sub-modules.
// Maintains full backward compatibility — all existing callers continue to work unchanged.
//
// Sub-modules:
//   SessionTracker     — state, transcript arrays, context management, epoch compaction
//   IntelligenceEngine — LLM mode routing (6 modes), event emission
//   MeetingPersistence — meeting stop/save/recovery

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker } from './SessionTracker';
import { IntelligenceEngine, ClarifyResult, type RunCodeHintOptions } from './IntelligenceEngine';
import { MeetingPersistence } from './MeetingPersistence';
import { ScreenContext } from './services/screen/types';
import type { ModeEventContext } from './llm';
import type { WhatToAnswerTraceSink } from './llm/WhatToAnswerLLM';

// Re-export types for backward compatibility
export type { TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
export type { IntelligenceMode, IntelligenceModeEvents } from './IntelligenceEngine';
export type { DynamicAction } from './services/dynamic-actions/DynamicAction';

export const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview";

/**
 * IntelligenceManager - Facade for the intelligence layer.
 * 
 * Delegates to:
 * - SessionTracker:     context, transcripts, epoch summaries
 * - IntelligenceEngine: LLM modes (assist, whatToSay, followUp, recap, clarify, manual, followUpQuestions)
 * - MeetingPersistence: meeting stop/save/recovery
 */
export class IntelligenceManager extends EventEmitter {
    private session: SessionTracker;
    private engine: IntelligenceEngine;
    private persistence: MeetingPersistence;

    constructor(llmHelper: LLMHelper) {
        super();
        this.session = new SessionTracker();
        this.engine = new IntelligenceEngine(llmHelper, this.session);
        this.persistence = new MeetingPersistence(this.session, llmHelper);

        // Forward all engine events through the facade
        this.forwardEngineEvents();
    }

    /**
     * Forward all events from IntelligenceEngine through this facade
     * so existing listeners on IntelligenceManager continue to work.
     */
    private forwardEngineEvents(): void {
        const events = [
            'assist_update', 'suggested_answer', 'suggested_answer_token',
            'refined_answer', 'refined_answer_token',
            'recap', 'recap_token', 'clarify', 'clarify_token',
            'follow_up_questions_update', 'follow_up_questions_token',
            'manual_answer_started', 'manual_answer_result',
            'mode_changed', 'error',
            // Sprint 7: dedicated channel for negotiation coaching payloads.
            'negotiation_coaching',
            // Phase 3: Cluely-style dynamic action card emissions.
            'dynamic_action_emitted',
            'dynamic_action_gate_trace',
            'dynamic_action_gate_availability',
            'dynamic_action_latency_trace',
            'code_hint_trace',
            'skill_watcher_suggestion_created',
        ];

        for (const event of events) {
            this.engine.on(event, (...args: any[]) => {
                this.emit(event, ...args);
            });
        }
    }

    // ============================================
    // LLM Initialization (delegates to engine)
    // ============================================

    initializeLLMs(): void {
        // Cancel any in-flight streams before swapping LLM clients
        this.engine.reset();
        this.engine.initializeLLMs();
    }

    reinitializeLLMs(): void {
        this.engine.reset();
        this.engine.reinitializeLLMs();
    }

    // ============================================
    // Context Management (delegates to session)
    // ============================================

    setMeetingMetadata(metadata: any): void {
        this.session.setMeetingMetadata(metadata);
    }

    addTranscript(segment: import('./SessionTracker').TranscriptSegment, skipRefinementCheck: boolean = false): void {
        if (skipRefinementCheck) {
            // Direct add without refinement detection
            this.session.addTranscript(segment);
        } else {
            // Let the engine handle transcript + refinement detection
            this.engine.handleTranscript(segment, false);
        }
    }

    addAssistantMessage(text: string): void {
        this.session.addAssistantMessage(text);
    }

    getContext(lastSeconds: number = 120) {
        return this.session.getContext(lastSeconds);
    }

    getLastAssistantMessage(): string | null {
        return this.session.getLastAssistantMessage();
    }

    getFormattedContext(lastSeconds: number = 120): string {
        return this.session.getFormattedContext(lastSeconds);
    }

    getLastInterviewerTurn(): string | null {
        return this.session.getLastInterviewerTurn();
    }

    logUsage(type: string, question: string, answer: string): void {
        this.session.logUsage(type, question, answer);
    }

    // ============================================
    // Transcript Handling (delegates to engine)
    // ============================================

    handleTranscript(segment: import('./SessionTracker').TranscriptSegment) {
        return this.engine.handleTranscript(segment);
    }

    setSpeakerVerificationSessionOverride(input: import('./SessionTracker').SpeakerVerificationSessionOverride): boolean {
        const applied = this.session.setSpeakerVerificationOverride(input);
        if (!applied) return false;
        const segment = this.session.findEffectiveSpeakerVerificationSegment(input);
        if (segment) {
            this.engine.handleSpeakerVerificationSessionOverride(segment, input.action);
        }
        return true;
    }

    resetSpeakerVerificationSessionOverrides(): void {
        this.session.clearSpeakerVerificationOverrides();
    }

    async handleSuggestionTrigger(trigger: import('./SessionTracker').SuggestionTrigger): Promise<void> {
        return this.engine.handleSuggestionTrigger(trigger);
    }

    // ============================================
    // Mode Executors (delegates to engine)
    // ============================================

    async runAssistMode(): Promise<string | null> {
        return this.engine.runAssistMode();
    }

    reserveWhatShouldISayRequest(requestId?: string): void {
        this.engine.reserveWhatShouldISayRequest(requestId);
    }

    async runWhatShouldISay(question?: string, confidence?: number, imagePaths?: string[], options?: Parameters<typeof this.engine.runWhatShouldISay>[3]): Promise<string | null> {
        return this.engine.runWhatShouldISay(question, confidence, imagePaths, options);
    }

    async runRecap(): Promise<string | null> {
        return this.engine.runRecap();
    }

    async runClarify(): Promise<ClarifyResult> {
        return this.engine.runClarify();
    }

    async runManualAnswer(question: string): Promise<string | null> {
        return this.engine.runManualAnswer(question);
    }

    async runCodeHint(imagePaths?: string[], problemStatement?: string, options?: RunCodeHintOptions): Promise<string | null> {
        return this.engine.runCodeHint(imagePaths, problemStatement, options);
    }

    setCodingQuestion(question: string, source: 'screenshot' | 'transcript'): void {
        this.session.setCodingQuestion(question, source);
    }

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null } {
        return this.session.getDetectedCodingQuestion();
    }

    clearCodingQuestion(): void {
        this.session.clearCodingQuestion();
    }

    async runBrainstorm(imagePaths?: string[], problemStatement?: string): Promise<string | null> {
        return this.engine.runBrainstorm(imagePaths, problemStatement);
    }

    // ============================================
    // State Management
    // ============================================

    getActiveMode() {
        return this.engine.getActiveMode();
    }

    setMode(mode: import('./IntelligenceEngine').IntelligenceMode): void {
        // This was private in the original, but kept for compatibility
        (this.engine as any).setMode(mode);
    }

    // ============================================
    // Meeting Lifecycle (delegates to persistence)
    // ============================================

    async stopMeeting(): Promise<string | null> {
        try {
            return await this.persistence.stopMeeting();
        } finally {
            this.session.clearSpeakerVerificationOverrides();
        }
    }

    async recoverUnprocessedMeetings(): Promise<void> {
        return this.persistence.recoverUnprocessedMeetings();
    }

    // ============================================
    // Mode Context Management
    // ============================================

    /**
     * Clear mode-specific transient context without resetting the full session.
     * Called when user switches modes to prevent old mode's context (Interviewer
     * Q's, JD context, assistant response history) from bleeding into the new mode.
     */
    clearSessionContext(): void {
        this.session.clearSessionContext();
    }

    // ============================================
    // Phase 3 — Dynamic Actions facade
    // ============================================

    /**
     * Bind dynamic-action engine to the active meeting/mode.
     * Caller is the IPC handler that starts a meeting (with sessionId) or
     * the modes:set-active handler that switches the active mode mid-meeting.
     */
    setDynamicActionContext(params: { sessionId: string; modeId: string; modeTemplateType: string }): void {
        this.engine.setDynamicActionContext(params);
    }

    clearDynamicActionContext(): void {
        this.engine.clearDynamicActionContext();
    }

    acceptDynamicAction(actionId: string, options?: { triggerSource?: import('./services/dynamic-actions/DynamicAction').DynamicActionAcceptTriggerSource }): import('./services/dynamic-actions/DynamicAction').DynamicAction | null {
        return this.engine.acceptDynamicAction(actionId, options);
    }

    confirmDynamicActionSpeaker(
        confirmation: import('../shared/speakerConfirmation').DynamicActionSpeakerConfirmation,
    ): import('./services/dynamic-actions/DynamicAction').DynamicAction[] {
        return this.engine.confirmDynamicActionSpeaker(confirmation);
    }

    markDynamicActionShown(actionId: string): import('./services/dynamic-actions/DynamicAction').DynamicAction | null {
        return this.engine.markDynamicActionShown(actionId);
    }

    getDynamicActionById(actionId: string): import('./services/dynamic-actions/DynamicAction').DynamicAction | null {
        return this.engine.getDynamicActionById(actionId);
    }

    completeDynamicAction(actionId: string): import('./services/dynamic-actions/DynamicAction').DynamicAction | null {
        return this.engine.completeDynamicAction(actionId);
    }

    markDynamicActionGenerationFailed(actionId: string): import('./services/dynamic-actions/DynamicAction').DynamicAction | null {
        return this.engine.markDynamicActionGenerationFailed(actionId);
    }

    dismissDynamicAction(actionId: string): void {
        this.engine.dismissDynamicAction(actionId);
    }

    getActiveDynamicActions(): import('./services/dynamic-actions/DynamicAction').DynamicAction[] {
        return this.engine.getActiveDynamicActions();
    }

    getActiveDynamicActionsWithExpired(): { actions: import('./services/dynamic-actions/DynamicAction').DynamicAction[]; expired: import('./services/dynamic-actions/DynamicAction').DynamicAction[] } {
        return this.engine.getActiveDynamicActionsWithExpired();
    }

    // ============================================
    // Reset (resets all sub-modules)
    // ============================================

    /**
     * resetEngine: Cancel in-flight LLM streams WITHOUT touching session state.
     * Use this when swapping API keys or providers mid-session so the transcript
     * is not wiped. (full reset() also clears the session — only use that at
     * end of meeting or explicit session teardown.)
     */
    resetEngine(): void {
        this.engine.reset();
    }

    reset(): void {
        this.session.reset();
        this.engine.reset();
    }
}
