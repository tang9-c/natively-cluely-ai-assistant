import fs from 'fs';
import path from 'path';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { DynamicActionEngine } from '../dynamic-actions/DynamicActionEngine';
import type { CloudSemanticGateClassifier } from '../dynamic-actions/ModeEventClassifier';
import type { DynamicActionFixtureRunnerMode } from '../dynamic-actions/DynamicActionProductFixtures';
import type { DynamicActionProductFixture } from '../dynamic-actions/DynamicActionProductFixtures';
import {
  loadDynamicActionContinuationFixtures,
  runDynamicActionContinuationFixture,
  type ContinuationFixtureResult,
  type DynamicActionContinuationFixture,
} from './DynamicActionContinuationFixtureRunner';
import {
  evaluateRecruitingReleaseQualityGate,
  type RecruitingReleaseQualityMetrics,
} from './DynamicActionMetricsAggregator';

export interface ReplayManifestEntry {
  id: string;
  modeTemplateType: string;
  sourceFixture: string;
  audioPath: string;
  expectedMissingAudio: boolean;
  language: string;
  speakerCount: number;
  syntheticAudio?: boolean;
  realAsset?: ReplayRealAssetProvenance;
  continuationFixture?: string;
  runnerMode?: DynamicActionFixtureRunnerMode;
  labeledFinalTurns?: ReplayLabeledFinalTurn[];
}

export interface ReplayRealAssetProvenance {
  sourceKind: 'real_recording';
  meetingId: string;
  audioSha256: string;
}

export interface ReplayLabeledFinalTurn {
  turnId: string;
  transcript: string;
  transcriptSha256: string;
  expectedActionType: string | null;
  speakerRole: string;
  policyGroundingRequired: boolean;
  continuationChildExpected: boolean;
}

export interface ReplayRecruitingReleaseAttestation {
  runId: string;
  source: 'production_replay';
  assets: ReplayAttestedRealAsset[];
  observations: ReplayAttestedFinalTurnObservation[];
}

export interface ReplayRecruitingReleaseAttestationDocument {
  payload: ReplayRecruitingReleaseAttestation;
  signature: string;
}

export interface ReplayAttestedRealAsset {
  meetingId: string;
  audioSha256: string;
  captureId: string;
}

export interface ReplayAttestedFinalTurnObservation {
  meetingId: string;
  turnId: string;
  transcriptSha256: string;
  classifierTraceId: string;
  observedActionTypes: string[];
  parentActionId: string | null;
  childActionIds: string[];
  finalTurnAtMs: number;
  completedAtMs: number;
  childEmittedAtMs: number | null;
  policyGroundingUsed: boolean;
  positivePolicyCommitment: boolean;
  candidateFacingEvidenceLeak: boolean;
  unsafeVisibleAnswer: boolean;
}

export interface ReplayRunnerInput {
  manifestPath: string;
  outputDir: string;
  audioRoot?: string;
  fixtureRoot?: string;
  continuationFixtureRoot?: string;
  modeTemplateTypes?: string[];
  semanticGateMode?: DynamicActionReplaySemanticGateMode;
  cloudClassifier?: CloudSemanticGateClassifier;
  recruitingReleaseAttestationDocument?: ReplayRecruitingReleaseAttestationDocument;
  recruitingReleaseAttestationKey?: string;
  environmentStatus?: ReplayEnvironmentStatus;
  transcribeAudio?: (input: {
    entry: ReplayManifestEntry;
    audioPath: string;
  }) => string | undefined | Promise<string | undefined>;
}

export type ReplayEnvironmentStatus = 'ok' | 'blocked_missing_credentials' | 'not_applicable';
export type ReplayCoverageMode = 'sales' | 'fde' | 'team-meet' | 'recruiting';
export type DynamicActionReplaySemanticGateMode = 'real' | 'fixture_oracle';

export interface ReplayAssetCoverage {
  requiredReal: Record<ReplayCoverageMode, number>;
  availableReal: Record<ReplayCoverageMode, number>;
  availableSynthetic: Record<ReplayCoverageMode, number>;
  blockedReal: Record<ReplayCoverageMode, number>;
}

