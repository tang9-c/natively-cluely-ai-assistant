import fs from 'fs';
import path from 'path';
import { DynamicActionEngine } from '../dynamic-actions/DynamicActionEngine';
import type { DynamicAction } from '../dynamic-actions/DynamicAction';
import { buildDynamicActionArtifacts } from '../dynamic-actions/DynamicActionArtifacts';
import { evaluateDynamicActionAcceptedOutput } from '../dynamic-actions/DynamicActionAcceptedOutputEvaluator';
import { evaluateFdeAcceptedOutput } from '../dynamic-actions/FdeAcceptedOutputEvaluator';
import { evaluateTeamMeetingAcceptedOutput } from '../dynamic-actions/TeamMeetingAcceptedOutputEvaluator';
import type {
  DynamicActionProductFixture,
  DynamicActionProductFixtureResult,
} from '../dynamic-actions/DynamicActionProductFixtures';
import {
  evaluatePatternExpectations,
  scoreDynamicActionProductFixtures,
  scoreDynamicActionProductFixturesByMode,
} from '../dynamic-actions/DynamicActionProductFixtures';

export interface ProductRunnerInput {
  fixtureDir: string;
  outputDir: string;
}

export interface ProductRunnerReport {
  totalFixtures: number;
  results: DynamicActionProductFixtureResult[];
  score: ReturnType<typeof scoreDynamicActionProductFixtures>;
  modeScores: ReturnType<typeof scoreDynamicActionProductFixturesByMode>;
  invalidFixtures: InvalidFixtureRecord[];
}

export interface InvalidFixtureRecord {
  file: string;
  fixtureId?: string;
  error: string;
}

