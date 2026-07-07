import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');

function extractBlock(type) {
  const match = detector.match(new RegExp(`type:\\s*'${type}'[\\s\\S]*?answerStyle:\\s*\\{[\\s\\S]*?\\}`, 'm'));
  return match?.[0] ?? '';
}

test('sales pricing objection uses a spoken short script, not bullets', () => {
  const block = extractBlock('pricing_objection');

  assert.match(block, /format:\s*'short_script'/);
  assert.doesNotMatch(block, /format:\s*'bullets'/);
});

test('sales case study request avoids invented proof without trusted context', () => {
  const block = extractBlock('case_study_request');

  assert.match(block, /Do not invent customer names, metrics, or outcomes without trusted context/);
});

test('sales pricing request keeps placeholder rules intact', () => {
  const block = extractBlock('pricing_request');

  assert.match(block, /\[CUSTOMER_NAME\]/);
  assert.match(block, /\[QUOTE_AMOUNT\]/);
  assert.match(block, /\[NEXT_STEP\]/);
  assert.match(block, /Do not invent customer names, account numbers, specific pricing, or contract terms/);
});
