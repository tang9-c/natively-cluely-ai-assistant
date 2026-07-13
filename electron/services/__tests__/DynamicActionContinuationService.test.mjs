import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const url = pathToFileURL(path.join(
  process.cwd(),
  'dist-electron/electron/services/dynamic-actions/DynamicActionContinuationService.js',
)).href;

function action(overrides = {}) {
  return {
    id: 'parent-1',
    sessionId: 'session-1',
    modeId: 'sales',
    modeTemplateType: 'sales',
    type: 'discovery_question',
    label: '追问',
    status: 'completed',
    sourceIntent: 'sales_capability_fit',
    latestTurn: '你们能支持流体仿真吗？',
    evidenceRefs: [{ source: 'transcript', text: '流体仿真' }],
    keyEntities: ['流体仿真'],
    language: 'zh',
    createdAt: 1,
    productContract: { outputType: 'spoken_response' },
    confidence: 0.9,
    priority: 0.9,
    promptInstruction: '',
    ...overrides,
  };
}

test('registers only completed eligible actions and supersedes one active record per session', async () => {
  const { DynamicActionContinuationService } = await import(url);
  let now = 1_000;
  const service = new DynamicActionContinuationService({ now: () => now });
  assert.equal(service.registerCompletedAction(action({ status: 'accepted' })), null);
  assert.equal(service.registerCompletedAction(action())?.parentActionId, 'parent-1');
  assert.equal(service.registerCompletedAction(action()), null);
  service.registerCompletedAction(action({ id: 'parent-2', latestTurn: '补充案例证明' }));
  assert.equal(service.getActiveForSession('session-1')?.parentActionId, 'parent-2');
  now += 300_001;
  assert.equal(service.getActiveForSession('session-1'), null);
});
