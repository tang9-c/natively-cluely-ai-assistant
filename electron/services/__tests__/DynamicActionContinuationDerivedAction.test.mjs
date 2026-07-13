import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadEngine() {
  return import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js',
  )).href);
}

test('enqueueDerivedAction stores one capability card per parent', async () => {
  const { DynamicActionEngine } = await loadEngine();
  const engine = new DynamicActionEngine();
  const input = {
    sessionId: 's1',
    modeId: 'sales',
    modeTemplateType: 'sales',
    type: 'capability_fit_answer',
    parentActionId: 'parent-1',
    sourceIntent: 'sales_capability_fit',
    latestTurn: '对象是电池包冷却液流道，指标是压降和温升。',
    evidenceRefs: [{ source: 'transcript', text: '对象是电池包冷却液流道' }],
    keyEntities: ['电池包', '压降', '温升'],
    retrievalQuery: '电池包冷却液流道 压降 温升',
    confidence: 0.91,
    language: 'zh',
    createdAt: 1_000,
  };
  const first = engine.enqueueDerivedAction(input);
  const duplicate = engine.enqueueDerivedAction({ ...input, latestTurn: '再次补充温升指标', createdAt: 2_000 });
  assert.equal(first.type, 'capability_fit_answer');
  assert.equal(first.parentActionId, 'parent-1');
  assert.equal(first.autoSurfacePolicy, 'card');
  assert.equal(first.autoTriggerEligible, false);
  assert.equal(duplicate, null);
  assert.equal(engine.getStore().getAllActions('s1').length, 1);
});