export interface ReplayReport {
  totalEntries: number;
  skippedEntries: number;
  failedEntries: number;
  passedEntries: number;
  environmentStatus: ReplayEnvironmentStatus;
  assetCoverage: ReplayAssetCoverage;
  assetCoverageFailures: ReplayAssetCoverageFailure[];
  entries: ReplayReportEntry[];
  recruitingRelease?: ReplayRecruitingReleaseReport;
}

export interface ReplayRecruitingReleaseReport {
  metrics: RecruitingReleaseQualityMetrics;
  gateFailures: string[];
  turns: ReplayRecruitingTurnResult[];
  provenance: {
    sourceKind: 'real_recording';
    attestationRunId: string;
    meetingIds: string[];
  };
}

export interface ReplayRecruitingTurnResult {
  meetingId: string;
  turnId: string;
  expectedActionType: string | null;
  actionTypes: string[];
  elapsedMs: number;
  classifierInvoked: boolean;
  classifierTraceId: string | null;
}

export interface ReplayAssetCoverageFailure {
  modeTemplateType: ReplayCoverageMode;
  requiredReal: number;
  availableReal: number;
  missingReal: number;
}

export interface ReplayReportEntry {
  id: string;
  status: 'passed' | 'skipped' | 'failed';
  reason?: string;
  emitted?: boolean;
  actionType?: string;
  expectedActionType?: string;
  semanticGateMode?: DynamicActionReplaySemanticGateMode;
  transcriptLength?: number;
  continuation?: ContinuationFixtureResult;
  failureStage?: 'initial_action' | 'continuation' | 'runtime_evaluation' | 'post_call';
}

export interface DynamicActionReplayTranscriptRow {
  speaker: string;
  content: string;
  timestamp_ms?: number;
}

export interface DynamicActionReplayAssessmentInput {
  rows: DynamicActionReplayTranscriptRow[];
  modeTemplateType: string;
  sessionId: string;
  language?: string;
  expectedActionType?: string;
  shouldEmit?: boolean;
  runnerMode?: DynamicActionFixtureRunnerMode;
  semanticGateMode?: DynamicActionReplaySemanticGateMode;
}

export async function assessDynamicActionTranscriptRows(input: DynamicActionReplayAssessmentInput): Promise<{
  emitted: boolean;
  actionTypes: string[];
  matched: boolean;
}> {
  const engine = new DynamicActionEngine();
  const actionTypes: string[] = [];
  const sortedRows = [...input.rows].sort((left, right) => (left.timestamp_ms ?? 0) - (right.timestamp_ms ?? 0));
  for (const [index, row] of sortedRows.entries()) {
    if (!row.content?.trim()) continue;
    const runnerMode = input.runnerMode ?? 'assessSignals';
    const semanticGateMode = input.semanticGateMode ?? 'real';
    const actions = runnerMode === 'regex'
      ? engine.detectActions({
          transcript: row.content,
          speaker: row.speaker,
          modeTemplateType: input.modeTemplateType,
          modeId: input.modeTemplateType,
          sessionId: input.sessionId,
          language: input.language,
        })
      : await engine.assessSignals({
          transcript: row.content,
          speaker: row.speaker,
          modeTemplateType: input.modeTemplateType,
          modeId: input.modeTemplateType,
          sessionId: input.sessionId,
          language: input.language,
          cloudClassifier: semanticGateMode === 'fixture_oracle'
            ? async gateInput => gateInput.candidates.map(candidate => ({
                actionType: candidate.actionType,
                decision: input.shouldEmit === false
                  ? 'reject'
                  : input.expectedActionType
                    ? candidate.actionType === input.expectedActionType ? 'pass' : 'reject'
                    : 'pass',
                confidence: 0.95,
                reasons: ['replay_expected_semantic_gate'],
                rejectedCandidates: input.shouldEmit === false || (
                  input.expectedActionType && candidate.actionType !== input.expectedActionType
                )
                  ? [candidate.actionType]
                  : [],
              }))
            : undefined,
          recentContextTurns: sortedRows.slice(0, index).map((turn) => ({
            speaker: turn.speaker,
            text: turn.content,
            timestamp: turn.timestamp_ms,
          })),
        });
    actionTypes.push(...actions.map((action) => action.type));
    if (input.expectedActionType && actionTypes.includes(input.expectedActionType)) {
      break;
    }
  }
  return {
    emitted: actionTypes.length > 0,
    actionTypes,
    matched: input.expectedActionType ? actionTypes.includes(input.expectedActionType) : actionTypes.length > 0,
  };
}

