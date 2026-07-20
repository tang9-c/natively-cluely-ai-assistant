import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(path.join(
  process.cwd(),
  'dist-electron/electron/services/context/ContextNeedDecision.js',
)).href;

test('candidate concern requires recruiting material but candidate evidence summary does not', async () => {
  const { buildDynamicActionContextNeedDecision } = await import(moduleUrl);
  const concern = buildDynamicActionContextNeedDecision({
    type: 'candidate_concern',
    label: '回应候选人政策问题',
    modeTemplateType: 'recruiting',
    confidence: 0.9,
  });
  assert.equal(concern.material, 'required');
  assert.equal(concern.business, 'not_needed');

  const summary = buildDynamicActionContextNeedDecision({
    type: 'candidate_evidence_summary',
    label: '总结候选人证据',
    modeTemplateType: 'recruiting',
    confidence: 0.9,
  });
  assert.equal(summary.material, 'not_needed');
  assert.equal(summary.business, 'not_needed');
  assert.equal(summary.screen, 'not_needed');
});
