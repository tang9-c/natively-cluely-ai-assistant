import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/electron/services/qa/DynamicActionContinuationFixtureRunner.js'),
).href;

test('sales continuation zh fixture runs parent to grounded answer to post-call carryover', async () => {
  const { loadDynamicActionContinuationFixtures, runDynamicActionContinuationFixture } = await import(moduleUrl);
  const fixtures = loadDynamicActionContinuationFixtures(
    path.join(process.cwd(), 'tests/fixtures/dynamic-actions/continuation/sales.json'),
  );
  const fixture = fixtures.find((item) => item.id === 'sales-continuation-capability-fit-zh-001');
  assert.ok(fixture);

  const result = await runDynamicActionContinuationFixture({ fixture });

  assert.equal(result.initialActionCompleted, true);
  assert.equal(result.plannerCalls, 2);
  assert.ok(result.childActionId);
  assert.ok(result.parentActionId);
  assert.notEqual(result.childActionId, result.parentActionId);
  assert.equal(result.derivedActionEmitted, true);
  assert.equal(result.visibleAnswerKind, 'generated');
  assert.equal(result.unsafeVisibleAnswerCount, 0);
  assert.equal(result.postCallCarryover, true);
});
