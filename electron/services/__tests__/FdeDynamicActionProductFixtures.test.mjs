import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const enginePath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
const scoringPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionProductFixtures.js');

async function load() {
  return {
    ...(await import(pathToFileURL(enginePath).href)),
    ...(await import(pathToFileURL(scoringPath).href)),
  };
}

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

