import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  classifyQualityGate,
  formatQualityGateReport,
  getChangedFiles,
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

test('requires quality gate for screen prompt changes', () => {
  const result = classifyQualityGate(['electron/services/screen/visionPrompts.ts']);

  assert.equal(result.required, true);
  assert.deepEqual(
    result.matches.map((match) => match.category),
    ['speaker_or_screen_context'],
  );
});

test('includes untracked quality-sensitive files in changed file discovery', (t) => {
  const probePath = path.join(process.cwd(), 'electron/llm/__quality_gate_untracked_probe__.ts');
  fs.writeFileSync(probePath, 'export const probe = true;\n');
  t.after(() => {
    fs.rmSync(probePath, { force: true });
  });

  const changedFiles = getChangedFiles('HEAD');

  assert.ok(changedFiles.includes('electron/llm/__quality_gate_untracked_probe__.ts'));
  assert.equal(classifyQualityGate(changedFiles).required, true);
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
