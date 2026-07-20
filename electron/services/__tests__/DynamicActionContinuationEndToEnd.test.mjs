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

test('FDE continuation fixtures meet process-first release gates', async () => {
  const { loadDynamicActionContinuationFixtures, runDynamicActionContinuationFixture } = await import(moduleUrl);
  const fixtures = loadDynamicActionContinuationFixtures(
    path.join(process.cwd(), 'tests/fixtures/dynamic-actions/continuation/fde.json'),
  );
  assert.ok(fixtures.length >= 12);

  const results = [];
  for (const fixture of fixtures) {
    results.push(await runDynamicActionContinuationFixture({ fixture }));
  }

  const failed = results.filter((result) => !result.passed);
  assert.deepEqual(failed, []);

  const positives = results.filter((result) => result.shouldEmit);
  const negatives = results.filter((result) => !result.shouldEmit);
  assert.ok(positives.length >= 6);
  assert.ok(negatives.length >= 6);
  assert.equal(positives.every((result) => result.derivedActionEmitted && result.duplicateDerivedActions === 0), true);
  assert.equal(negatives.every((result) => !result.derivedActionEmitted), true);

  for (const result of positives) {
    const fixture = fixtures.find((item) => item.id === result.fixtureId);
    assert.ok(fixture, `missing fixture for ${result.fixtureId}`);
    assert.ok(result.visibleAnswerText, `missing visible answer for ${result.fixtureId}`);
    assert.match(result.visibleAnswerText, /流程|process/i, `FDE answer must stay process-first: ${result.fixtureId}`);
    assert.match(result.visibleAnswerText, /验证|验收|测试数据|样本|PoC|validation|test data|acceptance/i, `FDE answer must name validation evidence: ${result.fixtureId}`);

    const sourceText = fixture.turns.map((turn) => turn.text).join('\n');
    if (!mentionsArchitectureContext(sourceText)) {
      const firstSentence = result.visibleAnswerText.split(/[。！？.!?]/)[0] || result.visibleAnswerText;
      assert.doesNotMatch(firstSentence, /API|SSO|接口|端点|系统架构|架构|endpoint|auth|sandbox|production/i, `FDE answer must not lead with architecture without architecture context: ${result.fixtureId}`);
    }

    if (mentionsAiSupportContext(sourceText) || mentionsAiSupportContext(result.visibleAnswerText)) {
      assert.match(result.visibleAnswerText, /检查|提示|提醒|check|prompt|suggest/i, `AI-support FDE answer must explain what AI can do: ${result.fixtureId}`);
      assert.match(result.visibleAnswerText, /人审|人工确认|human confirmation|human/i, `AI-support FDE answer must keep human confirmation explicit: ${result.fixtureId}`);
      assert.match(result.visibleAnswerText, /验证|验收|测试数据|样本|PoC|validation|test data|acceptance/i, `AI-support FDE answer must include validation: ${result.fixtureId}`);
    }
  }
});

test('recruiting continuation fixtures emit neutral evidence summaries only after eligible evidence', async () => {
  const { loadDynamicActionContinuationFixtures, runDynamicActionContinuationFixture } = await import(moduleUrl);
  const fixtures = loadDynamicActionContinuationFixtures(
    path.join(process.cwd(), 'tests/fixtures/dynamic-actions/continuation/recruiting.json'),
  );
  const results = [];
  for (const fixture of fixtures) results.push(await runDynamicActionContinuationFixture({ fixture }));

  const positives = results.filter((result) => result.shouldEmit);
  const negatives = results.filter((result) => !result.shouldEmit);
  assert.equal(fixtures.length, 16);
  assert.equal(positives.length, 8);
  assert.equal(negatives.length, 8);
  assert.equal(positives.every((result) =>
    result.derivedActionEmitted &&
    result.derivedActionType === 'candidate_evidence_summary' &&
    result.duplicateDerivedActions === 0,
  ), true);
  assert.equal(negatives.every((result) => !result.derivedActionEmitted && result.visibleAnswerKind === 'none'), true);
  assert.equal(positives.every((result) => result.visibleAnswerKind === 'generated' && result.postCallCarryover), true);
  assert.deepEqual(
    new Set(negatives.map((result) => fixtures.find((fixture) => fixture.id === result.fixtureId)?.negativeReason)),
    new Set([
      'wrong_speaker',
      'interim_turn',
      'unrelated_topic',
      'provider_scope_denial',
      'planner_timeout',
      'invalid_json',
      'final_hiring_judgment',
      'unsupported_invented_evidence',
    ]),
  );
});

function mentionsArchitectureContext(text) {
  return /API|SSO|接口|端点|系统架构|架构|endpoint|auth|sandbox|production|集成方式|权限/i.test(text);
}

function mentionsAiSupportContext(text) {
  return /AI|智能体|Agent|自动判断|自动检查|自动提醒/i.test(text);
}
