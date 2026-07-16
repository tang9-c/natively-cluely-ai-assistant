import type { DynamicActionOutputType } from './DynamicAction';

export type DynamicActionFixtureRunnerMode = 'assessSignals' | 'regex';

export interface DynamicActionFixtureAssessmentContext {
  runnerMode?: DynamicActionFixtureRunnerMode;
  intentResult?: {
    intent: string;
    confidence: number;
    source?: string;
  } | null;
  recentContextTurns?: Array<{
    speaker?: string;
    text: string;
    timestamp?: number;
  }>;
  providerDataScopes?: Partial<Record<
    'transcript' | 'screenshots' | 'reference_files' | 'profile_history' | 'embeddings' | 'post_call_summary',
    boolean
  >>;
}

export interface DynamicActionAcceptedGroundingExpectation {
  type: 'material' | 'pptx' | 'screen' | 'business_context' | 'transcript';
  status: 'used' | 'not_found' | 'scope_denied' | 'failed';
  label?: string;
}

export interface DynamicActionProductFixture {
  id: string;
  modeTemplateType: 'sales' | 'fde' | 'team-meet' | 'recruiting';
  language: 'zh' | 'en' | 'mixed';
  transcriptTurns: Array<{
    speaker: 'user' | 'customer' | 'teammate' | 'internal' | string;
    text: string;
    final?: boolean;
  }>;
  assessment?: DynamicActionFixtureAssessmentContext;
  expected: {
    shouldEmit: boolean;
    actionType?: string;
    outputType?: DynamicActionOutputType;
    requiredCardCopy?: string[];
    forbiddenCardCopy?: string[];
    requiredAnswerPatterns?: string[];
    forbiddenAnswerPatterns?: string[];
    requiredMissingFields?: string[];
    requiredGrounding?: Array<'material' | 'pptx' | 'screen' | 'business_context' | 'transcript'>;
    acceptedAnswer?: string;
    acceptedMissingFields?: string[];
    acceptedGroundedSources?: DynamicActionAcceptedGroundingExpectation[];
  };
  negativeReason?: 'wrong_mode' | 'internal_chatter' | 'low_value' | 'missing_evidence' | 'unrelated_small_talk';
}

export interface DynamicActionProductFixtureResult {
  fixtureId: string;
  modeTemplateType: DynamicActionProductFixture['modeTemplateType'];
  actionType?: string;
  runnerMode: DynamicActionFixtureRunnerMode;
  semanticGateMode?: 'real' | 'fixture_oracle';
  shouldEmit: boolean;
  emitted: boolean;
  actionTypeMatched: boolean;
  outputTypeMatched: boolean;
  answerQualityPassed?: boolean;
  groundingPassed?: boolean;
  missingFieldsPassed?: boolean;
  cardCopyFailures: string[];
  acceptedOutputFailures: string[];
  groundingFailures: string[];
  missingFieldFailures: string[];
  acceptedPathPassed?: boolean;
  acceptedArtifact?: unknown;
  traces?: unknown[];
}

export interface DynamicActionProductScore {
  recallNumerator: number;
  recallDenominator: number;
  recallRate: number;
  falsePositiveNumerator: number;
  falsePositiveDenominator: number;
  falsePositiveRate: number;
  answerQualityFailures: string[];
  groundingFailures: string[];
  missingFieldFailures: string[];
}

export function evaluatePatternExpectations(
  text: string,
  patterns: { required?: string[]; forbidden?: string[] },
): { passed: boolean; missingRequired: string[]; matchedForbidden: string[] } {
  const normalizePattern = (pattern: string) => pattern.replaceAll('\\\\', '\\');
  const requiredPatterns = patterns.required ?? [];
  const forbiddenPatterns = patterns.forbidden ?? [];
  const missingRequired = requiredPatterns.filter((pattern) => !new RegExp(normalizePattern(pattern), 'i').test(text));
  const matchedForbidden = forbiddenPatterns.filter((pattern) => new RegExp(normalizePattern(pattern), 'i').test(text));
  return {
    passed: missingRequired.length === 0 && matchedForbidden.length === 0,
    missingRequired,
    matchedForbidden,
  };
}

export function matchesRequiredPatterns(
  text: string,
  patterns: string[],
): boolean {
  const normalizePattern = (pattern: string) => pattern.replaceAll('\\\\', '\\');
  return patterns.every((pattern) => new RegExp(normalizePattern(pattern), 'i').test(text));
}

export function scoreDynamicActionProductFixtures(
  results: DynamicActionProductFixtureResult[],
): DynamicActionProductScore {
  const positives = results.filter((result) => result.shouldEmit);
  const negatives = results.filter((result) => !result.shouldEmit);
  const recallNumerator = positives.filter((result) =>
    result.emitted && result.actionTypeMatched && result.outputTypeMatched
  ).length;
  const falsePositiveNumerator = negatives.filter((result) => result.emitted).length;

  return {
    recallNumerator,
    recallDenominator: positives.length,
    recallRate: positives.length === 0 ? 1 : recallNumerator / positives.length,
    falsePositiveNumerator,
    falsePositiveDenominator: negatives.length,
    falsePositiveRate: negatives.length === 0 ? 0 : falsePositiveNumerator / negatives.length,
    answerQualityFailures: results.filter((result) => result.answerQualityPassed === false).map((result) => result.fixtureId),
    groundingFailures: results.filter((result) => result.groundingPassed === false).map((result) => result.fixtureId),
    missingFieldFailures: results.filter((result) => result.missingFieldsPassed === false).map((result) => result.fixtureId),
  };
}

export function scoreDynamicActionProductFixturesByMode(
  results: DynamicActionProductFixtureResult[],
): Record<string, DynamicActionProductScore> {
  const grouped = new Map<string, DynamicActionProductFixtureResult[]>();
  for (const result of results) {
    const mode = result.modeTemplateType ?? 'unknown';
    grouped.set(mode, [...(grouped.get(mode) ?? []), result]);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([mode, modeResults]) => [
      mode,
      scoreDynamicActionProductFixtures(modeResults),
    ]),
  );
}
