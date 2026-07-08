import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
const prompts = fs.readFileSync(path.join(root, 'electron/llm/prompts.ts'), 'utf8');
const tinyPrompts = fs.readFileSync(path.join(root, 'electron/llm/tinyPrompts.ts'), 'utf8');

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

  assert.match(block, /uploaded|reference|trusted context|grounded/i);
  assert.match(block, /Do not invent/);
  assert.match(block, /customer names/);
  assert.match(block, /metrics/);
  assert.match(block, /outcomes/);
  assert.match(block, /ROI/);
});

test('sales pricing request keeps placeholder rules intact', () => {
  const block = extractBlock('pricing_request');

  assert.match(block, /\[CUSTOMER_NAME\]/);
  assert.match(block, /\[QUOTE_AMOUNT\]/);
  assert.match(block, /\[NEXT_STEP\]/);
  assert.match(block, /Do not invent/);
  assert.match(block, /pricing/);
  assert.match(block, /customer names/);
  assert.match(block, /account numbers/);
  assert.match(block, /contract terms/);
  assert.match(block, /commercial terms/);
});

test('sales buying signal requires owner date and artifact', () => {
  const block = extractBlock('buying_signal');

  assert.match(block, /owner/i);
  assert.match(block, /date/i);
  assert.match(block, /artifact/i);
  assert.match(block, /missing/i);
});

test('sales technical requirements must clarify rather than promise capability', () => {
  const block = extractBlock('technical_requirements');

  assert.match(block, /Clarify systems, APIs, auth, deployment environment, security constraints, owners, and the smallest validation step/);
  assert.match(block, /Do not promise capability before validation/);
  assert.doesNotMatch(block, /guarantee|承诺能力已具备/);
});

test('sales prompts are narrowed to five sellable moments', () => {
  const mainBlock = prompts.match(/export const MODE_SALES_PROMPT = `[\s\S]*?`\.trim\(\);/)?.[0] ?? '';
  const tinyBlock = tinyPrompts.match(/export const TINY_MODE_SALES_PROMPT = `[\s\S]*?`;/)?.[0] ?? '';

  for (const token of ['价格异议', '报价', '案例', '技术', '下一步']) {
    assert.match(mainBlock, new RegExp(token));
  }
  assert.match(mainBlock, /不编造客户案例|不允许编客户案例|Do not invent customer/i);
  assert.match(mainBlock, /上传|reference_file|参考文件|trusted context/i);
  assert.match(tinyBlock, /case|proof|案例|证明/i);
  assert.match(tinyBlock, /quote|proposal|报价/i);
});
