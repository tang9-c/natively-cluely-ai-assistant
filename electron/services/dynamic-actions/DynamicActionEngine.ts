import * as crypto from 'crypto';
import { DynamicAction, DynamicActionAcceptTriggerSource, EvidenceRef } from './DynamicAction';
import { buildDynamicActionProductContract } from './DynamicActionProductContract';
import { DynamicActionStore } from './DynamicActionStore';
import { ActionTrigger, DynamicActionDetector, MODE_TRIGGERS } from './DynamicActionDetector';
import { buildRetrievalQuery, detectLanguage, extractKeyEntities } from './ModeEventUtils';
import {
    CloudSemanticGateClassifier,
    ModeEventCandidate,
    ModeEventClassifier,
    ModeEventClassifierOptions,
    ModeEventContextTurn,
    SemanticGateTrace,
} from './ModeEventClassifier';
import { SignalStateTracker, SignalConfirmationSource } from './SignalStateTracker';
import type { IntentResult } from '../../llm/IntentClassifier';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { TranscriptEmotionSource } from '../../../shared/senseVoiceEmotion';

const HIGH_RISK_ACTION_TYPES = new Set([
    'pricing_objection',
    'pricing_request',
    'case_study_request',
    'technical_requirements',
    'buying_signal',
]);

const FAST_PATH_ACTION_TYPES = new Set([
    'send_contract',
    'schedule_meeting',
    'coding_problem',
    'action_item',
]);

const SALES_PROMPT_INSTRUCTIONS: Record<string, string> = {
    pricing_objection:
        'You are in Sales mode. The prospect raised a pricing or budget objection. Generate 1-3 sentences the seller can say aloud. Start by acknowledging the concern, do not list generic value points, do not invent ROI, discount, price, customer names, or terms, and end with one forward question.',
    pricing_request:
        'You are in Sales mode. The prospect asked for a quote, proposal, pricing, or commercial terms. Generate an email draft with greeting, short body, and sign-off. Use [CUSTOMER_NAME], [QUOTE_AMOUNT], [SCOPE], and [NEXT_STEP] unless exact trusted context provides values. Do not invent pricing, customer names, account numbers, contract terms, or commercial terms.',
    case_study_request:
        'You are in Sales mode. The prospect asked for a case study, similar customer, ROI, or proof. Use uploaded/reference/trusted context first. If no grounded case or proof is present, say that the provided materials do not include a matching proof point and ask what proof would be useful. Do not invent customer names, metrics, outcomes, or ROI.',
    technical_requirements:
        'You are in Sales mode. The prospect raised technical, security, API, SSO, integration, or deployment requirements. Clarify systems, APIs, auth, deployment environment, security constraints, owners, and the smallest validation step. Do not promise capability before validation.',
    buying_signal:
        'You are in Sales mode. The prospect showed buying or next-step intent. Lock next step, owner, date, and artifact. If owner/date/artifact is missing, ask for the missing field instead of inventing it.',
};

const FDE_PROMPT_INSTRUCTIONS: Record<string, string> = {
    fde_discovery_probe:
        'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Ask 3 manufacturing-process clarification questions about the workflow, system object such as BOM/ECO/ECN/CAPA/NCR/8D, stakeholder, permission boundary, and validation artifact.',
    fde_integration_check:
        'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Clarify source system, target system, auth/SSO method, role/permission model, data direction, read/write boundary, environment, owner, date, and validation artifact.',
    fde_security_review:
        'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Identify the PLM/QMS object or data involved, system-permission risk, required reviewer, human confirmation point, and validation artifact.',
    fde_risk_blocker:
        'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Split the risk into customer-process risk, system-permission risk, delivery risk, AI Agent error risk, or missing information. State impact, dependency, owner if present, date if present, and the smallest validation artifact to unblock.',
    fde_agent_feasibility:
        'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Identify what can be suggested by AI, what requires human confirmation, what must remain read-only, and which human-reviewed approval-flow recommendations need owner/date/artifact validation. Do not imply automatic writes, approvals, or updates to PLM or QMS.',
    fde_success_criteria:
        'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Convert the validation discussion into acceptance criteria covering accuracy, permission boundary, human confirmation point, audit traceability, test data, owner, date, and validation artifact.',
    fde_next_step:
        'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Convert the discussion into owner, deliverable, date, validation artifact, test data, and acceptance criteria. Ask directly for any missing owner/date/artifact field instead of inventing it.',
};

export class DynamicActionEngine {
    private store: DynamicActionStore;
    private detector: DynamicActionDetector;
    private signalTracker: SignalStateTracker;
    private semanticGate: ModeEventClassifier;

    constructor(
        store: DynamicActionStore = new DynamicActionStore(),
        detector: DynamicActionDetector = new DynamicActionDetector(MODE_TRIGGERS),
        signalTracker: SignalStateTracker = new SignalStateTracker(),
        semanticGateOptions: ModeEventClassifierOptions = {}
    ) {
        this.store = store;
        this.detector = detector;
        this.signalTracker = signalTracker;
        this.semanticGate = new ModeEventClassifier(semanticGateOptions);
    }

