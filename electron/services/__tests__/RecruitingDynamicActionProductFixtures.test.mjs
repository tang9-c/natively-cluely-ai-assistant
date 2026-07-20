import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const runnerUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/qa/DynamicActionFixtureRunner.js'),
).href;
const engineUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js'),
).href;
const fixtureDir = path.join(root, 'tests/fixtures/dynamic-actions/product');
const fixturePath = path.join(fixtureDir, 'recruiting.json');

test('recruiting product fixtures cover the release matrix', () => {
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const positives = fixtures.filter((fixture) => fixture.expected.shouldEmit);
  const negatives = fixtures.filter((fixture) => !fixture.expected.shouldEmit);
  const byAction = (type) => positives.filter((fixture) => fixture.expected.actionType === type);

  assert.ok(fixtures.length >= 40);
  assert.ok(byAction('candidate_concern').length >= 8);
  assert.ok(byAction('candidate_experience_probe').length >= 18);
  assert.ok(byAction('strong_fit_signal').length >= 4);
  assert.ok(negatives.length >= 10);
  assert.ok(['zh', 'en', 'mixed'].every((language) => fixtures.some((fixture) => fixture.language === language)));
  assert.ok(['candidate', 'interviewer', 'internal'].every((speaker) =>
    fixtures.some((fixture) => fixture.transcriptTurns.some((turn) => turn.speaker === speaker)),
  ));

  const rubricIntents = new Set(
    byAction('candidate_experience_probe').flatMap((fixture) => fixture.tags ?? []),
  );
  for (const intent of ['personal_action', 'result', 'ownership', 'tradeoff_or_verification']) {
    assert.ok(rubricIntents.has(intent), `missing recruiting rubric intent ${intent}`);
  }

  const collisions = fixtures.filter((fixture) => (fixture.tags ?? []).includes('multi_candidate_collision'));
  assert.ok(collisions.length >= 6);
});

test('recruiting product fixtures exercise the deterministic action and accepted-output path', async () => {
  const [{ runDynamicActionProductFixtures }, { DynamicActionEngine }] = await Promise.all([
    import(runnerUrl),
    import(engineUrl),
  ]);
  const outputDir = path.join(root, 'reports/dynamic-actions-recruiting-test');
  fs.rmSync(outputDir, { recursive: true, force: true });

  const report = await runDynamicActionProductFixtures({
    fixtureDir,
    outputDir,
    semanticGateMode: 'fixture_oracle',
  });
  const recruiting = report.modeScores.recruiting;
  const results = report.results.filter((result) => result.modeTemplateType === 'recruiting');
  const collisions = results.filter((result) => result.fixtureId.includes('collision'));
  const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const engine = new DynamicActionEngine();

  assert.equal(report.invalidFixtures.length, 0);
  assert.ok(recruiting.recallRate >= 0.8, `recruiting recall ${recruiting.recallRate} should be >= 0.80`);
  assert.ok(recruiting.falsePositiveRate < 0.1, `recruiting false positive ${recruiting.falsePositiveRate} should be < 0.10`);
  assert.deepEqual(recruiting.answerQualityFailures, []);
  assert.deepEqual(recruiting.groundingFailures, []);
  assert.deepEqual(recruiting.missingFieldFailures, []);
  assert.equal(results.every((result) => result.semanticGateMode === 'fixture_oracle'), true);
  assert.equal(collisions.every((result) => !result.emitted || result.actionTypeMatched), true);
  for (const fixture of fixtures.filter((item) => (item.tags ?? []).includes('multi_candidate_collision'))) {
    const actions = await engine.assessSignals({
      transcript: fixture.transcriptTurns.map((turn) => turn.text).join('\n'),
      modeTemplateType: 'recruiting',
      modeId: 'recruiting',
      sessionId: fixture.id,
      language: fixture.language,
      speaker: fixture.transcriptTurns.at(-1)?.speaker,
      cloudClassifier: async (input) => input.candidates.map((candidate) => ({
        actionType: candidate.actionType,
        decision: 'pass',
        confidence: 0.95,
        reasons: ['collision_policy_test'],
        rejectedCandidates: [],
      })),
    });
    assert.ok(actions.length <= 1, `collision emitted ${actions.length} cards: ${fixture.id}`);
  }
});
