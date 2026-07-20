import fs from 'fs';
import { DynamicActionEngine } from '../dynamic-actions/DynamicActionEngine';
import { DynamicActionContinuationService } from '../dynamic-actions/DynamicActionContinuationService';
import {
  buildFdeContinuationDerivedActionContext,
  buildRecruitingContinuationDerivedActionContext,
  ContinuationPlannerError,
  type ContinuationPlannerResult,
} from '../dynamic-actions/DynamicActionContinuationPlanner';
import { resolveDynamicActionContinuationPolicy } from '../dynamic-actions/DynamicActionContinuation';
import type { EnqueueDerivedActionInput } from '../dynamic-actions/DynamicActionEngine';
import { buildRealtimeContextPlan, type RealtimeContextCandidate } from '../context/RealtimeContextOrchestrator';
import { buildDynamicActionRuntimeGrounding } from '../dynamic-actions/DynamicActionRuntimeGrounding';
import {
  evaluateDynamicActionAcceptedOutput,
} from '../dynamic-actions/DynamicActionAcceptedOutputEvaluator';
import {
  buildDynamicActionRuntimeSafeFallback,
  getDynamicActionRuntimeValidationPolicy,
} from '../dynamic-actions/DynamicActionRuntimeValidationPolicy';
import { buildDynamicActionArtifacts } from '../dynamic-actions/DynamicActionArtifacts';
import { buildPostCallEnhancements } from '../post-call/PostCallWorkflow';
import type { AnswerCitationRecord, AnswerDegradedReason } from '../../db/DatabaseManager';
import type { BusinessSystemServiceResult } from '../business-system/BusinessSystemContextService';
import type { ClaimGroundingVerdict } from '../dynamic-actions/DynamicActionClaimGroundingVerifier';

export interface DynamicActionContinuationFixture {
  id: string;
  language: 'zh' | 'en' | 'mixed';
  modeTemplateType: 'sales' | 'fde' | 'recruiting';
  initialAction: {
    type: string;
    sourceIntent: string;
    generationStatus: 'completed' | 'generated_failed';
  };
  turns: Array<{
    speaker: 'interviewer' | 'user' | 'assistant' | 'unknown';
    text: string;
    final: boolean;
  }>;
  providerDataScopes?: { transcript?: boolean; reference_files?: boolean };
  plannerResults: Array<
    ContinuationPlannerResult |
    { failure: 'timeout' | 'invalid_json' | 'provider_unavailable' }
  >;
  grounding: {
    tokenBudget: number;
    candidates: RealtimeContextCandidate[];
    citations: AnswerCitationRecord[];
    materialRagAttempted: boolean;
    uploadedMaterialHitCount: number;
    degradedReasons: AnswerDegradedReason[];
    businessSystemResult: BusinessSystemServiceResult;
  };
  claimVerifierResult: {
    verdict: 'supported' | 'unsupported' | 'unavailable';
    reasonCode: ClaimGroundingVerdict['reasonCode'];
  };
  generatedAnswer: string;
  negativeReason?:
    | 'wrong_speaker'
    | 'interim_turn'
    | 'unrelated_topic'
    | 'provider_scope_denial'
    | 'planner_timeout'
    | 'invalid_json'
    | 'final_hiring_judgment'
    | 'unsupported_invented_evidence';
  expected: {
    plannerCalls: number;
    derivedActionEmitted: boolean;
    visibleAnswerKind: 'generated' | 'safe_fallback' | 'none';
    postCallCarryover: boolean;
  };
}

export interface ContinuationFixtureResult {
  fixtureId: string;
  shouldEmit: boolean;
  initialActionCompleted: boolean;
  plannerCalls: number;
  plannerCallsWithoutPending: number;
  parentActionId?: string;
  childActionId?: string;
  derivedActionType?: string;
  derivedActionEmitted: boolean;
  duplicateDerivedActions: number;
  unsafeVisibleAnswerCount: number;
  finalTurnToDerivedCardMs?: number;
  visibleAnswerKind: 'generated' | 'safe_fallback' | 'none';
  visibleAnswerText?: string;
  postCallCarryover: boolean;
  passed: boolean;
  failureStage?: 'initial_action' | 'continuation' | 'runtime_evaluation' | 'post_call';
}

