import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/electron/services/qa/DynamicActionContinuationFixtureRunner.js'),
).href;
const fixturePath = path.join(process.cwd(), 'tests/fixtures/dynamic-actions/continuation/sales.json');

async function load() {
  return import(moduleUrl);
}

test('loads the first continuation fixture matrix', async () => {
  const { loadDynamicActionContinuationFixtures } = await load();
  const fixtures = loadDynamicActionContinuationFixtures(fixturePath);
  assert.ok(fixtures.length >= 12);
  assert.equal(fixtures.filter((fixture) => fixture.expected.derivedActionEmitted).length, 7);
  assert.ok(fixtures.some((fixture) => fixture.providerDataScopes?.transcript === false));
  assert.ok(fixtures.some((fixture) => fixture.plannerResults.some((result) => 'failure' in result && result.failure === 'timeout')));
});

test('rejects unknown schema speaker and insufficient planner results', async () => {
  const { loadDynamicActionContinuationFixtures } = await load();
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'reports/continuation-fixture-schema-'));

  fs.writeFileSync(
    path.join(dir, 'bad-speaker.json'),
    JSON.stringify([{ ...fixtures[0], id: 'bad-speaker', turns: [{ speaker: 'external', text: 'hello', final: true }] }]),
    'utf8',
  );
  assert.throws(() => loadDynamicActionContinuationFixtures(path.join(dir, 'bad-speaker.json')), /invalid_continuation_fixture_speaker/);

  fs.writeFileSync(
    path.join(dir, 'missing-planner.json'),
    JSON.stringify([{ ...fixtures[0], id: 'missing-planner', plannerResults: [] }]),
    'utf8',
  );
  assert.throws(() => loadDynamicActionContinuationFixtures(path.join(dir, 'missing-planner.json')), /planner_results_insufficient/);
});

test('positive continuation fixture emits a child action correlated to the parent', async () => {
  const { loadDynamicActionContinuationFixtures, runDynamicActionContinuationFixture } = await load();
  const fixture = loadDynamicActionContinuationFixtures(fixturePath)
    .find((item) => item.id === 'sales-continuation-capability-fit-zh-001');
  const result = await runDynamicActionContinuationFixture({ fixture });

  assert.equal(result.initialActionCompleted, true);
  assert.equal(result.plannerCalls, 2);
  assert.equal(result.derivedActionEmitted, true);
  assert.ok(result.parentActionId);
  assert.ok(result.childActionId);
  assert.notEqual(result.childActionId, result.parentActionId);
  assert.equal(result.visibleAnswerKind, 'generated');
  assert.equal(result.unsafeVisibleAnswerCount, 0);
  assert.equal(result.postCallCarryover, true);
  assert.equal(result.passed, true);
});

test('negative continuation fixtures do not emit derived actions', async () => {
  const { loadDynamicActionContinuationFixtures, runDynamicActionContinuationFixture } = await load();
  const fixtures = loadDynamicActionContinuationFixtures(fixturePath)
    .filter((item) => item.expected.derivedActionEmitted === false);
  for (const fixture of fixtures) {
    const result = await runDynamicActionContinuationFixture({ fixture });
    assert.equal(result.derivedActionEmitted, false, `${fixture.id} should not emit`);
    assert.equal(result.postCallCarryover, false, `${fixture.id} should not carry over`);
    assert.equal(result.passed, true, `${fixture.id} should pass`);
  }
});
