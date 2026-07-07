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

