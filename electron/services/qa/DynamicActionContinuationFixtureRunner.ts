import fs from 'fs';
import { DynamicActionEngine } from '../dynamic-actions/DynamicActionEngine';
import { DynamicActionContinuationService } from '../dynamic-actions/DynamicActionContinuationService';
import { ContinuationPlannerError, type ContinuationPlannerResult } from '../dynamic-actions/DynamicActionContinuationPlanner';
import { buildRealtimeContextPlan, type RealtimeContextCandidate } from '../context/RealtimeContextOrchestrator';
import { buildDynamicActionRuntimeGrounding } from '../dynamic-actions/DynamicActionRuntimeGrounding';
import {
  buildCapabilityFitSafeFallback,
  evaluateDynamicActionAcceptedOutput,
} from '../dynamic-actions/DynamicActionAcceptedOutputEvaluator';
import { buildDynamicActionArtifacts } from '../dynamic-actions/DynamicActionArtifacts';
import { buildPostCallEnhancements } from '../post-call/PostCallWorkflow';
import type { AnswerCitationRecord, AnswerDegradedReason } from '../../db/DatabaseManager';
import type { BusinessSystemServiceResult } from '../business-system/BusinessSystemContextService';
import type { ClaimGroundingVerdict } from '../dynamic-actions/DynamicActionClaimGroundingVerifier';

