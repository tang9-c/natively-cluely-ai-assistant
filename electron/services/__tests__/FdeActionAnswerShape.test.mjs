import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

test('fde agent feasibility prompt requires human confirmation and no-write boundary', () => {
  const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
  const block = detector.match(/type:\s*'fde_agent_feasibility'[\s\S]*?answerStyle:\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(block, /human confirmation|人工确认/i);
  assert.match(block, /must not write|不能.*写入|read-only/i);
});

test('fde agent feasibility intent maps to a checklist answer shape', () => {
  const classifier = fs.readFileSync(path.join(root, 'electron/llm/IntentClassifier.ts'), 'utf8');
  assert.match(classifier, /fde_agent_feasibility/);
  assert.match(classifier, /checklist/i);
  assert.match(classifier, /human confirmation|人工确认|只读/i);
});

test('fde agent feasibility is wired into shared intent contracts', () => {
  const shared = fs.readFileSync(path.join(root, 'electron/llm/IntentClassifierShared.ts'), 'utf8');

  assert.match(shared, /'fde_agent_feasibility'/);
  assert.match(shared, /AI Agent boundary as a checklist|checklist: what AI can suggest/i);
  assert.match(shared, /human confirmation|人工确认|只读|read-only/i);
  assert.match(shared, /automation boundaries|自动化边界/);
});

test('fde agent feasibility ships default keywords and keyword match order', () => {
  const defaults = fs.readFileSync(path.join(root, 'electron/llm/IntentKeywordDefaults.ts'), 'utf8');

  const fdeKeywordsBlock = defaults.match(/const FDE_KEYWORDS:[\s\S]*?];/);
  assert.ok(fdeKeywordsBlock, 'FDE keywords block must exist');
  assert.match(fdeKeywordsBlock[0], /intent:\s*'fde_agent_feasibility'/);
  assert.match(fdeKeywordsBlock[0], /AI Agent|automation|人工确认|只读|写回/);

  const fdeOrderBlock = defaults.match(/fde:\s*\[[^\]]+\]/);
  assert.ok(fdeOrderBlock, 'FDE intent match order must exist');
  assert.match(fdeOrderBlock[0], /'fde_agent_feasibility'/);
});