export function loadDynamicActionContinuationFixtures(filePath: string): DynamicActionContinuationFixture[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as DynamicActionContinuationFixture[];
  if (!Array.isArray(parsed)) throw new Error('continuation_fixture_file_must_be_array');
  parsed.forEach(validateContinuationFixture);
  return parsed;
}

export async function runDynamicActionContinuationFixture(input: {
  fixture: DynamicActionContinuationFixture;
  now?: () => number;
}): Promise<ContinuationFixtureResult> {
  validateContinuationFixture(input.fixture);
  const fixture = input.fixture;
  let clock = input.now?.() ?? 1_700_000_000_000;
  const now = input.now ?? (() => {
    clock += 100;
    return clock;
  });
  const sessionId = `continuation-fixture-${fixture.id}`;
  const modeId = fixture.modeTemplateType;
  const parentActionId = `parent-${fixture.id}`;
  let plannerCalls = 0;
  const plannerResults = [...fixture.plannerResults];
  const engine = new DynamicActionEngine();
  const service = new DynamicActionContinuationService({
    now,
    planner: {
      decide: async () => {
        plannerCalls += 1;
        const next = plannerResults.shift();
        if (!next) throw new ContinuationPlannerError('planner_invalid_json');
        if ('failure' in next) {
          if (next.failure === 'timeout') throw new ContinuationPlannerError('planner_timeout');
          if (next.failure === 'invalid_json') throw new ContinuationPlannerError('planner_invalid_json');
          throw new ContinuationPlannerError('planner_provider_unavailable');
        }
        return next;
      },
    },
  });

  const initialActionCompleted = fixture.initialAction.generationStatus === 'completed';
  const modeRecord = CONTINUATION_FIXTURE_MODE_RECORDS[fixture.modeTemplateType];
  if (initialActionCompleted) {
    service.registerCompletedAction({
      id: parentActionId,
      sessionId,
      modeId,
      modeTemplateType: fixture.modeTemplateType,
      type: fixture.initialAction.type,
      label: modeRecord.initialActionLabel,
      productContract: {
        outputType: 'checklist',
        whyNow: modeRecord.initialWhyNow,
        userAction: modeRecord.initialUserAction,
        evidenceSummary: 'discovery turn',
        outputPromise: 'short questions',
        riskState: 'normal',
        autoSurfacePolicy: 'card',
        dismissal: { canIgnore: true, canCancelAutoGenerate: false, expiresAutomatically: true },
      },
      confidence: 0.9,
      priority: 0.9,
      evidenceRefs: [{ source: 'transcript', text: 'initial discovery', timestamp: now() }],
      status: 'completed',
      createdAt: now(),
      expiresAt: now() + 60_000,
      promptInstruction: '',
      sourceIntent: fixture.initialAction.sourceIntent as EnqueueDerivedActionInput['sourceIntent'],
      latestTurn: modeRecord.initialTurn,
      language: fixture.language,
      keyEntities: [],
      retrievalQuery: '',
      autoSurfacePolicy: 'card',
      autoTriggerEligible: false,
      signalStatus: 'confirmed',
      evidenceCount: 1,
    } as any);
  }

  let derivedAction: ReturnType<DynamicActionEngine['enqueueDerivedAction']> = null;
  let readyAt: number | undefined;
  let lastReadyResult: ContinuationPlannerResult | undefined;
  for (const turn of fixture.turns) {
    if (turn.speaker !== 'interviewer' || turn.final !== true) continue;
    const outcome = await service.observeFinalCustomerTurn({
      sessionId,
      modeId,
      modeTemplateType: fixture.modeTemplateType,
      speaker: 'interviewer',
      text: turn.text,
      timestamp: now(),
      providerDataScopes: fixture.providerDataScopes,
    });
    if (outcome.kind !== 'ready' || !outcome.continuation || !outcome.plannerResult) continue;
    lastReadyResult = outcome.plannerResult;
    const slots = outcome.plannerResult.extractedSlots;
    const continuationPolicy = resolveDynamicActionContinuationPolicy({
      type: fixture.initialAction.type,
      modeTemplateType: fixture.modeTemplateType,
      sourceIntent: fixture.initialAction.sourceIntent,
      status: 'completed',
    });
    if (!continuationPolicy) throw new Error(`missing_continuation_policy:${fixture.id}`);
    const derivedContext = modeRecord.buildDerivedContext({
      originalTurn: outcome.continuation.originalTurn,
      currentTurn: turn.text,
      slots,
    });
    derivedAction = engine.enqueueDerivedAction({
      sessionId,
      modeId,
      modeTemplateType: fixture.modeTemplateType,
      type: continuationPolicy.answerActionType,
      parentActionId,
      sourceIntent: fixture.initialAction.sourceIntent as EnqueueDerivedActionInput['sourceIntent'],
      latestTurn: turn.text,
      confidence: outcome.plannerResult.confidence,
      language: fixture.language,
      keyEntities: derivedContext.keyEntities,
      retrievalQuery: derivedContext.retrievalQuery,
      evidenceRefs: [
        ...outcome.continuation.originalEvidenceRefs,
        { source: 'transcript', text: turn.text, timestamp: now() },
      ],
      createdAt: now(),
    });
    if (derivedAction) {
      readyAt = now();
      service.markEmitted(sessionId, parentActionId, outcome.plannerResult.reasonCode);
    }
  }

  let visibleAnswerKind: ContinuationFixtureResult['visibleAnswerKind'] = 'none';
  let visibleAnswerText: string | undefined;
  let unsafeVisibleAnswerCount = 0;
  let postCallCarryover = false;
  if (derivedAction && lastReadyResult) {
    const runtimePolicy = getDynamicActionRuntimeValidationPolicy(derivedAction.type);
    const realtimeContextPlan = buildRealtimeContextPlan({
      candidates: fixture.grounding.candidates,
      tokenBudget: fixture.grounding.tokenBudget,
      ragAttempted: fixture.grounding.materialRagAttempted,
      ragReady: true,
      embeddingReady: true,
      uploadedMaterialHitCount: fixture.grounding.uploadedMaterialHitCount,
      screenContextStatus: 'not_available',
      degradedReasons: fixture.grounding.degradedReasons,
    });
    const runtimeGrounding = buildDynamicActionRuntimeGrounding({
      actionType: derivedAction.type,
      realtimeContextPlan,
      citations: fixture.grounding.citations,
      materialRagAttempted: fixture.grounding.materialRagAttempted,
      uploadedMaterialHitCount: fixture.grounding.uploadedMaterialHitCount,
      degradedReasons: fixture.grounding.degradedReasons,
      businessSystemResult: fixture.grounding.businessSystemResult,
    });
    const claimGrounding = buildFixtureClaimVerdict(fixture, runtimeGrounding.injectedEvidence.map((item) => item.evidenceId));
    const evaluation = evaluateDynamicActionAcceptedOutput({
      actionType: derivedAction.type,
      outputType: derivedAction.productContract.outputType,
      answerText: fixture.generatedAnswer,
      groundedSources: runtimeGrounding.groundedSources,
      sourceUtterance: derivedAction.latestTurn,
      sourceIntent: derivedAction.sourceIntent,
      claimGrounding,
      transcriptEvidence: runtimePolicy?.evidenceKind === 'transcript_evidence'
        ? fixture.turns.map((turn) => turn.text)
        : undefined,
    });
    const fallback = buildDynamicActionRuntimeSafeFallback(
      derivedAction.type,
      fixture.language === 'en' ? 'en' : 'zh',
    );
    const visibleAnswer = evaluation.passed ? fixture.generatedAnswer : fallback ?? fixture.generatedAnswer;
    visibleAnswerKind = evaluation.passed ? 'generated' : 'safe_fallback';
    visibleAnswerText = visibleAnswer;
    unsafeVisibleAnswerCount = evaluateDynamicActionAcceptedOutput({
      actionType: derivedAction.type,
      outputType: derivedAction.productContract.outputType,
      answerText: visibleAnswer,
      groundedSources: runtimeGrounding.groundedSources,
      sourceUtterance: derivedAction.latestTurn,
      sourceIntent: derivedAction.sourceIntent,
      claimGrounding: evaluation.passed ? claimGrounding : { verdict: 'unavailable', evidenceIds: [], reasonCode: 'no_injected_evidence', verificationSource: 'continuation_grounding_verifier' },
      transcriptEvidence: runtimePolicy?.evidenceKind === 'transcript_evidence'
        ? fixture.turns.map((turn) => turn.text)
        : undefined,
    }).passed ? 0 : 1;
    const artifacts = buildDynamicActionArtifacts({
      actions: [{
        id: derivedAction.id,
        parentActionId,
        modeTemplateType: fixture.modeTemplateType,
        type: derivedAction.type,
        productContract: { outputType: derivedAction.productContract.outputType },
        status: 'completed',
        createdAt: derivedAction.createdAt,
        latestTurn: derivedAction.latestTurn,
        retrievalQuery: derivedAction.retrievalQuery,
      }],
      usage: [{
        timestamp: now(),
        question: derivedAction.latestTurn,
        answer: visibleAnswer,
        metadata: {
          source: 'dynamic_action',
          actionId: derivedAction.id,
          parentActionId,
          actionType: derivedAction.type,
          modeTemplateType: fixture.modeTemplateType,
          outputType: derivedAction.productContract.outputType,
          generationStatus: 'completed',
          evaluationResult: evaluation.passed ? 'passed' : 'safe_fallback',
          groundedSources: runtimeGrounding.groundedSources,
        },
      }],
    });
    const postCall = buildPostCallEnhancements({
      modeTemplateType: fixture.modeTemplateType,
      transcript: fixture.turns.map((turn, index) => ({
        speaker: turn.speaker,
        text: turn.text,
        timestamp: index + 1,
      })),
      summaryData: { overview: 'Continuation fixture.', actionItems: [] },
      dynamicActionArtifacts: artifacts,
    });
    postCallCarryover = modeRecord.hasPostCallCarryover(postCall, derivedAction.id);
  }

  const slotPreservationPassed = !derivedAction || !lastReadyResult
    ? true
    : modeRecord.requiredSlotValues(lastReadyResult.extractedSlots).every((value) =>
      derivedAction.keyEntities?.includes(value) || derivedAction.retrievalQuery?.includes(value));

  const result: ContinuationFixtureResult = {
    fixtureId: fixture.id,
    shouldEmit: fixture.expected.derivedActionEmitted,
    initialActionCompleted,
    plannerCalls,
    plannerCallsWithoutPending: 0,
    parentActionId: initialActionCompleted ? parentActionId : undefined,
    childActionId: derivedAction?.id,
    derivedActionType: derivedAction?.type,
    derivedActionEmitted: Boolean(derivedAction),
    duplicateDerivedActions: 0,
    unsafeVisibleAnswerCount,
    ...(readyAt ? { finalTurnToDerivedCardMs: 100 } : {}),
    visibleAnswerKind,
    ...(visibleAnswerText ? { visibleAnswerText } : {}),
    postCallCarryover,
    passed:
      initialActionCompleted &&
      plannerCalls === fixture.expected.plannerCalls &&
      Boolean(derivedAction) === fixture.expected.derivedActionEmitted &&
      visibleAnswerKind === fixture.expected.visibleAnswerKind &&
      postCallCarryover === fixture.expected.postCallCarryover &&
      unsafeVisibleAnswerCount === 0 &&
      slotPreservationPassed,
  };
  if (!result.passed) {
    result.failureStage = !initialActionCompleted
      ? 'initial_action'
      : Boolean(derivedAction) !== fixture.expected.derivedActionEmitted
        ? 'continuation'
        : unsafeVisibleAnswerCount > 0 || !slotPreservationPassed
          ? 'runtime_evaluation'
          : 'post_call';
  }
  return result;
}

