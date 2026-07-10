import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
const scoringPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');
const runnerPath = path.join(root, 'dist-electron/electron/services/qa/DynamicActionFixtureRunner.js');

async function load() {
  return {
    ...(await import(pathToFileURL(enginePath).href)),
    ...(await import(pathToFileURL(scoringPath).href)),
  };
}

const TEAM_MEETING_ROOT_CAUSES = [
  {
    fixtureId: 'team-blocker-en-005',
    actualActionType: null,
    expectedActionType: 'blocker_check',
    whyWrong: 'blocker phrasing is dependency-first and current pattern misses it',
    fixType: 'add_blocker_dependency_pattern',
    positiveGuardFixtureId: 'team-blocker-en-004',
  },
  {
    fixtureId: 'team-negative-004',
    actualActionType: 'decision_point',
    expectedActionType: null,
    whyWrong: 'discussion option was treated as final decision',
    fixType: 'decision_uncertainty_suppression',
    positiveGuardFixtureId: 'team-decision-zh-001',
  },
  {
    fixtureId: 'team-negative-005',
    actualActionType: 'action_item',
    expectedActionType: null,
    whyWrong: 'sales or quote wording should not become a Team Meeting action item',
    fixType: 'sales_context_suppression',
    positiveGuardFixtureId: 'team-action-item-zh-001',
  },
  {
    fixtureId: 'team-negative-006',
    actualActionType: 'blocker_check',
    expectedActionType: null,
    whyWrong: 'small talk or unrelated status text should not become a blocker',
    fixType: 'small_talk_suppression',
    positiveGuardFixtureId: 'team-blocker-zh-001',
  },
];

const fixtures = [
  {
    id: 'team-action-item-zh',
    text: '我来负责，周五前完成发布 checklist。',
    shouldEmit: true,
    actionType: 'action_item',
    outputType: 'action_item',
  },
  {
    id: 'team-decision-zh',
    text: '最终决定用 Postgres。',
    shouldEmit: true,
    actionType: 'decision_point',
    outputType: 'decision_record',
  },
  {
    id: 'team-blocker-zh',
    text: '现在卡在前端依赖。',
    shouldEmit: true,
    actionType: 'blocker_check',
    outputType: 'checklist',
  },
  {
    id: 'team-no-sales-quote',
    text: '我们的报价表在这。',
    shouldEmit: false,
  },
];

test('team-meet fixtures preserve action completeness signals without sales quote false positives', async () => {
  const { DynamicActionEngine, scoreDynamicActionProductFixtures } = await load();
  const engine = new DynamicActionEngine();

  const results = fixtures.map((fixture) => {
    const actions = engine.detectActions({
      transcript: fixture.text,
      modeTemplateType: 'team-meet',
      modeId: 'team-meet',
      sessionId: fixture.id,
    });
    const action = fixture.actionType ? actions.find((item) => item.type === fixture.actionType) : undefined;

    if (!fixture.shouldEmit) {
      assert.equal(actions.some((item) => item.type === 'pricing_request'), false);
    }

    return {
      fixtureId: fixture.id,
      shouldEmit: fixture.shouldEmit,
      emitted: actions.length > 0,
      actionTypeMatched: fixture.actionType ? action?.type === fixture.actionType : false,
      outputTypeMatched: fixture.outputType ? action?.productContract?.outputType === fixture.outputType : false,
    };
  });

  const score = scoreDynamicActionProductFixtures(results);
  assert.equal(score.recallDenominator, 3);
  assert.equal(score.recallNumerator, 3);
  assert.equal(score.falsePositiveDenominator, 1);
  assert.equal(score.falsePositiveNumerator, 0);
  assert.equal(score.recallRate, 1);
  assert.equal(score.falsePositiveRate, 0);
});

test('team-meet product fixtures meet release gates', async () => {
  const { loadProductFixtures, runDynamicActionProductFixtures } = await import(pathToFileURL(runnerPath).href);
  const fixtureDir = path.join(root, 'tests/fixtures/dynamic-actions/product');
  const fixtures = loadProductFixtures(fixtureDir).filter((fixture) => fixture.modeTemplateType === 'team-meet');
  assert.equal(fixtures.length, 30);

  const outDir = path.join(root, 'reports/dynamic-actions-team-test');
  fs.rmSync(outDir, { recursive: true, force: true });
  const report = await runDynamicActionProductFixtures({ fixtureDir, outputDir: outDir });
  const team = report.modeScores['team-meet'];

  const unexpectedTeamResults = report.results
    .filter((result) => result.modeTemplateType === 'team-meet')
    .filter((result) => (!result.shouldEmit && result.emitted) || (result.shouldEmit && !result.emitted))
    .map((result) => result.fixtureId);
  for (const fixtureId of unexpectedTeamResults) {
    assert.ok(
      TEAM_MEETING_ROOT_CAUSES.some((item) => item.fixtureId === fixtureId),
      `Missing Team Meeting root cause for ${fixtureId}`,
    );
  }

  assert.ok(team.recallRate > 0.85, `Team recall too low: ${team.recallRate}`);
  assert.ok(team.falsePositiveRate < 0.10, `Team false positive too high: ${team.falsePositiveRate}`);
  assert.deepEqual(team.answerQualityFailures, []);
  assert.deepEqual(team.missingFieldFailures, []);
});
