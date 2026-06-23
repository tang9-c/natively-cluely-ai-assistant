import * as crypto from 'crypto';
import { DynamicAction, EvidenceRef } from './DynamicAction';
import { DynamicActionStore } from './DynamicActionStore';
import { ActionTrigger, DynamicActionDetector, MODE_TRIGGERS } from './DynamicActionDetector';
import { buildRetrievalQuery, detectLanguage, extractKeyEntities } from './ModeEventUtils';
import { SignalStateTracker, SignalConfirmationSource } from './SignalStateTracker';
import type { IntentResult } from '../../llm/IntentClassifier';

export class DynamicActionEngine {
    private store: DynamicActionStore;
    private detector: DynamicActionDetector;
    private signalTracker: SignalStateTracker;

    constructor(
        store: DynamicActionStore = new DynamicActionStore(),
        detector: DynamicActionDetector = new DynamicActionDetector(MODE_TRIGGERS),
        signalTracker: SignalStateTracker = new SignalStateTracker()
    ) {
        this.store = store;
        this.detector = detector;
        this.signalTracker = signalTracker;
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
            const action = this.buildAction({
                trigger,
                match,
                transcript,
                speaker,
                modeTemplateType,
                modeId,
                sessionId,
                language,
                keyEntities,
                emotion: params.emotion,
                emotionSource: params.emotionSource,
                confidence: trigger.priority,
                now,
                autoSurfaceEligible: trigger.priority >= 0.9,
                confirmationSource: 'trigger',
            });

            // Check deduplication
            const deduplicatedAction = this.store.deduplicate(action);
            if (deduplicatedAction) {
                candidateActions.push(deduplicatedAction);
                this.store.addAction(deduplicatedAction);
            }
        }

