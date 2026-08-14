import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/shared/dynamicActionUiStage.js'),
).href;

test('UI stage reports retain only fixed privacy-safe fields', async () => {
  const { sanitizeDynamicActionUiStageReport } = await import(moduleUrl);
  const report = sanitizeDynamicActionUiStageReport({
    actionId: 'action_safe-id',
    stage: 'dropped',
    surface: 'overlay',
    reason: 'expired',
    ageMs: 1234.4,
    visibleCount: 2,
    transcript: 'must not survive',
    evidence: 'must not survive',
    prompt: 'must not survive',
    answer: 'must not survive',
  });

  assert.deepEqual(report, {
    actionId: 'action_safe-id',
    stage: 'dropped',
    surface: 'overlay',
    reason: 'expired',
    ageMs: 1234,
    visibleCount: 2,
  });
});

test('UI stage reports reject unknown stages surfaces and free-form drop reasons', async () => {
  const { sanitizeDynamicActionUiStageReport } = await import(moduleUrl);

  assert.equal(sanitizeDynamicActionUiStageReport({
    actionId: 'action_1', stage: 'painted', surface: 'launcher',
  }), null);
  assert.equal(sanitizeDynamicActionUiStageReport({
    actionId: 'action_1', stage: 'rendered', surface: 'settings',
  }), null);
  assert.equal(sanitizeDynamicActionUiStageReport({
    actionId: 'action_1', stage: 'dropped', surface: 'launcher', reason: 'raw diagnostic text',
  }), null);
});