export function loadFixtureBackedSttTranscripts(input: {
  manifestPath: string;
  fixtureRoot?: string;
}): Map<string, string> {
  const entries = JSON.parse(fs.readFileSync(input.manifestPath, 'utf8')) as ReplayManifestEntry[];
  const fixtureRoot = input.fixtureRoot ?? path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product');
  const cache = new Map<string, DynamicActionProductFixture[]>();
  const transcripts = new Map<string, string>();

  for (const entry of entries) {
    const fixture = loadSourceFixture(entry.sourceFixture, fixtureRoot, cache);
    if (!fixture) continue;
    transcripts.set(entry.id, fixture.transcriptTurns.map((turn) => turn.text).join('\n'));
  }

  return transcripts;
}

export async function runDynamicActionReplay(input: ReplayRunnerInput): Promise<ReplayReport> {
  const semanticGateMode = input.semanticGateMode ?? 'real';
  if (semanticGateMode === 'real' && !input.cloudClassifier) {
    throw new Error('semanticGateMode "real" requires cloudClassifier');
  }
  const allEntries = JSON.parse(fs.readFileSync(input.manifestPath, 'utf8')) as ReplayManifestEntry[];
  const entries = input.modeTemplateTypes?.length
    ? allEntries.filter((entry) => input.modeTemplateTypes?.includes(entry.modeTemplateType))
    : allEntries;
  const audioRoot = input.audioRoot ?? process.cwd();
  const fixtureRoot = input.fixtureRoot ?? path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product');
  const continuationFixtureRoot = input.continuationFixtureRoot ?? path.join(process.cwd(), 'tests/fixtures/dynamic-actions/continuation');
  const fixtureCache = new Map<string, DynamicActionProductFixture[]>();
  const continuationFixtureCache = new Map<string, DynamicActionContinuationFixture[]>();
  const engine = new DynamicActionEngine();
  const reportEntries: ReplayReportEntry[] = [];

  for (const entry of entries) {
    const audioPath = path.isAbsolute(entry.audioPath)
      ? entry.audioPath
      : path.resolve(audioRoot, entry.audioPath);
    if (!fs.existsSync(audioPath)) {
      reportEntries.push(entry.expectedMissingAudio
        ? { id: entry.id, status: 'skipped' as const, reason: 'pending_audio_generation' }
        : { id: entry.id, status: 'failed' as const, reason: 'audio_missing' });
      continue;
    }

    if (!input.transcribeAudio) {
      reportEntries.push({ id: entry.id, status: 'skipped', reason: 'audio_replay_not_enabled_in_this_phase' });
      continue;
    }

    const fixture = loadSourceFixture(entry.sourceFixture, fixtureRoot, fixtureCache);
    if (!fixture) {
      reportEntries.push({ id: entry.id, status: 'failed', reason: 'source_fixture_not_found' });
      continue;
    }

    const transcript = await input.transcribeAudio({ entry, audioPath });
    if (!transcript?.trim()) {
      reportEntries.push({ id: entry.id, status: 'failed', reason: 'stt_empty_transcript' });
      continue;
    }

    const runnerMode = entry.runnerMode ?? 'assessSignals';
    const actions = runnerMode === 'regex'
      ? engine.detectActions({
          transcript,
          speaker: fixture.transcriptTurns[0]?.speaker,
          modeTemplateType: entry.modeTemplateType,
          modeId: entry.modeTemplateType,
          sessionId: `replay-${entry.id}`,
          language: entry.language,
        })
      : await engine.assessSignals({
          transcript,
          speaker: fixture.transcriptTurns[0]?.speaker,
          modeTemplateType: entry.modeTemplateType,
          modeId: entry.modeTemplateType,
          sessionId: `replay-${entry.id}`,
          language: entry.language,
          cloudClassifier: semanticGateMode === 'fixture_oracle'
            ? async input => input.candidates.map(candidate => ({
                actionType: candidate.actionType,
                decision: fixture.expected.shouldEmit
                  ? candidate.actionType === fixture.expected.actionType ? 'pass' : 'reject'
                  : 'reject',
                confidence: 0.95,
                reasons: ['replay_expected_semantic_gate'],
                rejectedCandidates: fixture.expected.shouldEmit && candidate.actionType === fixture.expected.actionType
                  ? []
                  : [candidate.actionType],
              }))
            : input.cloudClassifier,
        });
    const expectedActionType = fixture.expected.actionType;
    const matchedAction = expectedActionType
      ? actions.find((action) => action.type === expectedActionType)
      : undefined;
    const emitted = actions.length > 0;
    let passed = fixture.expected.shouldEmit
      ? !!matchedAction
      : !emitted;
    let continuation: ContinuationFixtureResult | undefined;
    let failureStage: ReplayReportEntry['failureStage'];
    if (passed && entry.continuationFixture) {
      const continuationFixture = loadContinuationFixture(entry.continuationFixture, continuationFixtureRoot, continuationFixtureCache);
      if (!continuationFixture) {
        passed = false;
        failureStage = 'continuation';
      } else {
        continuation = await runDynamicActionContinuationFixture({ fixture: continuationFixture });
        if (!continuation.passed) {
          passed = false;
          failureStage = continuation.failureStage ?? 'continuation';
        }
      }
    }

    reportEntries.push({
      id: entry.id,
      status: passed ? 'passed' : 'failed',
      reason: passed ? undefined : failureStage ? 'continuation_expectation_mismatch' : 'dynamic_action_expectation_mismatch',
      emitted,
      actionType: matchedAction?.type ?? actions[0]?.type,
      expectedActionType,
      semanticGateMode,
      transcriptLength: transcript.length,
      ...(continuation ? { continuation } : {}),
      ...(failureStage ? { failureStage } : {}),
    });
  }

  const assetCoverage = buildAssetCoverage(allEntries, audioRoot);
  const recruitingRelease = semanticGateMode === 'real' && entries.some(entry => entry.modeTemplateType === 'recruiting')
    ? await evaluateRecruitingLabeledFinalTurns(
        entries,
        input.cloudClassifier!,
        input.recruitingReleaseAttestationDocument,
        input.recruitingReleaseAttestationKey,
        audioRoot,
      )
    : undefined;
  const report: ReplayReport = {
    totalEntries: entries.length,
    skippedEntries: reportEntries.filter((entry) => entry.status === 'skipped').length,
    failedEntries: reportEntries.filter((entry) => entry.status === 'failed').length,
    passedEntries: reportEntries.filter((entry) => entry.status === 'passed').length,
    environmentStatus: input.environmentStatus ?? (input.transcribeAudio ? 'ok' : 'not_applicable'),
    assetCoverage,
    assetCoverageFailures: buildAssetCoverageFailures(assetCoverage, input.modeTemplateTypes),
    entries: reportEntries,
    ...(recruitingRelease ? { recruitingRelease } : {}),
  };
  fs.mkdirSync(input.outputDir, { recursive: true });
  fs.writeFileSync(path.join(input.outputDir, 'replay-report.json'), JSON.stringify(report, null, 2));
  return report;
}

