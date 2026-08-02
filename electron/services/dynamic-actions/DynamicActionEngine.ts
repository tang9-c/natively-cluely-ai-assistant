import * as crypto from 'crypto';
import { DynamicAction, DynamicActionAcceptTriggerSource, DynamicActionCandidateSource, EvidenceRef } from './DynamicAction';
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
    selectPassedGateDecisions,
} from './ModeEventClassifier';
import { getActionGatePolicy } from './ModeActionPolicy';
import { SignalStateTracker, SignalConfirmationSource } from './SignalStateTracker';
import type { IntentResult } from '../../llm/IntentClassifier';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { TranscriptEmotionDegree, TranscriptEmotionSource } from '../../../shared/senseVoiceEmotion';
import { detectBusinessSystemTrigger } from '../business-system/BusinessSystemTriggerDetector';

const SALES_PROMPT_INSTRUCTIONS: Record<string, string> = {
    pricing_objection:
        'You are in Sales mode. The prospect raised a pricing or budget objection. Generate 1-3 sentences the seller can say aloud. Start by acknowledging the concern, do not list generic value points, do not invent ROI, discount, price, customer names, or terms, and end with one forward question.',
    pricing_request:
        'You are in Sales mode. The prospect asked for a quote, proposal, pricing, or commercial terms. Generate an email draft with greeting, short body, and sign-off. Use [CUSTOMER_NAME], [QUOTE_AMOUNT], [SCOPE], and [NEXT_STEP] unless exact trusted context provides values. Do not invent pricing, customer names, account numbers, contract terms, or commercial terms.',
    case_study_request:
        'You are in Sales mode. The prospect asked for a case study, similar customer, ROI, or proof. Use uploaded/reference/trusted context first. If no grounded case or proof is present, say that the provided materials do not include a matching proof point and ask what proof would be useful. Do not invent customer names, metrics, outcomes, or ROI.',
    discovery_question:
        'You are in Sales mode. The prospect described an industrial software pain, capability-fit question, process-integration need, value driver, or contextual proof request. Generate only 1-3 customer-facing discovery questions. Do not claim product capabilities, invent ROI, invent customer names, or answer as a domain expert.',
    technical_requirements:
        'You are in Sales mode. The prospect raised technical, security, API, SSO, integration, or deployment requirements. Clarify systems, APIs, auth, deployment environment, security constraints, owners, and the smallest validation step. Do not promise capability before validation.',
    buying_signal:
        'You are in Sales mode. The prospect showed buying or next-step intent. Lock next step, owner, date, and artifact. If owner/date/artifact is missing, ask for the missing field instead of inventing it.',
    capability_fit_answer:
        'You are in Sales mode. The prospect has clarified a capability-fit object, scenario, metric, or validation need. Generate a short answer the seller can say aloud. Separate confirmed facts from what still needs validation. Use trusted material or readonly business context when present. If grounding is insufficient, say the current materials are not enough and propose a small validation step. Do not invent customer names, ROI, prices, contract terms, or automatic PLM/QMS writeback.',
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
    fde_grounded_answer:
        'You are in FDE mode for manufacturing process and enterprise AI Agent deployment. Generate a short spoken response grounded in trusted material, readonly business context, or transcript evidence. Prioritize the customer process, roles, handoffs, human confirmation point, quality object, and validation plan. Explain AI Agent capability in business process terms; do not use LLM/RAG/tool-call jargon unless the customer used it first. Separate confirmed facts from what still needs validation. If grounding is insufficient, say so and propose the smallest sample-process validation step. Do not promise automatic approval, writeback, update, or creation in PLM/QMS.',
};

const DETECTOR_ONLY_MODE_TEMPLATE_TYPES = new Set([
    'sales',
    'fde',
    'recruiting',
    'team-meet',
    'team_meeting',
]);