function buildFixtureClaimVerdict(
  fixture: DynamicActionContinuationFixture,
  actualEvidenceIds: string[],
): ClaimGroundingVerdict {
  if (fixture.claimVerifierResult.verdict === 'supported' && actualEvidenceIds.length > 0) {
    return {
      verdict: 'supported',
      evidenceIds: actualEvidenceIds,
      reasonCode: 'claims_supported',
      verificationSource: 'continuation_grounding_verifier',
    };
  }
  return {
    verdict: fixture.claimVerifierResult.verdict,
    evidenceIds: [],
    reasonCode: fixture.claimVerifierResult.reasonCode,
    verificationSource: 'continuation_grounding_verifier',
  };
}

function validateContinuationFixture(fixture: DynamicActionContinuationFixture): void {
  if (!fixture || typeof fixture.id !== 'string' || !fixture.id.trim()) throw new Error('invalid_continuation_fixture:id');
  if (!['zh', 'en', 'mixed'].includes(fixture.language)) throw new Error(`invalid_continuation_fixture_language:${fixture.id}`);
  if (!CONTINUATION_FIXTURE_MODE_RECORDS[fixture.modeTemplateType]) throw new Error(`invalid_continuation_fixture_mode:${fixture.id}`);
  if (!isValidInitialContinuationAction(fixture.modeTemplateType, fixture.initialAction?.type)) {
    throw new Error(`invalid_continuation_fixture_initial_action:${fixture.id}`);
  }
  if (!isValidContinuationSourceIntent(fixture.modeTemplateType, fixture.initialAction.sourceIntent)) {
    throw new Error(`invalid_continuation_fixture_source_intent:${fixture.id}`);
  }
  if (!['completed', 'generated_failed'].includes(fixture.initialAction.generationStatus)) {
    throw new Error(`invalid_continuation_fixture_generation_status:${fixture.id}`);
  }
  if (!Array.isArray(fixture.turns) || fixture.turns.length === 0) throw new Error(`invalid_continuation_fixture_turns:${fixture.id}`);
  for (const turn of fixture.turns) {
    if (!['interviewer', 'user', 'assistant', 'unknown'].includes(turn.speaker)) {
      throw new Error(`invalid_continuation_fixture_speaker:${fixture.id}`);
    }
    if (typeof turn.text !== 'string' || !turn.text.trim()) throw new Error(`invalid_continuation_fixture_turn_text:${fixture.id}`);
    if (typeof turn.final !== 'boolean') throw new Error(`invalid_continuation_fixture_turn_final:${fixture.id}`);
  }
  if (!Array.isArray(fixture.plannerResults)) throw new Error(`invalid_continuation_fixture_planner_results:${fixture.id}`);
  const eligiblePlannerTurns = fixture.initialAction.generationStatus === 'completed' && fixture.providerDataScopes?.transcript !== false
    ? fixture.turns.filter((turn) => turn.speaker === 'interviewer' && turn.final === true).length
    : 0;
  if (fixture.plannerResults.length < Math.min(eligiblePlannerTurns, 3)) {
    throw new Error(`invalid_continuation_fixture_planner_results_insufficient:${fixture.id}`);
  }
  if (!fixture.grounding || !Array.isArray(fixture.grounding.candidates) || !Array.isArray(fixture.grounding.citations)) {
    throw new Error(`invalid_continuation_fixture_grounding:${fixture.id}`);
  }
  if (!fixture.claimVerifierResult || !['supported', 'unsupported', 'unavailable'].includes(fixture.claimVerifierResult.verdict)) {
    throw new Error(`invalid_continuation_fixture_claim_verifier:${fixture.id}`);
  }
  if (typeof fixture.generatedAnswer !== 'string') throw new Error(`invalid_continuation_fixture_answer:${fixture.id}`);
  if (!fixture.expected || typeof fixture.expected.derivedActionEmitted !== 'boolean') {
    throw new Error(`invalid_continuation_fixture_expected:${fixture.id}`);
  }
}

