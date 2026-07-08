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
    id: 'sales-price-zh',
    text: '这个价格太高了，我们预算不够。',
    shouldEmit: true,
    actionType: 'pricing_objection',
    outputType: 'spoken_response',
  },
  {
    id: 'sales-quote-en',
    text: 'Can you send me a proposal and commercial terms?',
    shouldEmit: true,
    actionType: 'pricing_request',
    outputType: 'email_draft',
  },
  {
    id: 'sales-case-mixed',
    text: '有没有 similar customer 的落地案例或者 ROI proof?',
    shouldEmit: true,
    actionType: 'case_study_request',
    outputType: 'spoken_response',
  },
  {
    id: 'sales-tech-en',
    text: 'What are the API and SSO requirements for production?',
    shouldEmit: true,
    actionType: 'technical_requirements',
    outputType: 'checklist',
  },
  {
    id: 'sales-buying-zh',
    text: '下一步我们可以让法务看合同，先安排 pilot。',
    shouldEmit: true,
    actionType: 'buying_signal',
    outputType: 'action_item',
  },
  {
    id: 'sales-internal-price-sheet',
    text: '我们的报价表在这，等客户问再发。',
    shouldEmit: false,
  },
];

test('sales fixtures emit only the brief-selected representative actions', async () => {
  const { DynamicActionEngine, scoreDynamicActionProductFixtures } = await load();
  const engine = new DynamicActionEngine();

  const results = fixtures.map((fixture) => {
    const actions = engine.detectActions({
      transcript: fixture.text,
      modeTemplateType: 'sales',
      modeId: 'sales',
      sessionId: fixture.id,
    });
    const action = fixture.actionType ? actions.find((item) => item.type === fixture.actionType) : undefined;
    return {
      fixtureId: fixture.id,
      shouldEmit: fixture.shouldEmit,
      emitted: actions.length > 0,
      actionTypeMatched: fixture.actionType ? action?.type === fixture.actionType : false,
      outputTypeMatched: fixture.outputType ? action?.productContract?.outputType === fixture.outputType : false,
    };
  });

  const score = scoreDynamicActionProductFixtures(results);
  assert.equal(score.recallDenominator, 5);
  assert.equal(score.recallNumerator, 5);
  assert.equal(score.falsePositiveDenominator, 1);
  assert.equal(score.falsePositiveNumerator, 0);
  assert.equal(score.recallRate, 1);
  assert.equal(score.falsePositiveRate, 0);
});