export function isDetectorOnlyDynamicActionMode(modeTemplateType: string): boolean {
    return DETECTOR_ONLY_MODE_TEMPLATE_TYPES.has(modeTemplateType);
}

export type DetectedSignalCandidate = {
    trigger: ActionTrigger;
    match: string;
    index: number;
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
     * Legacy synchronous regex detector for explicit regex smoke tests only.
     * Do not use this for production emission, product fixture acceptance, or
     * replay evaluation that claims semantic-gate behavior.
     */
    detectActions(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
        emotion?: string;
        emotionSource?: TranscriptEmotionSource;
        emotionDegree?: TranscriptEmotionDegree;
        emotionScore?: number;
        emotionDegreeScore?: number;
        language?: string;
    }): DynamicAction[] {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = Date.now();
        const candidateActions: DynamicAction[] = [];
        const language = params.language || detectLanguage(transcript);
        const keyEntities = extractKeyEntities(transcript, modeTemplateType);

        // Detect triggers using regex patterns
        const matchedTriggers = this.detector.detectTriggers({ transcript, modeTemplateType, speaker });

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
                emotionDegree: params.emotionDegree,
                emotionScore: params.emotionScore,
                emotionDegreeScore: params.emotionDegreeScore,
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

    detectSignalCandidates(params: {
        transcript: string;
        modeTemplateType: string;
        speaker?: string;
    }): DetectedSignalCandidate[] {
        return this.detector.detectTriggers(params);
    }

    async assessSignals(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        modeId: string;
        sessionId: string;
        emotion?: string;
        emotionSource?: TranscriptEmotionSource;
        emotionDegree?: TranscriptEmotionDegree;
        emotionScore?: number;
        emotionDegreeScore?: number;
        language?: string;
        intentResult?: IntentResult;
        recentContextTurns?: ModeEventContextTurn[];
        providerDataScopes?: ProviderDataScopePolicy;
        selectedModelRunsLocally?: boolean;
        cloudClassifier?: CloudSemanticGateClassifier;
        semanticGateTraceSink?: (trace: SemanticGateTrace) => void;
        detectedTriggers?: DetectedSignalCandidate[];
        now?: number;
    }): Promise<DynamicAction[]> {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = params.now ?? Date.now();
        const language = params.language || detectLanguage(transcript);
        const keyEntities = extractKeyEntities(transcript, modeTemplateType);
        const candidateActions: DynamicAction[] = [];
        const matchedTriggers = params.detectedTriggers
            ?? this.detectSignalCandidates({ transcript, modeTemplateType, speaker });
        const businessTriggerResult = detectBusinessSystemTrigger(transcript);
        const businessTrigger = businessTriggerResult.shouldQuery
            ? this.syntheticTriggerFor('business_system_query', modeTemplateType)
            : null;
        const triggerCandidates: Array<{
            trigger: ActionTrigger;
            match: string;
            confidence: number;
            confirmationSource: SignalConfirmationSource;
            confirmedIntent: string | null;
            candidateSource: DynamicActionCandidateSource;
            matchedKeyword?: string;
        }> = businessTrigger
            ? [{
                trigger: businessTrigger,
                match: transcript,
                confidence: 0.86,
                confirmationSource: 'business_query' as SignalConfirmationSource,
                confirmedIntent: 'business_system_query',
                candidateSource: 'business_query' as DynamicActionCandidateSource,
            }]
            : matchedTriggers.map(({ trigger, match }) => ({
                trigger,
                match,
                confidence: this.scoreTrigger(trigger, modeTemplateType, params.intentResult),
                confirmationSource: this.confirmationSourceFor(params.intentResult),
                confirmedIntent: params.intentResult?.intent,
                candidateSource: 'detector' as DynamicActionCandidateSource,
                matchedKeyword: params.intentResult?.matchedKeyword,
            }));
        const synthTrigger = businessTrigger ? null : this.synthesizeTrigger(modeTemplateType, params.intentResult, transcript);
        const shouldAddSynthTrigger = synthTrigger
            ? this.canSynthesizeIntentCandidate({
                modeTemplateType,
                intentResult: params.intentResult,
                actionType: synthTrigger.type,
                matchedTriggers,
                latestTurn: transcript,
            })
            : false;

        if (synthTrigger && shouldAddSynthTrigger) {
            triggerCandidates.push({
                trigger: synthTrigger,
                match: params.intentResult?.intent ?? synthTrigger.type,
                confidence: params.intentResult?.confidence ?? synthTrigger.priority,
                confirmationSource: this.confirmationSourceFor(params.intentResult),
                confirmedIntent: params.intentResult?.intent,
                candidateSource: params.intentResult?.source === 'mode_keyword' ? 'mode_keyword' as const : 'intent_fallback' as const,
                matchedKeyword: params.intentResult?.matchedKeyword,
            });
        }

        const gateCandidates: ModeEventCandidate[] = triggerCandidates.map(candidate => {
            const policy = getActionGatePolicy(modeTemplateType, candidate.trigger.type);
            return {
                actionType: candidate.trigger.type,
                label: candidate.trigger.label,
                match: candidate.match,
                confidence: candidate.confidence,
                highRisk: policy.riskLevel === 'high',
                fastPathEligible: policy.fastPathEligible,
                riskLevel: policy.riskLevel,
                gateStrategy: policy.gateStrategy,
                allowLocalFallbackOnCloudFailure: policy.allowLocalFallbackOnCloudFailure,
                requiredEvidence: policy.requiredEvidence,
                localFallbackEvidence: policy.localFallbackEvidence,
                exclusiveGroup: policy.exclusiveGroup,
                selectionPriority: policy.selectionPriority,
            };
        });
        const gateDecisions = await this.semanticGate.assess({
            transcript,
            recentContextTurns: params.recentContextTurns,
            modeTemplateType,
            speaker,
            candidates: gateCandidates,
            activeActionTypes: this.store.getActiveActions(sessionId).map(action => action.type),
            intentResult: params.intentResult,
            providerDataScopes: params.providerDataScopes,
            selectedModelRunsLocally: params.selectedModelRunsLocally,
            cloudClassifier: params.cloudClassifier,
        });
        const passedGateDecisions = selectPassedGateDecisions(gateDecisions);
        const selectedActionTypes = new Set(passedGateDecisions.map(decision => decision.candidate.actionType));
        const selectedByExclusiveGroup = new Map(
            passedGateDecisions
                .filter(decision => decision.candidate.exclusiveGroup)
                .map(decision => [decision.candidate.exclusiveGroup!, decision.candidate.actionType])
        );
        const selectedGateDecisions = gateDecisions.map(decision => {
            const exclusiveGroup = decision.candidate.exclusiveGroup;
            if (
                !exclusiveGroup ||
                !['pass', 'fast_path'].includes(decision.decision) ||
                selectedActionTypes.has(decision.candidate.actionType)
            ) {
                return decision;
            }
            return {
                ...decision,
                decision: 'reject' as const,
                reasons: [...decision.reasons, 'exclusive_group_arbitration_lost'],
                rejectedCandidates: [...decision.rejectedCandidates, selectedByExclusiveGroup.get(exclusiveGroup) ?? ''],
            };
        });
        const allRegexCandidates = gateCandidates.map(candidate => `${candidate.actionType}:${candidate.match}`);
        for (const gateDecision of selectedGateDecisions) {
            try {
                params.semanticGateTraceSink?.(
                    this.buildSemanticGateTrace(gateDecision, allRegexCandidates, false)
                );
            } catch {
                // Diagnostics must never change dynamic action behavior.
            }
        }

        for (const candidate of triggerCandidates) {
            const gateDecision = selectedGateDecisions.find(decision => decision.candidate.actionType === candidate.trigger.type);
            if (!gateDecision || !['pass', 'fast_path'].includes(gateDecision.decision)) continue;

            const evidenceRef: EvidenceRef = {
                source: 'transcript',
                text: transcript,
                timestamp: now,
                speaker,
            };
            const adjustedConfidence = this.applyEmotionBoost(
                candidate.trigger.type,
                gateDecision.confidence,
                params.emotion,
                params.emotionDegree,
                params.emotionScore,
                params.emotionDegreeScore,
            );
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
                confirmedBySemanticGate: (
                    (candidate.candidateSource === 'mode_keyword' || candidate.candidateSource === 'business_query') &&
                    ['pass', 'fast_path'].includes(gateDecision.decision)
                ),
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
                emotionDegree: params.emotionDegree,
                emotionScore: params.emotionScore,
                emotionDegreeScore: params.emotionDegreeScore,
                confidence: signal.state.confidence,
                now,
                autoSurfaceEligible: signal.autoSurfaceEligible || this.isStrongAutoSignal(candidate.trigger.type, signal.state.confidence),
                confirmationSource: candidate.confirmationSource,
                confirmedIntent: candidate.confirmedIntent,
                candidateSource: candidate.candidateSource,
                matchedKeyword: candidate.matchedKeyword,
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

    discardSignalsForAssessment(params: {
        transcript: string;
        speaker?: string;
        modeTemplateType: string;
        sessionId: string;
        intentResult?: IntentResult;
        detectedTriggers?: DetectedSignalCandidate[];
        now?: number;
    }): void {
        const evidenceRef: EvidenceRef = {
            source: 'transcript',
            text: params.transcript,
            timestamp: params.now ?? Date.now(),
            speaker: params.speaker,
        };
        const matchedTriggers = params.detectedTriggers
            ?? this.detectSignalCandidates({
                transcript: params.transcript,
                modeTemplateType: params.modeTemplateType,
                speaker: params.speaker,
            });
        const signalTypes = new Set(matchedTriggers.map(({ trigger }) => trigger.type));
        const businessTriggerResult = detectBusinessSystemTrigger(params.transcript);
        const synthTrigger = businessTriggerResult.shouldQuery
            ? this.syntheticTriggerFor('business_system_query', params.modeTemplateType)
            : this.synthesizeTrigger(params.modeTemplateType, params.intentResult, params.transcript);
        const shouldAddSynthTrigger = synthTrigger
            ? this.canSynthesizeIntentCandidate({
                modeTemplateType: params.modeTemplateType,
                intentResult: params.intentResult,
                actionType: synthTrigger.type,
                matchedTriggers,
                latestTurn: params.transcript,
            })
            : false;
        if (synthTrigger && shouldAddSynthTrigger) {
            signalTypes.add(synthTrigger.type);
        }
        for (const signalType of signalTypes) {
            this.signalTracker.rollbackLatestAssessmentIfEvidenceMatches(
                params.sessionId,
                params.modeTemplateType,
                signalType,
                evidenceRef,
            );
        }
    }

    getTopActions(sessionId: string, maxAgeMs: number = 60000): DynamicAction[] {
        return this.getTopActionsWithExpired(sessionId, maxAgeMs).actions;
    }

    enqueueDerivedAction(input: EnqueueDerivedActionInput): DynamicAction | null {
        const existing = this.store.getAllActions(input.sessionId).some((action) =>
            action.type === input.type && action.parentActionId === input.parentActionId
        );
        if (existing) return null;

        const createdAt = input.createdAt ?? Date.now();
        const confidence = Math.max(0, Math.min(1, input.confidence));
        const evidenceRefs = input.evidenceRefs.slice(0, 2).map((item) => ({
            ...item,
            text: item.text.slice(0, 280),
        }));
        const productContract = buildDynamicActionProductContract({
            type: input.type,
            label: derivedActionLabel(input.type),
            modeTemplateType: input.modeTemplateType,
            confidence,
            autoSurfacePolicy: 'card',
            evidenceRefs,
        });
        const action: DynamicAction = {
            id: `action_${crypto.randomUUID()}`,
            sessionId: input.sessionId,
            modeId: input.modeId,
            modeTemplateType: input.modeTemplateType,
            type: input.type,
            label: derivedActionLabel(input.type),
            productContract,
            confidence,
            priority: confidence,
            evidenceRefs,
            status: 'candidate',
            createdAt,
            expiresAt: createdAt + 60_000,
            promptInstruction: derivedActionPromptInstruction(input.type),
            parentActionId: input.parentActionId,
            sourceIntent: input.sourceIntent,
            latestTurn: input.latestTurn.slice(0, 600),
            language: input.language,
            keyEntities: [...new Set(input.keyEntities)].slice(0, 12),
            retrievalQuery: input.retrievalQuery.slice(0, 800),
            autoSurfacePolicy: 'card',
            autoTriggerEligible: false,
            autoTriggerReason: 'continuation_requires_manual_acceptance',
            signalStatus: 'confirmed',
            evidenceCount: evidenceRefs.length,
            confirmationSource: 'continuation_planner',
            confirmedIntent: input.sourceIntent,
        };
        this.store.addAction(action);
        return action;
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

    dismissAction(actionId: string, options?: { now?: number }): void {
        const action = this.store.getAction(actionId);
        if (action) {
            this.signalTracker.dismiss(action.sessionId, action.modeTemplateType, action.type, options?.now);
        }
        this.store.updateStatus(actionId, 'dismissed');
    }

    discardAction(actionId: string, options?: { clearSignalState?: boolean }): void {
        const action = this.store.getAction(actionId);
        if (action && options?.clearSignalState !== false) {
            this.signalTracker.clear(action.sessionId, action.modeTemplateType, action.type);
        }
        this.store.removeAction(actionId);
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
        emotionDegree?: TranscriptEmotionDegree;
        emotionScore?: number;
        emotionDegreeScore?: number;
        confidence: number;
        now: number;
        autoSurfaceEligible: boolean;
        confirmationSource?: SignalConfirmationSource;
        confirmedIntent?: string;
        semanticGate?: SemanticGateTrace;
        signalStatus?: DynamicAction['signalStatus'];
        evidenceRefs?: EvidenceRef[];
        candidateSource?: DynamicActionCandidateSource;
        matchedKeyword?: string;
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
            sourceIntent: params.confirmedIntent ?? params.semanticGate?.semanticIntent ?? params.trigger.type,
            latestTurn: params.transcript,
            language: params.language,
            emotion: params.emotion,
            emotionSource: params.emotionSource,
            emotionDegree: params.emotionDegree,
            emotionScore: params.emotionScore,
            emotionDegreeScore: params.emotionDegreeScore,
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
            candidateSource: params.candidateSource,
            matchedKeyword: params.matchedKeyword,
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
        if (intentResult.source === 'mode_keyword') return 'local_intent';
        if (intentResult.source === 'cloud') return 'cloud_intent';
        if (intentResult.source === 'pattern' || intentResult.source === 'local_slm') return 'local_intent';
        if (intentResult.source === 'context') return 'heuristic';
        return intentResult.confidence >= 0.5 ? 'cloud_intent' : 'heuristic';
    }

    private applyEmotionBoost(
        type: string,
        confidence: number,
        emotion?: string,
        emotionDegree?: TranscriptEmotionDegree,
        emotionScore?: number,
        emotionDegreeScore?: number,
    ): number {
        if (!emotion) return confidence;
        const negative = ['angry', 'sad', 'fearful', 'disgusted'].includes(emotion);
        const positive = ['happy', 'surprised'].includes(emotion);
        const objectionLike = /(objection|pushback|risk|blocker|concern|weakness)/.test(type);
        const positiveLike = /(buying_signal|strong_fit|fit_signal)/.test(type);
        const degreeMultiplier = emotionDegree === 'weak' ? 0.5 : emotionDegree === 'medium' ? 0.75 : 1;
        const availableScores = [emotionScore, emotionDegreeScore].filter((score): score is number => (
            typeof score === 'number' && score >= 0 && score <= 1
        ));
        const scoreMultiplier = availableScores.length > 0 ? Math.min(...availableScores) : 1;
        const boost = 0.04 * degreeMultiplier * scoreMultiplier;
        if (negative && objectionLike) return Math.min(0.98, confidence + boost);
        if (positive && positiveLike) return Math.min(0.98, confidence + boost);
        return confidence;
    }

    private isStrongAutoSignal(type: string, confidence: number): boolean {
        return confidence >= 0.9 && ['buying_signal', 'final_offer', 'coding_problem', 'fde_next_step', 'fde_security_review'].includes(type);
    }

    private synthesizeTrigger(modeTemplateType: string, intentResult?: IntentResult, latestTurn = ''): ActionTrigger | null {
        if (!intentResult || intentResult.confidence < 0.75) return null;
        const type = this.resolveActionTypeForIntent(modeTemplateType, intentResult, latestTurn);
        if (!type) return null;
        const trigger = this.detector.getTriggerForType(type);
        if (trigger) return trigger;
        return this.syntheticTriggerFor(type, modeTemplateType);
    }

    private canSynthesizeIntentCandidate(params: {
        modeTemplateType: string;
        intentResult?: IntentResult;
        actionType: string;
        matchedTriggers: DetectedSignalCandidate[];
        latestTurn?: string;
    }): boolean {
        const { modeTemplateType, intentResult, actionType, matchedTriggers } = params;
        if (!intentResult) return false;
        if (intentResult.source !== 'mode_keyword' && intentResult.confidence < 0.85) return false;
        if (matchedTriggers.some(({ trigger }) => trigger.type === actionType)) return false;

        const mappedActionType = this.resolveActionTypeForIntent(modeTemplateType, intentResult, params.latestTurn);
        if (mappedActionType !== actionType) return false;

        if (intentResult.source === 'local_slm') return false;
        const source = intentResult.source ?? 'pattern';
        if (!['cloud', 'pattern', 'context', 'mode_keyword'].includes(source)) return false;

        return true;
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
                sales_pain_discovery: 'discovery_question',
                sales_capability_fit: 'discovery_question',
                sales_process_integration: 'discovery_question',
                sales_value_discovery: 'discovery_question',
                sales_contextual_proof_discovery: 'discovery_question',
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
                recruiting_policy_question: 'candidate_concern',
                recruiting_scorecard_gap: 'candidate_experience_probe',
                recruiting_bei_evidence_gap: 'candidate_experience_probe',
                recruiting_situational_evidence_gap: 'candidate_experience_probe',
                recruiting_risk_verification: 'candidate_experience_probe',
                evaluate_answer: 'candidate_experience_probe',
                request_example: 'candidate_experience_probe',
                behavioral: 'candidate_experience_probe',
                example_request: 'candidate_experience_probe',
            },
            'team-meet': {
                capture_action: 'action_item',
                capture_decision: 'decision_point',
                capture_risk: 'blocker_check',
                status_update: 'owner_deadline_check',
            },
            team_meeting: {
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

    private resolveActionTypeForIntent(modeTemplateType: string, intentResult?: IntentResult, latestTurn = ''): string | null {
        if (!intentResult) return null;
        if (modeTemplateType === 'sales') {
            if (intentResult.intent === 'sales_capability_fit') {
                return this.isExplicitCapabilityQuestion(latestTurn) ? 'capability_fit_answer' : 'discovery_question';
            }
            if (intentResult.intent === 'sales_contextual_proof_discovery') {
                return this.isExplicitCaseProofRequest(latestTurn) ? 'case_study_request' : 'discovery_question';
            }
        }
        return this.mapIntentToActionType(modeTemplateType, intentResult.intent);
    }

    private isExplicitCapabilityQuestion(text: string): boolean {
        return /(支持|能不能|是否|有没有|可不可以|可以吗|有.*功能吗|does it support|can it|do you support|is it able to)/i.test(text);
    }

    private isExplicitCaseProofRequest(text: string): boolean {
        return /(案例|客户案例|成功案例|收益|ROI|投资回报|证明|proof|case stud|customer story|reference customer|return on investment)/i.test(text);
    }

    private syntheticTriggerFor(type: string, modeTemplateType: string): ActionTrigger | null {
        const labels: Record<string, string> = {
            pricing_objection: '处理价格异议',
            pricing_request: '生成报价邮件',
            case_study_request: '引用案例证明',
            discovery_question: '提出发现问题',
            capability_fit_answer: '生成能力匹配回答',
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
            business_system_query: '查询业务系统状态',
            fde_discovery_probe: '澄清部署上下文',
            fde_integration_check: '澄清集成方案',
            fde_security_review: '澄清安全评审',
            fde_risk_blocker: '解除部署阻塞',
            fde_agent_feasibility: '判断 AI Agent 可行性',
            fde_success_criteria: '定义验收标准',
            fde_next_step: '锁定下一步',
            fde_grounded_answer: '生成 FDE 流程验证回应',
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
            answerStyle: type === 'discovery_question'
                ? { maxWords: 90, format: 'short_script', tone: 'consultative' }
                : { maxWords: 120, format: 'bullets', tone: 'clear' },
        };
    }
}

export interface EnqueueDerivedActionInput {
    sessionId: string;
    modeId: string;
    modeTemplateType: 'sales' | 'fde' | 'recruiting';
    type: 'capability_fit_answer' | 'fde_grounded_answer' | 'candidate_evidence_summary';
    parentActionId: string;
    sourceIntent:
        | 'sales_capability_fit'
        | 'sales_contextual_proof_discovery'
        | 'fde_discovery'
        | 'fde_integration'
        | 'fde_security'
        | 'fde_risk'
        | 'fde_agent_feasibility'
        | 'fde_success'
        | 'fde_next_step'
        | 'recruiting_scorecard_gap'
        | 'recruiting_bei_evidence_gap'
        | 'recruiting_situational_evidence_gap'
        | 'recruiting_risk_verification'
        | 'evaluate_answer'
        | 'request_example';
    latestTurn: string;
    evidenceRefs: EvidenceRef[];
    keyEntities: string[];
    retrievalQuery: string;
    confidence: number;
    language?: string;
    createdAt?: number;
}

function derivedActionLabel(type: EnqueueDerivedActionInput['type']): string {
    return DERIVED_ACTION_METADATA[type].label;
}

function derivedActionPromptInstruction(type: EnqueueDerivedActionInput['type']): string {
    return DERIVED_ACTION_METADATA[type].promptInstruction;
}

const DERIVED_ACTION_METADATA: Record<EnqueueDerivedActionInput['type'], {
    label: string;
    promptInstruction: string;
}> = {
    capability_fit_answer: {
        label: '生成能力匹配回答',
        promptInstruction: SALES_PROMPT_INSTRUCTIONS.capability_fit_answer,
    },
    fde_grounded_answer: {
        label: '生成 FDE 流程验证回应',
        promptInstruction: FDE_PROMPT_INSTRUCTIONS.fde_grounded_answer,
    },
    candidate_evidence_summary: {
        label: '生成候选人证据摘要',
        promptInstruction: 'You are in Recruiting mode. Generate a concise, neutral summary of the candidate evidence grounded in transcript evidence. Separate observed evidence, missing evidence, and risks to verify. Do not infer interview method, hiring recommendation, candidate level, or outcome.',
    },
};