        return candidateActions;
    }

    assessSignals(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
        emotion?: string;
        emotionSource?: string;
        language?: string;
        intentResult?: IntentResult;
        now?: number;
    }): DynamicAction[] {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = params.now ?? Date.now();
        const language = params.language || detectLanguage(transcript);
        const keyEntities = extractKeyEntities(transcript);
        const candidateActions: DynamicAction[] = [];
        const matchedTriggers = this.detector.detectTriggers({ transcript, modeTemplateType });
        const triggerCandidates = matchedTriggers.map(({ trigger, match }) => ({
            trigger,
            match,
            confidence: this.scoreTrigger(trigger, modeTemplateType, params.intentResult),
            confirmationSource: this.confirmationSourceFor(params.intentResult),
            confirmedIntent: params.intentResult?.intent,
        }));
        const synthTrigger = matchedTriggers.length === 0
            ? this.synthesizeTrigger(modeTemplateType, params.intentResult)
            : null;

        if (synthTrigger) {
            triggerCandidates.push({
                trigger: synthTrigger,
                match: params.intentResult?.intent ?? synthTrigger.type,
                confidence: params.intentResult?.confidence ?? synthTrigger.priority,
                confirmationSource: this.confirmationSourceFor(params.intentResult),
                confirmedIntent: params.intentResult?.intent,
            });
        }

        for (const candidate of triggerCandidates) {
            const evidenceRef: EvidenceRef = {
                source: 'transcript',
                text: transcript,
                timestamp: now,
                speaker,
            };
            const adjustedConfidence = this.applyEmotionBoost(candidate.trigger.type, candidate.confidence, params.emotion);
            const signal = this.signalTracker.assess({
                sessionId,
                modeTemplateType,
                signalType: candidate.trigger.type,
                confidence: adjustedConfidence,
                evidenceRef,
                latestTurn: transcript,
                emotion: params.emotion,
                confirmationSource: candidate.confirmationSource,
                confirmedIntent: candidate.confirmedIntent,
                now,
            });
            if (!signal.shouldStoreAction) continue;

            const action = this.buildAction({
                trigger: candidate.trigger,
                match: candidate.match,
                transcript,
                speaker,
                modeTemplateType,
                modeId,
                sessionId,
                language,
                keyEntities,
                emotion: params.emotion,
                emotionSource: params.emotionSource,
                confidence: signal.state.confidence,
                now,
                autoSurfaceEligible: signal.autoSurfaceEligible || this.isStrongAutoSignal(candidate.trigger.type, signal.state.confidence),
                confirmationSource: candidate.confirmationSource,
                confirmedIntent: candidate.confirmedIntent,
                signalStatus: signal.state.status,
                evidenceRefs: signal.state.evidenceRefs,
            });

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
        const action = this.store.getAction(actionId);
        if (action) {
            this.signalTracker.dismiss(action.sessionId, action.modeTemplateType, action.type);
        }
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

    private buildAction(params: {
        trigger: ActionTrigger;
        match: string;
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
        language: string;
        keyEntities: string[];
        emotion?: string;
        emotionSource?: string;
        confidence: number;
        now: number;
        autoSurfaceEligible: boolean;
        confirmationSource?: SignalConfirmationSource;
        confirmedIntent?: string;
        signalStatus?: DynamicAction['signalStatus'];
        evidenceRefs?: EvidenceRef[];
    }): DynamicAction {
        const evidenceRefs = params.evidenceRefs ?? [{
            source: 'transcript' as const,
            text: params.transcript,
            timestamp: params.now,
            speaker: params.speaker,
        }];
        const autoSurfacePolicy = params.autoSurfaceEligible ? 'auto' : 'card';
        const retrievalQuery = buildRetrievalQuery({
            modeTemplateType: params.modeTemplateType,
            intent: params.trigger.type,
            keyEntities: params.keyEntities,
            latestTurn: params.transcript,
            emotion: params.emotion,
            language: params.language,
        });

        return {
            id: `action_${crypto.randomUUID()}`,
            sessionId: params.sessionId,
            modeId: params.modeId,
            modeTemplateType: params.modeTemplateType,
            type: params.trigger.type,
            label: params.trigger.label,
            description: `Triggered by: "${params.match}"`,
            confidence: params.confidence,
            priority: params.confidence,
            evidenceRefs,
            status: 'candidate',
            createdAt: params.now,
            promptInstruction: params.trigger.promptInstruction,
            sourceIntent: params.trigger.type,
            latestTurn: params.transcript,
            language: params.language,
            emotion: params.emotion,
            emotionSource: params.emotionSource,
            keyEntities: params.keyEntities,
            retrievalQuery,
            autoSurfacePolicy,
            autoTriggerEligible: autoSurfacePolicy === 'auto',
            autoTriggerReason: autoSurfacePolicy === 'auto'
                ? 'confirmed_repeated_signal'
                : 'confirmed_signal_card',
            signalStatus: params.signalStatus,
            evidenceCount: evidenceRefs.length,
            confirmationSource: params.confirmationSource,
            confirmedIntent: params.confirmedIntent,
            answerStyle: params.trigger.answerStyle,
        };
    }

    private scoreTrigger(trigger: ActionTrigger, modeTemplateType: string, intentResult?: IntentResult): number {
        if (!intentResult || intentResult.intent === 'general') return trigger.priority;
        const mappedType = this.mapIntentToActionType(modeTemplateType, intentResult.intent);
        if (mappedType === trigger.type) {
            return trigger.priority * 0.45 + intentResult.confidence * 0.55;
        }
        return trigger.priority;
    }

    private confirmationSourceFor(intentResult?: IntentResult): SignalConfirmationSource {
        if (!intentResult) return 'trigger';
        return intentResult.confidence >= 0.5 ? 'cloud_intent' : 'heuristic';
    }

    private applyEmotionBoost(type: string, confidence: number, emotion?: string): number {
        if (!emotion) return confidence;
        const negative = ['angry', 'sad', 'fearful', 'disgusted'].includes(emotion);
        const positive = ['happy', 'surprised'].includes(emotion);
        const objectionLike = /(objection|pushback|risk|blocker|concern|weakness)/.test(type);
        const positiveLike = /(buying_signal|strong_fit|fit_signal)/.test(type);
        if (negative && objectionLike) return Math.min(0.98, confidence + 0.04);
        if (positive && positiveLike) return Math.min(0.98, confidence + 0.04);
        return confidence;
    }

    private isStrongAutoSignal(type: string, confidence: number): boolean {
        return confidence >= 0.9 && ['buying_signal', 'final_offer', 'coding_problem'].includes(type);
    }

    private synthesizeTrigger(modeTemplateType: string, intentResult?: IntentResult): ActionTrigger | null {
        if (!intentResult || intentResult.confidence < 0.75) return null;
        const type = this.mapIntentToActionType(modeTemplateType, intentResult.intent);
        if (!type) return null;
        const trigger = this.detector.getTriggerForType(type);
        if (trigger) return trigger;
        return this.syntheticTriggerFor(type, modeTemplateType);
    }

    private mapIntentToActionType(modeOrCurrentType: string, intent: string): string | null {
        const byMode: Record<string, Record<string, string>> = {
            general: {
                define_term: 'general_explain',
                advance_dialog: 'general_assistance_request',
                general: 'general_assistance_request',
            },
            sales: {
                handle_objection: 'pricing_objection',
                seize_signal: 'buying_signal',
                discovery_probe: 'pricing_request',
            },
            recruiting: {
                evaluate_answer: 'candidate_experience_probe',
                request_example: 'candidate_experience_probe',
            },
            'team-meet': {
                capture_action: 'action_item',
                capture_decision: 'decision_point',
                capture_risk: 'blocker_check',
                status_update: 'owner_deadline_check',
            },
            'looking-for-work': {
                behavioral: 'behavioral_question',
                example_request: 'behavioral_question',
                deep_dive: 'company_motivation',
                follow_up: 'intro_pitch',
            },
            'technical-interview': {
                coding: 'coding_problem',
                deep_dive: 'complexity_analysis',
                clarification: 'screen_coding_problem',
            },
            lecture: {
                explain_concept: 'concept_explanation',
                render_formula: 'concept_explanation',
                answer_class_question: 'worked_example',
            },
        };
        return byMode[modeOrCurrentType]?.[intent] ?? null;
    }

    private syntheticTriggerFor(type: string, modeTemplateType: string): ActionTrigger | null {
        const labels: Record<string, string> = {
            pricing_objection: '处理价格异议',
            buying_signal: '推进下一步',
            action_item: '捕捉行动项',
            decision_point: '确认决策',
            blocker_check: '澄清阻塞',
            coding_problem: '解技术题',
            concept_explanation: '解释概念',
            general_assistance_request: '建议回应',
            general_explain: '解释清楚',
        };
        const label = labels[type];
        if (!label) return null;
        return {
            type,
            patterns: [],
            priority: 0.8,
            label,
            promptInstruction: `You are in ${modeTemplateType} mode. Respond in Chinese first and help the user handle the detected ${type} intent.`,
            answerStyle: { maxWords: 120, format: 'bullets', tone: 'clear' },
        };
    }
}