export function loadProductFixtures(
  fixtureDir: string,
  invalidFixtures: InvalidFixtureRecord[] = [],
): DynamicActionProductFixture[] {
  const files = ['sales.json', 'fde.json', 'team-meet.json', 'recruiting.json'];
  return files.flatMap((file) => {
    let parsed: DynamicActionProductFixture[];
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')) as DynamicActionProductFixture[];
    } catch (error) {
      invalidFixtures.push({ file, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
    const validFixtures: DynamicActionProductFixture[] = [];
    for (const fixture of parsed) {
      try {
        validateFixture(fixture);
        validFixtures.push(fixture);
      } catch (error) {
        invalidFixtures.push({
          file,
          fixtureId: fixture?.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return validFixtures;
  });
}

export async function runDynamicActionProductFixtures(input: ProductRunnerInput): Promise<ProductRunnerReport> {
  const invalidFixtures: InvalidFixtureRecord[] = [];
  const fixtures = loadProductFixtures(input.fixtureDir, invalidFixtures);
  const engine = new DynamicActionEngine();
  const results: DynamicActionProductFixtureResult[] = [];

  for (const fixture of fixtures) {
    const transcript = fixture.transcriptTurns.map((turn) => turn.text).join('\n');
    const runnerMode = fixture.assessment?.runnerMode ?? 'assessSignals';
    const traces: unknown[] = [];
    const actions = runnerMode === 'regex'
      ? engine.detectActions({
          transcript,
          modeTemplateType: fixture.modeTemplateType,
          modeId: fixture.modeTemplateType,
          sessionId: `fixture-${fixture.id}`,
          language: fixture.language,
        })
      : await engine.assessSignals({
          transcript,
          modeTemplateType: fixture.modeTemplateType,
          modeId: fixture.modeTemplateType,
          sessionId: `fixture-${fixture.id}`,
          language: fixture.language,
          speaker: fixture.transcriptTurns.at(-1)?.speaker,
          recentContextTurns: fixture.assessment?.recentContextTurns,
          intentResult: fixture.assessment?.intentResult as any,
          providerDataScopes: fixture.assessment?.providerDataScopes as any,
          semanticGateTraceSink: (trace) => traces.push(trace),
        });
    const matchedAction = fixture.expected.actionType
      ? actions.find((action) => action.type === fixture.expected.actionType)
      : undefined;
    const firstAction = fixture.expected.actionType ? matchedAction : actions[0];
    const cardText = firstAction
      ? [
          firstAction.productContract?.userAction,
          firstAction.productContract?.whyNow,
          firstAction.productContract?.evidenceSummary,
          firstAction.productContract?.outputPromise,
        ].filter(Boolean).join('\n')
      : '';
    const cardPatternResult = evaluatePatternExpectations(cardText, {
      required: fixture.expected.requiredCardCopy ?? [],
      forbidden: fixture.expected.forbiddenCardCopy ?? [],
    });
    const acceptedPath = runAcceptedActionPathForFixture(fixture, firstAction);
    const acceptedOutputFailures = acceptedPath.acceptedOutputFailures;
    const groundingFailures = acceptedPath.groundingFailures;
    const missingFieldFailures = acceptedPath.missingFieldFailures;
    results.push({
      fixtureId: fixture.id,
      modeTemplateType: fixture.modeTemplateType,
      actionType: fixture.expected.actionType,
      runnerMode,
      shouldEmit: fixture.expected.shouldEmit,
      emitted: actions.length > 0,
      actionTypeMatched: !!matchedAction || (!fixture.expected.actionType && actions.length === 0),
      outputTypeMatched: !!firstAction && (
        !fixture.expected.outputType || firstAction.productContract?.outputType === fixture.expected.outputType
      ),
      answerQualityPassed: cardPatternResult.passed && acceptedOutputFailures.length === 0,
      groundingPassed: groundingFailures.length === 0,
      missingFieldsPassed: missingFieldFailures.length === 0,
      cardCopyFailures: [
        ...cardPatternResult.missingRequired.map((pattern) => `missing_card:${pattern}`),
        ...cardPatternResult.matchedForbidden.map((pattern) => `forbidden_card:${pattern}`),
      ],
      acceptedOutputFailures,
      groundingFailures,
      missingFieldFailures,
      acceptedPathPassed: acceptedPath.acceptedPathPassed,
      acceptedArtifact: acceptedPath.acceptedArtifact,
    });
  }

  const score = scoreDynamicActionProductFixtures(results);
  const modeScores = scoreDynamicActionProductFixturesByMode(results);
  const report = { totalFixtures: fixtures.length, results, score, modeScores, invalidFixtures };
  fs.mkdirSync(input.outputDir, { recursive: true });
  fs.writeFileSync(path.join(input.outputDir, 'product-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(input.outputDir, 'product-report.md'), renderMarkdown(report));
  return report;
}

function validateFixture(fixture: DynamicActionProductFixture): void {
  if (!fixture.id || !fixture.modeTemplateType || !Array.isArray(fixture.transcriptTurns)) {
    throw new Error(`Invalid dynamic action product fixture: ${fixture.id ?? 'unknown'}`);
  }
  if (!fixture.expected || typeof fixture.expected.shouldEmit !== 'boolean') {
    throw new Error(`Invalid dynamic action product expectation: ${fixture.id}`);
  }
  if ((fixture as any).mode || (fixture as any).expectedActions) {
    throw new Error(`Fixture uses obsolete Step 5 schema: ${fixture.id}`);
  }
}

function runAcceptedActionPathForFixture(fixture: DynamicActionProductFixture, action?: DynamicAction) {
  const expected = fixture.expected;
  if (!expected.acceptedAnswer || !action) {
    return {
      acceptedPathPassed: true,
      acceptedArtifact: undefined,
      acceptedOutputFailures: [],
      groundingFailures: [],
      missingFieldFailures: [],
    };
  }

  const acceptedAt = action.createdAt ?? 1_000;
  const artifact = buildDynamicActionArtifacts({
    actions: [{
      id: action.id,
      modeTemplateType: action.modeTemplateType,
      type: action.type,
      productContract: action.productContract,
      status: 'accepted',
      createdAt: acceptedAt,
      latestTurn: action.latestTurn,
      retrievalQuery: action.retrievalQuery,
    }],
    usage: [{
      answer: expected.acceptedAnswer,
      timestamp: acceptedAt,
      metadata: {
        source: 'dynamic_action',
        actionId: action.id,
        generationStatus: 'completed',
        groundedSources: expected.acceptedGroundedSources?.map((source) => ({
          ...source,
          label: source.label ?? 'accepted action',
        })),
      },
    }],
  })[0];

  const groundingFailures = compareExpectedGrounding(
    artifact?.groundedSources ?? [],
    expected.acceptedGroundedSources ?? [],
  );
  const missingFieldFailures = compareExpectedMissingFields(
    artifact?.missingFields ?? [],
    expected.acceptedMissingFields ?? [],
  );
  const acceptedOutputFailures = evaluateAcceptedOutputForMode(fixture, artifact, expected.acceptedAnswer, action);

  return {
    acceptedPathPassed: acceptedOutputFailures.length === 0 && groundingFailures.length === 0 && missingFieldFailures.length === 0,
    acceptedArtifact: artifact,
    acceptedOutputFailures,
    groundingFailures,
    missingFieldFailures,
  };
}

function compareExpectedMissingFields(actual: string[], expected: string[] = []): string[] {
  return expected.filter((field) => !actual.includes(field));
}

function compareExpectedGrounding(
  actual: Array<{ type: string; status: string; label?: string }>,
  expected: Array<{ type: string; status: string; label?: string }> = [],
): string[] {
  return expected
    .filter((item) => !actual.some((source) =>
      source.type === item.type &&
      source.status === item.status &&
      (!item.label || source.label === item.label)
    ))
    .map((item) => `${item.type}:${item.status}${item.label ? `:${item.label}` : ''}`);
}

function evaluateAcceptedOutputForMode(
  fixture: DynamicActionProductFixture,
  artifact: any,
  answerText: string,
  action?: DynamicAction,
): string[] {
  const patternResult = evaluatePatternExpectations(answerText, {
    required: fixture.expected.requiredAnswerPatterns ?? [],
    forbidden: fixture.expected.forbiddenAnswerPatterns ?? [],
  });
  const modeFailures = fixture.modeTemplateType === 'fde'
    ? evaluateFdeAcceptedOutput({
        actionType: artifact?.actionType ?? fixture.expected.actionType ?? '',
        answerText,
        missingFields: artifact?.missingFields ?? [],
        groundedSources: artifact?.groundedSources ?? [],
      }).failures
    : fixture.modeTemplateType === 'team-meet'
      ? evaluateTeamMeetingAcceptedOutput({
          actionType: artifact?.actionType ?? fixture.expected.actionType ?? '',
          answerText,
          missingFields: artifact?.missingFields ?? [],
        }).failures
    : [];
  const genericResult = evaluateDynamicActionAcceptedOutput({
    actionType: artifact?.actionType ?? fixture.expected.actionType ?? '',
    outputType: artifact?.outputType ?? 'spoken_response',
    answerText,
    missingFields: artifact?.missingFields ?? [],
    groundedSources: artifact?.groundedSources ?? [],
    sourceUtterance: action?.latestTurn ?? fixture.transcriptTurns.map((turn) => turn.text).join('\n'),
    sourceIntent: action?.sourceIntent,
  });
  return [
    ...patternResult.missingRequired.map((pattern) => `missing_answer:${pattern}`),
    ...patternResult.matchedForbidden.map((pattern) => `forbidden_answer:${pattern}`),
    ...genericResult.requiredPatternFailures.map((failure) => `accepted_required:${failure}`),
    ...genericResult.forbiddenPatternFailures.map((failure) => `accepted_forbidden:${failure}`),
    ...genericResult.groundingFailures.map((failure) => `accepted_grounding:${failure}`),
    ...genericResult.missingFieldFailures.map((failure) => `accepted_missing_field:${failure}`),
    ...modeFailures,
  ];
}

function renderMarkdown(report: ProductRunnerReport): string {
  return [
    '# Dynamic Action Product Report',
    '',
    `Total fixtures: ${report.totalFixtures}`,
    `Recall: ${report.score.recallNumerator}/${report.score.recallDenominator} (${formatRate(report.score.recallRate)})`,
    `False positives: ${report.score.falsePositiveNumerator}/${report.score.falsePositiveDenominator} (${formatRate(report.score.falsePositiveRate)})`,
    '',
    '## Mode Scores',
    '',
    ...Object.entries(report.modeScores).map(([mode, score]) =>
      `- ${mode}: recall ${score.recallNumerator}/${score.recallDenominator} (${formatRate(score.recallRate)}), false positives ${score.falsePositiveNumerator}/${score.falsePositiveDenominator} (${formatRate(score.falsePositiveRate)})`
    ),
    '',
  ].join('\n');
}

function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