export interface DynamicActionContinuationFixture {
  id: string;
  language: 'zh' | 'en' | 'mixed';
  modeTemplateType: 'sales';
  initialAction: {
    type: 'discovery_question';
    sourceIntent: 'sales_capability_fit' | 'sales_contextual_proof_discovery';
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
  derivedActionEmitted: boolean;
  duplicateDerivedActions: number;
  unsafeVisibleAnswerCount: number;
  finalTurnToDerivedCardMs?: number;
  visibleAnswerKind: 'generated' | 'safe_fallback' | 'none';
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
  const modeId = 'sales';
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
  if (initialActionCompleted) {
    service.registerCompletedAction({
      id: parentActionId,
      sessionId,
      modeId,
      modeTemplateType: 'sales',
      type: fixture.initialAction.type,
      label: 'Capability discovery',
      productContract: {
        outputType: 'clarifying_questions',
        whyNow: 'Customer is describing capability fit.',
        userAction: 'Ask a focused capability question',
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
      sourceIntent: fixture.initialAction.sourceIntent,
      latestTurn: 'Can you share the object, workflow, and validation metric?',
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
      modeTemplateType: 'sales',
      speaker: 'interviewer',
      text: turn.text,
      timestamp: now(),
      providerDataScopes: fixture.providerDataScopes,
    });
    if (outcome.kind !== 'ready' || !outcome.continuation || !outcome.plannerResult) continue;
    lastReadyResult = outcome.plannerResult;
    const slots = outcome.plannerResult.extractedSlots;
    derivedAction = engine.enqueueDerivedAction({
      sessionId,
      modeId,
      modeTemplateType: 'sales',
      type: 'capability_fit_answer',
      parentActionId,
      sourceIntent: fixture.initialAction.sourceIntent,
      latestTurn: turn.text,
      confidence: outcome.plannerResult.confidence,
      language: fixture.language,
      keyEntities: [
        slots.object,
        slots.workflow,
        slots.environment,
        slots.validationNeed,
        ...(slots.metrics ?? []),
        ...(slots.systemObjects ?? []),
      ].filter((value): value is string => Boolean(value)),
      retrievalQuery: [outcome.continuation.originalTurn, turn.text].filter(Boolean).join('\n'),
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
  let unsafeVisibleAnswerCount = 0;
  let postCallCarryover = false;
  if (derivedAction && lastReadyResult) {
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
      actionType: 'capability_fit_answer',
      realtimeContextPlan,
      citations: fixture.grounding.citations,
      materialRagAttempted: fixture.grounding.materialRagAttempted,
      uploadedMaterialHitCount: fixture.grounding.uploadedMaterialHitCount,
      degradedReasons: fixture.grounding.degradedReasons,
      businessSystemResult: fixture.grounding.businessSystemResult,
    });
    const claimGrounding = buildFixtureClaimVerdict(fixture, runtimeGrounding.injectedEvidence.map((item) => item.evidenceId));
    const evaluation = evaluateDynamicActionAcceptedOutput({
      actionType: 'capability_fit_answer',
      outputType: derivedAction.productContract.outputType,
      answerText: fixture.generatedAnswer,
      groundedSources: runtimeGrounding.groundedSources,
      sourceUtterance: derivedAction.latestTurn,
      sourceIntent: derivedAction.sourceIntent,
      claimGrounding,
    });
    const visibleAnswer = evaluation.passed
      ? fixture.generatedAnswer
      : buildCapabilityFitSafeFallback(fixture.language === 'en' ? 'en' : 'zh');
    visibleAnswerKind = evaluation.passed ? 'generated' : 'safe_fallback';
    unsafeVisibleAnswerCount = evaluateDynamicActionAcceptedOutput({
      actionType: 'capability_fit_answer',
      outputType: derivedAction.productContract.outputType,
      answerText: visibleAnswer,
      groundedSources: runtimeGrounding.groundedSources,
      sourceUtterance: derivedAction.latestTurn,
      sourceIntent: derivedAction.sourceIntent,
      claimGrounding: evaluation.passed ? claimGrounding : { verdict: 'unavailable', evidenceIds: [], reasonCode: 'no_injected_evidence', verificationSource: 'continuation_grounding_verifier' },
    }).passed ? 0 : 1;
    const artifacts = buildDynamicActionArtifacts({
      actions: [{
        id: derivedAction.id,
        parentActionId,
        modeTemplateType: 'sales',
        type: 'capability_fit_answer',
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
          actionType: 'capability_fit_answer',
          modeTemplateType: 'sales',
          outputType: derivedAction.productContract.outputType,
          generationStatus: 'completed',
          evaluationResult: evaluation.passed ? 'passed' : 'safe_fallback',
          groundedSources: runtimeGrounding.groundedSources,
        },
      }],
    });
    const postCall = buildPostCallEnhancements({
      modeTemplateType: 'sales',
      transcript: fixture.turns.map((turn, index) => ({
        speaker: turn.speaker,
        text: turn.text,
        timestamp: index + 1,
      })),
      summaryData: { overview: 'Continuation fixture.', actionItems: [] },
      dynamicActionArtifacts: artifacts,
    });
    postCallCarryover = postCall.acceptedCapabilityFitRecords.some((record) => record.actionId === derivedAction?.id);
  }

  const result: ContinuationFixtureResult = {
    fixtureId: fixture.id,
    shouldEmit: fixture.expected.derivedActionEmitted,
    initialActionCompleted,
    plannerCalls,
    plannerCallsWithoutPending: 0,
    parentActionId: initialActionCompleted ? parentActionId : undefined,
    childActionId: derivedAction?.id,
    derivedActionEmitted: Boolean(derivedAction),
    duplicateDerivedActions: 0,
    unsafeVisibleAnswerCount,
    ...(readyAt ? { finalTurnToDerivedCardMs: 100 } : {}),
    visibleAnswerKind,
    postCallCarryover,
    passed:
      initialActionCompleted &&
      plannerCalls === fixture.expected.plannerCalls &&
      Boolean(derivedAction) === fixture.expected.derivedActionEmitted &&
      visibleAnswerKind === fixture.expected.visibleAnswerKind &&
      postCallCarryover === fixture.expected.postCallCarryover &&
      unsafeVisibleAnswerCount === 0,
  };
  if (!result.passed) {
    result.failureStage = !initialActionCompleted
      ? 'initial_action'
      : Boolean(derivedAction) !== fixture.expected.derivedActionEmitted
        ? 'continuation'
        : unsafeVisibleAnswerCount > 0
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
  if (fixture.modeTemplateType !== 'sales') throw new Error(`invalid_continuation_fixture_mode:${fixture.id}`);
  if (fixture.initialAction?.type !== 'discovery_question') throw new Error(`invalid_continuation_fixture_initial_action:${fixture.id}`);
  if (!['sales_capability_fit', 'sales_contextual_proof_discovery'].includes(fixture.initialAction.sourceIntent)) {
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