    /**
     * Legacy synchronous regex detector used by older tests and low-risk trigger
     * pack smoke checks. Production dynamic action emission must use
     * assessSignals(), which applies action-level semantic gating before storing
     * or emitting high-risk actions.
     */
    detectActions(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
        emotion?: string;
        emotionSource?: TranscriptEmotionSource;
        language?: string;
    }): DynamicAction[] {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = Date.now();
        const candidateActions: DynamicAction[] = [];
        const language = params.language || detectLanguage(transcript);
        const keyEntities = extractKeyEntities(transcript, modeTemplateType);

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

    async assessSignals(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
        emotion?: string;
        emotionSource?: TranscriptEmotionSource;
        language?: string;
        intentResult?: IntentResult;
        recentContextTurns?: ModeEventContextTurn[];
        providerDataScopes?: ProviderDataScopePolicy;
        cloudClassifier?: CloudSemanticGateClassifier;
        semanticGateTraceSink?: (trace: SemanticGateTrace) => void;
        now?: number;
    }): Promise<DynamicAction[]> {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = params.now ?? Date.now();
        const language = params.language || detectLanguage(transcript);
        const keyEntities = extractKeyEntities(transcript, modeTemplateType);
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

        const gateCandidates: ModeEventCandidate[] = triggerCandidates.map(candidate => ({
            actionType: candidate.trigger.type,
            label: candidate.trigger.label,
            match: candidate.match,
            confidence: candidate.confidence,
            highRisk: HIGH_RISK_ACTION_TYPES.has(candidate.trigger.type),
            fastPathEligible: FAST_PATH_ACTION_TYPES.has(candidate.trigger.type),
        }));
        const gateDecisions = await this.semanticGate.assess({
            transcript,
            recentContextTurns: params.recentContextTurns,
            modeTemplateType,
            speaker,
            candidates: gateCandidates,
            activeActionTypes: this.store.getActiveActions(sessionId).map(action => action.type),
            intentResult: params.intentResult,
            providerDataScopes: params.providerDataScopes,
            cloudClassifier: params.cloudClassifier,
        });
        const allRegexCandidates = gateCandidates.map(candidate => `${candidate.actionType}:${candidate.match}`);
        for (const gateDecision of gateDecisions) {
            try {
                params.semanticGateTraceSink?.(
                    this.buildSemanticGateTrace(gateDecision, allRegexCandidates, false)
                );
            } catch {
                // Diagnostics must never change dynamic action behavior.
            }
        }

        for (const candidate of triggerCandidates) {
            const gateDecision = gateDecisions.find(decision => decision.candidate.actionType === candidate.trigger.type);
            if (!gateDecision || !['pass', 'fast_path'].includes(gateDecision.decision)) continue;

            const evidenceRef: EvidenceRef = {
                source: 'transcript',
                text: transcript,
                timestamp: now,
                speaker,
            };
            const adjustedConfidence = this.applyEmotionBoost(candidate.trigger.type, gateDecision.confidence, params.emotion);
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
                semanticGate: this.buildSemanticGateTrace(gateDecision, allRegexCandidates, signal.state.evidenceRefs.length > 1),
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
        return this.getTopActionsWithExpired(sessionId, maxAgeMs).actions;
    }

    getTopActionsWithExpired(
        sessionId: string,
        maxAgeMs: number = 60000,
        now?: number,
    ): { actions: DynamicAction[]; expired: DynamicAction[] } {
        const expired = this.store.expireStaleActions(sessionId, maxAgeMs, now);
        const activeActions = this.store.getActiveActions(sessionId, now);
        return {
            actions: activeActions
                .sort((a, b) => b.priority - a.priority)
                .slice(0, 3),
            expired,
        };
    }

    findRecentActionForIntent(params: {
        sessionId: string;
        modeTemplateType: string;
        intent: string;
        maxAgeMs?: number;
        now?: number;
    }): DynamicAction | null {
        const actionType = this.mapIntentToActionType(params.modeTemplateType, params.intent);
        if (!actionType) return null;
        const now = params.now ?? Date.now();
        const maxAgeMs = params.maxAgeMs ?? 120_000;

        return this.store.getActiveActions(params.sessionId)
            .filter(action =>
                action.modeTemplateType === params.modeTemplateType &&
                action.type === actionType &&
                now - action.createdAt <= maxAgeMs)
            .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
    }

    acceptAction(actionId: string, options?: { triggerSource?: DynamicActionAcceptTriggerSource }): DynamicAction | null {
        const action = this.store.getAction(actionId);
        if (action) {
            const status = options?.triggerSource === 'auto_countdown' ? 'auto_generated' : 'accepted';
            this.store.updateStatus(actionId, status);
            return this.store.getAction(actionId) ?? action;
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

    markShown(actionId: string): DynamicAction | null {
        const action = this.store.getAction(actionId);
        if (!action) return null;
        if (action.status === 'candidate') {
            this.store.updateStatus(actionId, 'shown');
        }
        return this.store.getAction(actionId) ?? action;
    }

    markGenerationFailed(actionId: string): DynamicAction | null {
        const action = this.store.getAction(actionId);
        if (!action) return null;
        this.store.updateStatus(actionId, 'generated_failed');
        return this.store.getAction(actionId) ?? action;
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
        emotionSource?: TranscriptEmotionSource;
        confidence: number;
        now: number;
        autoSurfaceEligible: boolean;
        confirmationSource?: SignalConfirmationSource;
        confirmedIntent?: string;
        semanticGate?: SemanticGateTrace;
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
        const productContract = buildDynamicActionProductContract({
            type: params.trigger.type,
            label: params.trigger.label,
            modeTemplateType: params.modeTemplateType,
            confidence: params.confidence,
            autoSurfacePolicy,
            evidenceRefs,
            answerStyle: params.trigger.answerStyle,
        });

        return {
            id: `action_${crypto.randomUUID()}`,
            sessionId: params.sessionId,
            modeId: params.modeId,
            modeTemplateType: params.modeTemplateType,
            type: params.trigger.type,
            label: params.trigger.label,
            description: `Triggered by: "${params.match}"`,
            productContract,
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
            semanticGate: params.semanticGate,
            answerStyle: params.trigger.answerStyle,
        };
    }

    private buildSemanticGateTrace(
        gateDecision: Awaited<ReturnType<ModeEventClassifier['assess']>>[number],
        regexCandidates: string[],
        upgradedByRepeatedEvidence: boolean
    ): SemanticGateTrace {
        return {
            decision: gateDecision.decision,
            actionType: gateDecision.candidate.actionType,
            semanticIntent: gateDecision.semanticIntent,
            confidence: gateDecision.confidence,
            reasons: gateDecision.reasons,
            regexCandidates,
            rejectedCandidates: gateDecision.rejectedCandidates,
            usedLocalIntentModel: gateDecision.usedLocalIntentModel,
            usedCloudArbitration: gateDecision.usedCloudArbitration,
            semanticProvider: gateDecision.semanticProvider,
            arbitrationStatus: gateDecision.arbitrationStatus,
            degradedReason: gateDecision.degradedReason,
            upgradedByRepeatedEvidence,
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
        return confidence >= 0.9 && ['buying_signal', 'final_offer', 'coding_problem', 'fde_next_step', 'fde_security_review'].includes(type);
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
                clarification: 'general_explain',
                deep_dive: 'general_explain',
                example_request: 'general_explain',
                define_term: 'general_explain',
                summary_probe: 'general_summarize',
                follow_up: 'general_assistance_request',
                behavioral: 'general_assistance_request',
                coding: 'general_assistance_request',
                advance_dialog: 'general_assistance_request',
                general: 'general_assistance_request',
            },
            sales: {
                sales_pricing_objection: 'pricing_objection',
                sales_quote_request: 'pricing_request',
                sales_proof_request: 'case_study_request',
                sales_technical_requirements: 'technical_requirements',
                sales_buying_signal: 'buying_signal',
                handle_objection: 'pricing_objection',
                seize_signal: 'buying_signal',
            },
            fde: {
                fde_discovery: 'fde_discovery_probe',
                fde_integration: 'fde_integration_check',
                fde_security: 'fde_security_review',
                fde_risk: 'fde_risk_blocker',
                fde_agent_feasibility: 'fde_agent_feasibility',
                fde_success: 'fde_success_criteria',
                fde_next_step: 'fde_next_step',
                define_term: 'fde_discovery_probe',
                advance_dialog: 'fde_next_step',
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
            pricing_request: '生成报价邮件',
            case_study_request: '引用案例证明',
            technical_requirements: '澄清技术需求',
            buying_signal: '推进下一步',
            action_item: '捕捉行动项',
            decision_point: '确认决策',
            blocker_check: '澄清阻塞',
            coding_problem: '解技术题',
            concept_explanation: '解释概念',
            general_assistance_request: '建议回应',
            general_summarize: '总结讨论',
            general_explain: '解释清楚',
            fde_discovery_probe: '澄清部署上下文',
            fde_integration_check: '澄清集成方案',
            fde_security_review: '澄清安全评审',
            fde_risk_blocker: '解除部署阻塞',
            fde_agent_feasibility: '判断 AI Agent 可行性',
            fde_success_criteria: '定义验收标准',
            fde_next_step: '锁定下一步',
        };
        const label = labels[type];
        if (!label) return null;
        return {
            type,
            patterns: [],
            priority: 0.8,
            label,
            promptInstruction: FDE_PROMPT_INSTRUCTIONS[type]
                ?? SALES_PROMPT_INSTRUCTIONS[type]
                ?? `You are in ${modeTemplateType} mode. Respond in Chinese first and help the user handle the detected ${type} intent.`,
            answerStyle: { maxWords: 120, format: 'bullets', tone: 'clear' },
        };
    }
}
