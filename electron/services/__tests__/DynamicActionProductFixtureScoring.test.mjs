import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const helperPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');

async function loadHelper() {
  return import(pathToFileURL(helperPath).href);
}

test('scores recall and false positives with one shared formula', async () => {
  const { scoreDynamicActionProductFixtures } = await loadHelper();
  const score = scoreDynamicActionProductFixtures([
    { fixtureId: 's1', shouldEmit: true, emitted: true, actionTypeMatched: true, outputTypeMatched: true },
    { fixtureId: 's2', shouldEmit: true, emitted: false, actionTypeMatched: false, outputTypeMatched: false },
    { fixtureId: 'n1', shouldEmit: false, emitted: true, actionTypeMatched: false, outputTypeMatched: false },
    { fixtureId: 'n2', shouldEmit: false, emitted: false, actionTypeMatched: false, outputTypeMatched: false },
  ]);

  assert.equal(score.recallDenominator, 2);
  assert.equal(score.recallNumerator, 1);
  assert.equal(score.falsePositiveDenominator, 2);
  assert.equal(score.falsePositiveNumerator, 1);
  assert.equal(score.recallRate, 0.5);
  assert.equal(score.falsePositiveRate, 0.5);
});

test('checks required and forbidden answer patterns', async () => {
  const { evaluatePatternExpectations } = await loadHelper();
  assert.equal(evaluatePatternExpectations('Use [QUOTE_AMOUNT] after scope is confirmed.', {
    required: ['\\\\[QUOTE_AMOUNT\\\\]', 'scope'],
    forbidden: ['ACME Corp', '\\\\$\\\\d+'],
  }).passed, true);

  assert.equal(evaluatePatternExpectations('The quote is $1000 for ACME Corp.', {
    required: ['quote'],
    forbidden: ['ACME Corp', '\\\\$\\\\d+'],
  }).passed, false);
});