async function evaluateRecruitingLabeledFinalTurns(
  entries: ReplayManifestEntry[],
  cloudClassifier: CloudSemanticGateClassifier,
  attestationDocument: ReplayRecruitingReleaseAttestationDocument | undefined,
  attestationKey: string | undefined,
  audioRoot: string,
): Promise<ReplayRecruitingReleaseReport> {
  const attestation = verifyRecruitingReleaseAttestationDocument(attestationDocument, attestationKey);
  const recruitingEntries = entries.filter(entry =>
    entry.modeTemplateType === 'recruiting'
    && entry.syntheticAudio === false
    && entry.realAsset?.sourceKind === 'real_recording');
  const turns: ReplayRecruitingTurnResult[] = [];
  let truePositiveCards = 0;
  let predictedCards = 0;
  let expectedPositiveTurns = 0;
  let falsePositiveNegativeTurns = 0;
  let negativeTurns = 0;
  let policyVerificationFailures = 0;
  let policyVerificationTurns = 0;
  let exclusiveMultiCardTurns = 0;
  let wrongSpeakerContinuationTurns = 0;
  let nonCandidateTurns = 0;
  let ungroundedPositivePolicyCommitments = 0;
  let candidateFacingEvidenceLeaks = 0;
  let duplicateDerivedActions = 0;
  let unsafeVisibleAnswerCount = 0;
  let derivedFalsePositiveTurns = 0;
  let derivedNegativeTurns = 0;
  const derivedLatencies: number[] = [];
  const integrityFailures = new Set<string>();
  const observations = new Map(
    (attestation?.observations ?? []).map(observation => [
      `${observation.meetingId}:${observation.turnId}`,
      observation,
    ]),
  );
  if (!attestation || attestation.source !== 'production_replay') {
    integrityFailures.add('trusted_runtime_attestation_missing');
  }
  validateAttestedAssets(recruitingEntries, attestation, audioRoot, integrityFailures);

  for (const entry of recruitingEntries) {
    const engine = new DynamicActionEngine();
    const recentContextTurns: Array<{ speaker: string; text: string }> = [];
    for (const label of entry.labeledFinalTurns ?? []) {
      const startedAt = Date.now();
      let classifierInvoked = false;
      const tracedClassifier: CloudSemanticGateClassifier = async classifierInput => {
        classifierInvoked = true;
        return cloudClassifier(classifierInput);
      };
      const actions = await engine.assessSignals({
        transcript: label.transcript,
        speaker: label.speakerRole,
        modeTemplateType: 'recruiting',
        modeId: 'recruiting',
        sessionId: `recruiting-release-${entry.realAsset!.meetingId}`,
        language: entry.language,
        cloudClassifier: tracedClassifier,
        recentContextTurns,
      });
      const elapsedMs = Date.now() - startedAt;
      const actionTypes = actions.map(action => action.type);
      const observation = observations.get(`${entry.realAsset!.meetingId}:${label.turnId}`);
      if (!observation) {
        integrityFailures.add('runtime_observation_missing');
      } else {
        if (observation.transcriptSha256 !== label.transcriptSha256) {
          integrityFailures.add('runtime_observation_transcript_mismatch');
        }
        if (!sameStringSet(observation.observedActionTypes, actionTypes)) {
          integrityFailures.add('runtime_observation_action_mismatch');
        }
      }
      if (label.expectedActionType && !classifierInvoked) {
        integrityFailures.add('required_classifier_not_invoked');
      }
      turns.push({
        meetingId: entry.realAsset!.meetingId,
        turnId: label.turnId,
        expectedActionType: label.expectedActionType,
        actionTypes,
        elapsedMs,
        classifierInvoked,
        classifierTraceId: observation?.classifierTraceId ?? null,
      });
      recentContextTurns.push({ speaker: label.speakerRole, text: label.transcript });

      predictedCards += actionTypes.length;
      if (label.expectedActionType) {
        expectedPositiveTurns += 1;
        if (actionTypes.includes(label.expectedActionType)) truePositiveCards += 1;
      } else {
        negativeTurns += 1;
        if (actionTypes.length > 0) falsePositiveNegativeTurns += 1;
      }
      if (actionTypes.length > 1) exclusiveMultiCardTurns += 1;

      if (!observation) continue;
      if (label.policyGroundingRequired) {
        policyVerificationTurns += 1;
        if (observation.positivePolicyCommitment && !observation.policyGroundingUsed) {
          policyVerificationFailures += 1;
        }
      }
      if (label.speakerRole !== 'candidate') {
        nonCandidateTurns += 1;
        if (observation.childActionIds.length > 0) wrongSpeakerContinuationTurns += 1;
      }
      if (observation.positivePolicyCommitment && !observation.policyGroundingUsed) {
        ungroundedPositivePolicyCommitments += 1;
      }
      if (observation.candidateFacingEvidenceLeak) candidateFacingEvidenceLeaks += 1;
      if (observation.unsafeVisibleAnswer) unsafeVisibleAnswerCount += 1;
      duplicateDerivedActions += Math.max(0, observation.childActionIds.length - 1);
      if (!label.continuationChildExpected) {
        derivedNegativeTurns += 1;
        if (observation.childActionIds.length > 0) derivedFalsePositiveTurns += 1;
      }
      if (observation.childActionIds.length > 0 && observation.childEmittedAtMs !== null) {
        derivedLatencies.push(Math.max(0, observation.childEmittedAtMs - observation.finalTurnAtMs));
      }
    }
  }

  const metrics: RecruitingReleaseQualityMetrics = {
    realMeetingCount: new Set(recruitingEntries.map(entry => entry.realAsset!.meetingId)).size,
    labeledFinalTurnCount: turns.length,
    precision: rate(truePositiveCards, predictedCards),
    recall: rate(truePositiveCards, expectedPositiveTurns),
    overallFalsePositiveRate: rate(falsePositiveNegativeTurns, negativeTurns),
    policyVerificationFalsePositiveRate: rate(policyVerificationFailures, policyVerificationTurns),
    exclusiveMultiCardRate: rate(exclusiveMultiCardTurns, turns.length),
    wrongSpeakerContinuationRate: rate(wrongSpeakerContinuationTurns, nonCandidateTurns),
    ungroundedPositivePolicyCommitments,
    candidateFacingEvidenceLeaks,
    duplicateDerivedActions,
    unsafeVisibleAnswerCount,
    derivedActionFalsePositiveRate: rate(derivedFalsePositiveTurns, derivedNegativeTurns),
    finalTurnToDerivedCardP95Ms: percentile95(derivedLatencies),
  };
  return {
    metrics,
    gateFailures: [
      ...evaluateRecruitingReleaseQualityGate(metrics),
      ...integrityFailures,
    ],
    turns,
    provenance: {
      sourceKind: 'real_recording',
      attestationRunId: attestation?.runId ?? 'missing',
      meetingIds: [...new Set(recruitingEntries.map(entry => entry.realAsset!.meetingId))],
    },
  };
}

