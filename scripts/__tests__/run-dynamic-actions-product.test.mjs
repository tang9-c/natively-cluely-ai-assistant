import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const source = fs.readFileSync('scripts/run-dynamic-actions-product.mjs', 'utf8');

test('dynamic action product CLI enforces 100 percent recall and zero false positives', () => {
  assert.match(source, /recallNumerator\s*!==\s*score\.recallDenominator/);
  assert.match(source, /falsePositiveNumerator\s*!==\s*0/);
  assert.match(source, /answerQualityFailures/);
  assert.match(source, /groundingFailures/);
  assert.match(source, /missingFieldFailures/);
  assert.match(source, /process\.exit\(1\)/);
  assert.doesNotMatch(source, /recallRate\s*<=\s*0\.75/);
  assert.doesNotMatch(source, /recallRate\s*<=\s*0\.85/);
});