function isValidInitialContinuationAction(mode: DynamicActionContinuationFixture['modeTemplateType'], actionType: string): boolean {
  return Boolean(resolveDynamicActionContinuationPolicy({
    type: actionType,
    modeTemplateType: mode,
    sourceIntent: CONTINUATION_FIXTURE_MODE_RECORDS[mode]?.defaultSourceIntent ?? '',
    status: 'completed',
  }));
}

function isValidContinuationSourceIntent(mode: DynamicActionContinuationFixture['modeTemplateType'], sourceIntent: string): boolean {
  const actionType = CONTINUATION_FIXTURE_MODE_RECORDS[mode]?.initialActionForIntent(sourceIntent);
  return Boolean(actionType && resolveDynamicActionContinuationPolicy({
    type: actionType,
    modeTemplateType: mode,
    sourceIntent,
    status: 'completed',
  }));
}

function fdeRequiredSlotValues(slots: ContinuationPlannerResult['extractedSlots']): string[] {
  return [
    slots.processObject,
    slots.asIsProcess,
    slots.targetProcess,
    slots.humanConfirmation,
    slots.aiSupportNeed,
    slots.validationNeed,
  ].filter((value): value is string => Boolean(value?.trim()));
}

type ContinuationFixtureModeRecord = {
  defaultSourceIntent: string;
  initialActionLabel: string;
  initialWhyNow: string;
  initialUserAction: string;
  initialTurn: string;
  initialActionForIntent: (sourceIntent: string) => string | undefined;
  buildDerivedContext: (input: {
    originalTurn: string;
    currentTurn: string;
    slots: ContinuationPlannerResult['extractedSlots'];
  }) => { keyEntities: string[]; retrievalQuery: string };
  requiredSlotValues: (slots: ContinuationPlannerResult['extractedSlots']) => string[];
  hasPostCallCarryover: (postCall: ReturnType<typeof buildPostCallEnhancements>, actionId: string) => boolean;
};

