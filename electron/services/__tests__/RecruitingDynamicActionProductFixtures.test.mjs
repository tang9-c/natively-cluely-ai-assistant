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

const deterministicRecruitingClassifier = async (input) => {
  const transcript = input.transcript.toLocaleLowerCase();
  const candidateTypes = new Set(input.candidates.map((candidate) => candidate.actionType));
  const policyTypes = new Set(input.policySummary.actions.map((action) => action.actionType));
  const canDecide = (actionType) => candidateTypes.has(actionType) && policyTypes.has(actionType);
  const isCandidate = input.speaker === 'candidate';
  const isInterviewer = input.speaker === 'interviewer';
  const policyConcern = /签证|薪资|offer|入职时间|远程|混合办公|搬迁|安全审查|visa|compensation|salary|offer|start date|remote|hybrid|relocation|security/.test(transcript);
  const policyRequest = /确认|说明|担心|支持|可以吗|吗|\?|？|confirm|concern|can you|support|timeline/.test(transcript);
  const experienceRequest = /tell me about.*experience|walk me through.*background|specific example|concrete example|give me an example|why this role|讲讲你的经验|介绍一下你的背景|具体的例子|举个具体例子|举一个具体例子|举一个例子/.test(transcript);
  const explicitInterest = /i(?:'m| am) (?:very )?interested in (?:this )?(?:role|position)|i(?:'d| would) love to join|i(?:'m| am) excited (?:about|to join) (?:this )?(?:role|team)|this (?:role|position) really interests me|我对这个岗位很感兴趣|我对这个职位很感兴趣|我很想加入|我很期待加入|这个岗位很吸引我/.test(transcript);

  return input.candidates.map((candidate) => {
    const pass =
      (candidate.actionType === 'candidate_concern' && isCandidate && policyConcern && policyRequest) ||
      (candidate.actionType === 'candidate_experience_probe' && isInterviewer && experienceRequest) ||
      (candidate.actionType === 'strong_fit_signal' && isCandidate && explicitInterest);
    return {
      actionType: candidate.actionType,
      decision: pass && canDecide(candidate.actionType) ? 'pass' : 'reject',
      confidence: pass ? 0.95 : 0.9,
      reasons: [pass ? 'deterministic_recruiting_classifier_pass' : 'deterministic_recruiting_classifier_reject'],
      rejectedCandidates: pass ? [] : [candidate.actionType],
    };
  });
};

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
    semanticGateMode: 'real',
    cloudClassifier: deterministicRecruitingClassifier,
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
  assert.equal(results.every((result) => result.semanticGateMode === 'real'), true);
  assert.equal(collisions.every((result) => !result.emitted || result.actionTypeMatched), true);
  for (const fixture of fixtures.filter((item) => (item.tags ?? []).includes('multi_candidate_collision'))) {
    const actions = await engine.assessSignals({
      transcript: fixture.transcriptTurns.map((turn) => turn.text).join('\n'),
      modeTemplateType: 'recruiting',
      modeId: 'recruiting',
      sessionId: fixture.id,
      language: fixture.language,
      speaker: fixture.transcriptTurns.at(-1)?.speaker,
      cloudClassifier: deterministicRecruitingClassifier,
    });
    assert.equal(actions.length, 1, `collision must emit one card: ${fixture.id}`);
  }
});

test('deterministic recruiting classifier ignores a conflicting fixture expectation', async () => {
  const input = {
    transcript: 'I am very interested in this role.',
    speaker: 'candidate',
    candidates: [
      { actionType: 'candidate_concern' },
      { actionType: 'strong_fit_signal' },
    ],
    policySummary: {
      actions: [
        { actionType: 'candidate_concern' },
        { actionType: 'strong_fit_signal' },
      ],
    },
  };
  const baseline = await deterministicRecruitingClassifier(input);
  const conflictingExpected = await deterministicRecruitingClassifier({
    ...input,
    expected: { shouldEmit: true, actionType: 'candidate_concern' },
  });

  assert.deepEqual(conflictingExpected, baseline);
  assert.deepEqual(
    baseline.map((result) => [result.actionType, result.decision]),
    [
      ['candidate_concern', 'reject'],
      ['strong_fit_signal', 'pass'],
    ],
  );
});
