import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
const scoringPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');
const salesFixturePath = path.join(root, 'tests/fixtures/dynamic-actions/product/sales.json');

async function load() {
  return {
    ...(await import(pathToFileURL(enginePath).href)),
    ...(await import(pathToFileURL(scoringPath).href)),
  };
}

test('sales product fixtures cover the full 50 item matrix', async () => {
  const fixtures = JSON.parse(fs.readFileSync(salesFixturePath, 'utf8'));
  assert.equal(fixtures.length, 50);

  const actionTypes = new Set(fixtures.filter((fixture) => fixture.expected.shouldEmit).map((fixture) => fixture.expected.actionType));
  for (const expectedType of [
    'pricing_objection',
    'pricing_request',
    'case_study_request',
    'technical_requirements',
    'buying_signal',
  ]) {
    assert.ok(actionTypes.has(expectedType), `missing sales action type ${expectedType}`);
  }

  assert.ok(fixtures.some((fixture) => fixture.language === 'zh'));
  assert.ok(fixtures.some((fixture) => fixture.language === 'en'));
  assert.ok(fixtures.some((fixture) => fixture.language === 'mixed'));
  assert.ok(fixtures.some((fixture) => fixture.negativeReason === 'internal_chatter'));
  assert.ok(fixtures.some((fixture) => fixture.negativeReason === 'missing_evidence' || fixture.negativeReason === 'low_value'));
});

test('sales product fixtures meet recall and false positive gates', async () => {
  const { DynamicActionEngine, scoreDynamicActionProductFixtures, evaluatePatternExpectations } = await load();
  const engine = new DynamicActionEngine();
  const fixtures = JSON.parse(fs.readFileSync(salesFixturePath, 'utf8'));

  const results = fixtures.map((fixture) => {
    const transcript = fixture.transcriptTurns.map((turn) => turn.text).join('\n');
    const actions = engine.detectActions({
      transcript,
      modeTemplateType: fixture.modeTemplateType,
      modeId: fixture.modeTemplateType,
      sessionId: `sales-fixture-${fixture.id}`,
      language: fixture.language,
    });
    const matchedAction = fixture.expected.actionType
      ? actions.find((action) => action.type === fixture.expected.actionType)
      : undefined;
    const firstAction = matchedAction ?? actions[0];
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

    return {
      fixtureId: fixture.id,
      actionType: fixture.expected.actionType,
      shouldEmit: fixture.expected.shouldEmit,
      emitted: actions.length > 0,
      actionTypeMatched: fixture.expected.actionType ? matchedAction?.type === fixture.expected.actionType : actions.length === 0,
      outputTypeMatched: fixture.expected.outputType ? firstAction?.productContract?.outputType === fixture.expected.outputType : actions.length === 0,
      answerQualityPassed: cardPatternResult.passed,
    };
  });

  const score = scoreDynamicActionProductFixtures(results);
  assert.ok(score.recallRate >= 0.8, `sales recall ${score.recallRate} should be >= 0.8`);
  assert.ok(score.falsePositiveRate < 0.1, `sales false positive ${score.falsePositiveRate} should be < 0.1`);
  assert.deepEqual(score.answerQualityFailures, []);

  const positiveMismatches = results.filter((result) =>
    result.shouldEmit && (!result.actionTypeMatched || !result.outputTypeMatched)
  );
  assert.deepEqual(positiveMismatches, []);
});
