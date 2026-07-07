import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
const scoringPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');

async function load() {
  return {
    ...(await import(pathToFileURL(enginePath).href)),
    ...(await import(pathToFileURL(scoringPath).href)),
  };
}

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
