import 'dotenv/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const helperPath = path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js');
const enginePath = path.resolve(repoRoot, 'dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(repoRoot, 'dist-electron/electron/SessionTracker.js');

const QCLOUD_KEY = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
const EXPECTED_STAGES = [
  'provider_queue_complete',
  'provider_first_byte',
  'provider_response_complete',
  'complete_json',
  'card_emitted',
];

test('live QCLOUD dynamic action reports queue through card emit latency', {
  timeout: 15_000,
}, async () => {
  assert.ok(
    QCLOUD_KEY,
    'Set QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY to run the live dynamic action latency test.',
  );

  const [{ LLMHelper }, { IntelligenceEngine }, { SessionTracker }] = await Promise.all([
    import(pathToFileURL(helperPath).href),
    import(pathToFileURL(enginePath).href),
    import(pathToFileURL(sessionPath).href),
  ]);
  const helper = new LLMHelper();
  helper.setNativelyKey(QCLOUD_KEY);
  helper.setModel('natively');

  const engine = new IntelligenceEngine(helper, new SessionTracker());
  engine._setIntentClassificationOptionsForTest({
    cloudFirst: false,
    localIntentEnhancementEnabled: false,
    localIntentEnhancementAvailable: false,
  });
  engine.setDynamicActionContext({
    sessionId: `latency-live-${Date.now()}`,
    modeId: 'sales',
    modeTemplateType: 'sales',
  });

  const traces = [];
  const availability = [];
  const startedAt = performance.now();
  engine.on('dynamic_action_latency_trace', trace => traces.push(trace));

  const emittedAction = new Promise((resolve, reject) => {
    const rejectUnavailable = (statuses) => {
      availability.push(...statuses);
      if (!statuses.includes('cloud_unavailable')) return;
      clearTimeout(timeout);
      reject(new Error(JSON.stringify({
        message: 'Dynamic action gate became unavailable before card emit',
        elapsedMs: Math.round(performance.now() - startedAt),
        stages: traces.map(trace => trace.stage),
        availability,
      })));
    };
    const timeout = setTimeout(() => {
      engine.off('dynamic_action_gate_availability', rejectUnavailable);
      reject(new Error(JSON.stringify({
        message: 'Timed out waiting for dynamic action card emit',
        elapsedMs: Math.round(performance.now() - startedAt),
        stages: traces.map(trace => trace.stage),
        availability,
      })));
    }, 10_000);
    engine.on('dynamic_action_gate_availability', rejectUnavailable);
    engine.once('dynamic_action_emitted', action => {
      clearTimeout(timeout);
      engine.off('dynamic_action_gate_availability', rejectUnavailable);
      resolve(action);
    });
  });

  engine.handleTranscript({
    speaker: 'interviewer',
    text: '这个价格太高了，我们的预算完全不够，必须降低报价才能继续推进。',
    timestamp: Date.now(),
    final: true,
  }, true);

  const action = await emittedAction;
  assert.equal(action.type, 'pricing_objection');

  const stages = traces.map(trace => trace.stage);
  assert.deepEqual(stages, EXPECTED_STAGES);
  assert.equal(new Set(traces.map(trace => trace.requestId)).size, 1);
  assert.ok(
    traces.every((trace, index) => index === 0 || trace.elapsedMs >= traces[index - 1].elapsedMs),
    'latency stages must be monotonic',
  );

  const firstByte = traces.find(trace => trace.stage === 'provider_first_byte');
  assert.equal(firstByte.provider, 'qcloud');
  assert.equal(firstByte.measurement, 'network_body_chunk');
  assert.ok(Number.isFinite(firstByte.durationMs));

  console.log(JSON.stringify({
    provider: firstByte.provider,
    actionType: action.type,
    stages: traces.map(trace => ({
      stage: trace.stage,
      elapsedMs: trace.elapsedMs,
      durationMs: trace.durationMs,
      measurement: trace.measurement,
    })),
  }, null, 2));
});