function verifyRecruitingReleaseAttestationDocument(
  document: ReplayRecruitingReleaseAttestationDocument | undefined,
  key: string | undefined,
): ReplayRecruitingReleaseAttestation | undefined {
  if (!document || typeof key !== 'string' || Buffer.byteLength(key) < 32) return undefined;
  if (!document.payload || typeof document.signature !== 'string') return undefined;
  const expected = createHmac('sha256', key).update(JSON.stringify(document.payload)).digest('hex');
  const actualBuffer = Buffer.from(document.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return undefined;
  }
  const payload = document.payload;
  if (payload.source !== 'production_replay' || !payload.runId?.trim()) return undefined;
  if (!Array.isArray(payload.assets) || !Array.isArray(payload.observations)) return undefined;
  return payload;
}

function validateAttestedAssets(
  entries: ReplayManifestEntry[],
  attestation: ReplayRecruitingReleaseAttestation | undefined,
  audioRoot: string,
  failures: Set<string>,
): void {
  if (!attestation) return;
  const assets = new Map(attestation.assets.map(asset => [asset.meetingId, asset]));
  const seenCaptureIds = new Set<string>();
  const seenAudioHashes = new Set<string>();
  if (assets.size !== attestation.assets.length) failures.add('duplicate_attested_meeting_id');
  for (const asset of attestation.assets) {
    if (!asset.captureId?.trim()) failures.add('attested_capture_id_missing');
    if (seenCaptureIds.has(asset.captureId)) failures.add('duplicate_attested_capture_id');
    if (seenAudioHashes.has(asset.audioSha256)) failures.add('duplicate_attested_audio_sha256');
    seenCaptureIds.add(asset.captureId);
    seenAudioHashes.add(asset.audioSha256);
  }
  for (const entry of entries) {
    const provenance = entry.realAsset;
    const asset = provenance ? assets.get(provenance.meetingId) : undefined;
    if (!provenance || !asset || !asset.captureId?.trim() || asset.audioSha256 !== provenance.audioSha256) {
      failures.add('attested_asset_mismatch');
      continue;
    }
    const audioPath = path.isAbsolute(entry.audioPath)
      ? entry.audioPath
      : path.resolve(audioRoot, entry.audioPath);
    if (!fs.existsSync(audioPath)) {
      failures.add('attested_audio_missing');
      continue;
    }
    const actualSha256 = createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex');
    if (actualSha256 !== asset.audioSha256) failures.add('attested_audio_sha256_mismatch');
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function buildAssetCoverageFailures(
  coverage: ReplayAssetCoverage,
  modeTemplateTypes?: string[],
): ReplayAssetCoverageFailure[] {
  const modes: ReplayCoverageMode[] = ['sales', 'fde', 'team-meet', 'recruiting'];
  const requestedModes = modeTemplateTypes?.length
    ? modes.filter((mode) => modeTemplateTypes.includes(mode))
    : modes;
  return requestedModes
    .map((mode) => ({
      modeTemplateType: mode,
      requiredReal: coverage.requiredReal[mode],
      availableReal: coverage.availableReal[mode],
      missingReal: coverage.blockedReal[mode],
    }))
    .filter((failure) => failure.missingReal > 0);
}

function loadContinuationFixture(
  continuationFixture: string,
  fixtureRoot: string,
  cache: Map<string, DynamicActionContinuationFixture[]>,
): DynamicActionContinuationFixture | undefined {
  const [sourcePath, fixtureId] = continuationFixture.split('#');
  if (!sourcePath || !fixtureId) return undefined;
  const filePath = path.join(fixtureRoot, path.basename(sourcePath));
  if (!cache.has(filePath)) {
    if (!fs.existsSync(filePath)) return undefined;
    cache.set(filePath, loadDynamicActionContinuationFixtures(filePath));
  }
  return cache.get(filePath)?.find((fixture) => fixture.id === fixtureId);
}

function buildAssetCoverage(entries: ReplayManifestEntry[], audioRoot: string): ReplayAssetCoverage {
  const requiredReal: Record<ReplayCoverageMode, number> = { sales: 15, fde: 10, 'team-meet': 5, recruiting: 5 };
  const availableReal: Record<ReplayCoverageMode, number> = { sales: 0, fde: 0, 'team-meet': 0, recruiting: 0 };
  const availableSynthetic: Record<ReplayCoverageMode, number> = { sales: 0, fde: 0, 'team-meet': 0, recruiting: 0 };
  const modes = new Set<ReplayCoverageMode>(['sales', 'fde', 'team-meet', 'recruiting']);

  for (const entry of entries) {
    const mode = entry.modeTemplateType as ReplayCoverageMode;
    if (!modes.has(mode)) continue;
    const audioPath = path.isAbsolute(entry.audioPath)
      ? entry.audioPath
      : path.resolve(audioRoot, entry.audioPath);
    if (!fs.existsSync(audioPath)) continue;
    if (entry.syntheticAudio === true) {
      availableSynthetic[mode] += 1;
    } else if (mode !== 'recruiting' || (
      entry.syntheticAudio === false && entry.realAsset?.sourceKind === 'real_recording'
    )) {
      availableReal[mode] += 1;
    }
  }

  return {
    requiredReal,
    availableReal,
    availableSynthetic,
    blockedReal: {
      sales: Math.max(requiredReal.sales - availableReal.sales, 0),
      fde: Math.max(requiredReal.fde - availableReal.fde, 0),
      'team-meet': Math.max(requiredReal['team-meet'] - availableReal['team-meet'], 0),
      recruiting: Math.max(requiredReal.recruiting - availableReal.recruiting, 0),
    },
  };
}

function loadSourceFixture(
  sourceFixture: string,
  fixtureRoot: string,
  cache: Map<string, DynamicActionProductFixture[]>,
): DynamicActionProductFixture | undefined {
  const [sourcePath, fixtureId] = sourceFixture.split('#');
  if (!sourcePath || !fixtureId) return undefined;
  const fileName = path.basename(sourcePath);
  const filePath = path.join(fixtureRoot, fileName);
  if (!cache.has(filePath)) {
    if (!fs.existsSync(filePath)) return undefined;
    cache.set(filePath, JSON.parse(fs.readFileSync(filePath, 'utf8')) as DynamicActionProductFixture[]);
  }
  return cache.get(filePath)?.find((fixture) => fixture.id === fixtureId);
}