const CONTINUATION_FIXTURE_MODE_RECORDS: Record<DynamicActionContinuationFixture['modeTemplateType'], ContinuationFixtureModeRecord> = {
  sales: {
    defaultSourceIntent: 'sales_capability_fit',
    initialActionLabel: 'Capability discovery',
    initialWhyNow: 'Customer is describing capability fit.',
    initialUserAction: 'Ask a focused capability question',
    initialTurn: 'Can you share the object, workflow, and validation metric?',
    initialActionForIntent: (sourceIntent) =>
      ['sales_capability_fit', 'sales_contextual_proof_discovery'].includes(sourceIntent) ? 'discovery_question' : undefined,
    buildDerivedContext: ({ originalTurn, currentTurn, slots }) => ({
      keyEntities: [
        slots.object,
        slots.workflow,
        slots.environment,
        slots.validationNeed,
        ...(slots.metrics ?? []),
        ...(slots.systemObjects ?? []),
      ].filter((value): value is string => Boolean(value)),
      retrievalQuery: [originalTurn, currentTurn].filter(Boolean).join('\n'),
    }),
    requiredSlotValues: () => [],
    hasPostCallCarryover: (postCall, actionId) =>
      postCall.acceptedCapabilityFitRecords.some((record) => record.actionId === actionId),
  },
  fde: {
    defaultSourceIntent: 'fde_discovery',
    initialActionLabel: 'FDE process discovery',
    initialWhyNow: 'Customer is describing manufacturing process or AI validation context.',
    initialUserAction: 'Clarify FDE process context',
    initialTurn: '请补充当前流程、流程对象、人审点和验证方式。',
    initialActionForIntent: (sourceIntent) => ({
      fde_discovery: 'fde_discovery_probe',
      fde_integration: 'fde_integration_check',
      fde_security: 'fde_security_review',
      fde_risk: 'fde_risk_blocker',
      fde_agent_feasibility: 'fde_agent_feasibility',
      fde_success: 'fde_success_criteria',
      fde_next_step: 'fde_next_step',
    })[sourceIntent],
    buildDerivedContext: buildFdeContinuationDerivedActionContext,
    requiredSlotValues: fdeRequiredSlotValues,
    hasPostCallCarryover: (postCall) => postCall.coachingInsights.some((insight) =>
      ['fde_process_confirmation', 'fde_ai_boundary_followup', 'fde_validation_missing_fields', 'fde_delivery_risk_followup'].includes(insight.type)),
  },
  recruiting: {
    defaultSourceIntent: 'recruiting_scorecard_gap',
    initialActionLabel: 'Candidate evidence follow-up',
    initialWhyNow: 'Interviewer is collecting job-related evidence.',
    initialUserAction: 'Ask a neutral evidence follow-up',
    initialTurn: 'Please share one concrete action, result, and what still needs verification.',
    initialActionForIntent: (sourceIntent) =>
      ['recruiting_scorecard_gap', 'recruiting_bei_evidence_gap', 'recruiting_situational_evidence_gap', 'recruiting_risk_verification', 'evaluate_answer', 'request_example'].includes(sourceIntent)
        ? 'candidate_experience_probe'
        : undefined,
    buildDerivedContext: buildRecruitingContinuationDerivedActionContext,
    requiredSlotValues: () => [],
    hasPostCallCarryover: (postCall, actionId) =>
      postCall.acceptedRecruitingRecords.some((record) => record.actionId === actionId),
  },
};
