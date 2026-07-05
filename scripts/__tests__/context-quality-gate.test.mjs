import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyQualityGate,
  formatQualityGateReport,
} from '../context-quality-gate.mjs';

test('requires quality gate for prompt and realtime LLM path changes', () => {
  const result = classifyQualityGate([
    'electron/llm/CodeHintLLM.ts',
    'electron/IntelligenceEngine.ts',
  ]);

  assert.equal(result.required, true);
  assert.deepEqual(
    result.matches.map((match) => match.category),
    ['prompt_or_answer_generation', 'prompt_or_answer_generation'],
  );
});

test('requires quality gate for RAG and context selection changes', () => {
  const result = classifyQualityGate([
    'electron/rag/RAGManager.ts',
    'electron/services/RealtimeContextOrchestrator.ts',
  ]);

  assert.equal(result.required, true);
  assert.deepEqual(
    result.matches.map((match) => match.category),
    ['rag_or_material_context', 'context_selection'],
  );
});

test('requires quality gate for dynamic action and business system changes', () => {
  const result = classifyQualityGate([
    'electron/services/dynamic-actions/ModeEventClassifier.ts',
    'electron/services/business-system/BusinessSystemContextService.ts',
  ]);

  assert.equal(result.required, true);
  assert.deepEqual(
    result.matches.map((match) => match.category),
    ['dynamic_action_rules', 'business_system_context'],
  );
});

test('does not require quality gate for unrelated docs or renderer styling', () => {
  const result = classifyQualityGate([
    'README.md',
    'src/components/SettingsOverlay.tsx',
  ]);

  assert.equal(result.required, false);
  assert.deepEqual(result.matches, []);
});

test('formats required command report with no-build fast loop', () => {
  const result = classifyQualityGate(['electron/llm/WhatToAnswerLLM.ts']);
  const report = formatQualityGateReport(result);

  assert.match(report, /Context quality gate required/);
  assert.match(report, /npm run test:quality:smoke/);
  assert.match(report, /npm run test:quality:diagnostics/);
  assert.match(report, /npm run test:quality:smoke:no-build/);
  assert.match(report, /electron\/llm\/WhatToAnswerLLM.ts/);
});

test('formats not-required report', () => {
  const result = classifyQualityGate(['docs/engineering/packaging-size-reduction-plan.md']);
  const report = formatQualityGateReport(result);

  assert.match(report, /not required/);
});
