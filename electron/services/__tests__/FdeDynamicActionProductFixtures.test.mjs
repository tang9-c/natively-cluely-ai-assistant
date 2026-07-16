import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
const scoringPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');
const runnerPath = path.join(root, 'dist-electron/electron/services/qa/DynamicActionFixtureRunner.js');

async function load() {
  return {
    ...(await import(pathToFileURL(enginePath).href)),
    ...(await import(pathToFileURL(scoringPath).href)),
  };
}

const FDE_FALSE_POSITIVE_ROOT_CAUSES = [
  {
    fixtureId: 'fde-negative-002',
    whyWrong: 'not a customer manufacturing PLM/QMS/AI Agent deployment moment',
    fixType: 'negative_context_suppression',
    positiveGuardFixtureId: 'fde-discovery-zh-001',
  },
  {
    fixtureId: 'fde-negative-003',
    whyWrong: 'internal wording or material mention is not a customer deployment ask',
    fixType: 'internal_context_suppression',
    positiveGuardFixtureId: 'fde-object-zh-001',
  },
  {
    fixtureId: 'fde-negative-004',
    whyWrong: 'generic technical chatter does not include PLM/QMS/manufacturing delivery intent',
    fixType: 'manufacturing_context_required',
    positiveGuardFixtureId: 'fde-integration-zh-001',
  },
  {
    fixtureId: 'fde-negative-005',
    whyWrong: 'AI mention alone is not an enterprise AI Agent deployment decision',
    fixType: 'agent_deployment_context_required',
    positiveGuardFixtureId: 'fde-agent-zh-001',
  },
  {
    fixtureId: 'fde-negative-006',
    whyWrong: 'risk-like language is not tied to current evidence',
    fixType: 'risk_context_required',
    positiveGuardFixtureId: 'fde-risk-zh-001',
  },
  {
    fixtureId: 'fde-negative-007',
    whyWrong: 'next-step wording does not include current customer delivery context',
    fixType: 'next_step_context_required',
    positiveGuardFixtureId: 'fde-next-zh-001',
  },
  {
    fixtureId: 'fde-negative-008',
    whyWrong: 'internal planning should not trigger the current customer turn',
    fixType: 'current_turn_context_required',
    positiveGuardFixtureId: 'fde-next-mixed-003',
  },
  {
    fixtureId: 'fde-negative-010',
    whyWrong: 'small talk or joining-call text must stay silent',
    fixType: 'small_talk_suppression',
    positiveGuardFixtureId: 'fde-discovery-en-004',
  },
];

const fixtures = [
  {
    id: 'fde-plm-bom-eco',
    text: '我们现在要对 BOM 做 ECO 变更，先确认 PLM 里的版本和发布权限。',
    shouldEmit: true,
    actionType: ['fde_discovery_probe', 'fde_integration_check'],
    outputType: 'checklist',
  },
  {
    id: 'fde-capa-ncr',
    text: '这个 NCR 已经升级到 CAPA 了，需要先确认追溯、审计和责任人。',
    shouldEmit: true,
    actionType: ['fde_discovery_probe', 'fde_risk_blocker'],
    outputType: 'checklist',
  },
  {
    id: 'fde-agent-boundary',
    text: '这个 AI Agent 只能做只读分析，不能自动写回 PLM 或 QMS，必须有人确认后再执行。',
    shouldEmit: true,
    actionType: 'fde_agent_feasibility',
    outputType: 'checklist',
  },
  {
    id: 'fde-small-talk',
    text: '对了，中午吃什么比较好？',
    shouldEmit: false,
  },
];

test('FDE manufacturing fixtures prefer PLM/BOM/ECO, quality, and AI Agent boundary actions', async () => {
  const { DynamicActionEngine, scoreDynamicActionProductFixtures } = await load();
  const engine = new DynamicActionEngine();

  const results = fixtures.map((fixture) => {
    const actions = engine.detectActions({
      transcript: fixture.text,
      modeTemplateType: 'fde',
      modeId: 'mode_fde',
      sessionId: fixture.id,
    });
    const action = fixture.actionType
      ? actions.find((item) => Array.isArray(fixture.actionType)
        ? fixture.actionType.includes(item.type)
        : item.type === fixture.actionType)
      : undefined;

    return {
      fixtureId: fixture.id,
      shouldEmit: fixture.shouldEmit,
      emitted: actions.length > 0,
      actionTypeMatched: Boolean(action),
      outputTypeMatched: fixture.outputType ? action?.productContract?.outputType === fixture.outputType : false,
    };
  });

  const score = scoreDynamicActionProductFixtures(results);
  assert.equal(score.recallDenominator, 3);
  assert.equal(score.recallNumerator, 3);
  assert.equal(score.falsePositiveDenominator, 1);
  assert.equal(score.falsePositiveNumerator, 0);
  assert.equal(score.recallRate, 1);
  assert.equal(score.falsePositiveRate, 0);
});

test('FDE product fixtures meet release gates', async () => {
  const { loadProductFixtures, runDynamicActionProductFixtures } = await import(pathToFileURL(runnerPath).href);
  const fixtureDir = path.join(root, 'tests/fixtures/dynamic-actions/product');
  const fixtures = loadProductFixtures(fixtureDir).filter((fixture) => fixture.modeTemplateType === 'fde');
  assert.equal(fixtures.length, 40);

  const outDir = path.join(root, 'reports/dynamic-actions-fde-test');
  fs.rmSync(outDir, { recursive: true, force: true });
  const report = await runDynamicActionProductFixtures({
    fixtureDir,
    outputDir: outDir,
    semanticGateMode: 'fixture_oracle',
  });
  const fde = report.modeScores.fde;

  const falsePositiveIds = report.results
    .filter((result) => result.modeTemplateType === 'fde' && !result.shouldEmit && result.emitted)
    .map((result) => result.fixtureId);
  for (const fixtureId of falsePositiveIds) {
    assert.ok(
      FDE_FALSE_POSITIVE_ROOT_CAUSES.some((item) => item.fixtureId === fixtureId),
      `Missing FDE false-positive root cause for ${fixtureId}`,
    );
  }

  assert.ok(fde.recallRate > 0.75, `FDE recall too low: ${fde.recallRate}`);
  assert.ok(fde.falsePositiveRate < 0.10, `FDE false positive too high: ${fde.falsePositiveRate}`);
  assert.deepEqual(fde.answerQualityFailures, []);
  assert.deepEqual(fde.groundingFailures, []);
  assert.deepEqual(fde.missingFieldFailures, []);
});
