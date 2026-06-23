import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const trackerPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/SignalStateTracker.js');

async function loadTracker() {
  return import(pathToFileURL(trackerPath).href);
}

function signal(overrides = {}) {
  return {
    sessionId: 'session_zh',
    modeTemplateType: 'sales',
    signalType: 'pricing_objection',
    confidence: 0.62,
    latestTurn: '这个价格还是有点高',
    emotion: undefined,
    confirmationSource: 'cloud_intent',
    evidenceRef: {
      source: 'transcript',
      text: '这个价格还是有点高',
      timestamp: 1_000,
      speaker: 'interviewer',
    },
    now: 1_000,
    ...overrides,
  };
}

test('single low-confidence Chinese signal stays internal and does not surface', async () => {
  const { SignalStateTracker } = await loadTracker();
  const tracker = new SignalStateTracker();

  const result = tracker.assess(signal({ confidence: 0.62 }));

  assert.equal(result.state.status, 'candidate');
  assert.equal(result.shouldStoreAction, false);
  assert.equal(result.autoSurfaceEligible, false);
  assert.equal(result.state.evidenceRefs.length, 1);
});

test('repeated same Chinese signal is smoothed into confirmed state', async () => {
  const { SignalStateTracker } = await loadTracker();
  const tracker = new SignalStateTracker();

  tracker.assess(signal({ confidence: 0.72, now: 1_000 }));
  const result = tracker.assess(signal({
    confidence: 0.76,
    latestTurn: '对我们团队来说这个报价太高了',
    evidenceRef: { source: 'transcript', text: '对我们团队来说这个报价太高了', timestamp: 20_000, speaker: 'interviewer' },
    now: 20_000,
  }));

  assert.equal(result.state.status, 'confirmed');
  assert.equal(result.shouldStoreAction, true);
  assert.ok(result.state.confidence >= 0.75);
  assert.equal(result.state.evidenceRefs.length, 2);
});

test('dismissed signal enters cooldown and suppresses surfacing', async () => {
  const { SignalStateTracker } = await loadTracker();
  const tracker = new SignalStateTracker();

  tracker.dismiss('session_zh', 'sales', 'pricing_objection', 5_000);
  const result = tracker.assess(signal({ confidence: 0.95, now: 10_000 }));

  assert.equal(result.state.status, 'cooling_down');
  assert.equal(result.shouldStoreAction, false);
  assert.equal(result.autoSurfaceEligible, false);
});

test('signal expires after inactivity window', async () => {
  const { SignalStateTracker } = await loadTracker();
  const tracker = new SignalStateTracker();

  tracker.assess(signal({ confidence: 0.8, now: 1_000 }));
  tracker.expire(100_000);
  const state = tracker.getState('session_zh', 'sales', 'pricing_objection');

  assert.equal(state?.status, 'expired');
});

test('emotion alone cannot create a surfaceable signal', async () => {
  const { SignalStateTracker } = await loadTracker();
  const tracker = new SignalStateTracker();

  const result = tracker.assess(signal({
    signalType: 'ambient_emotion',
    confidence: 0.1,
    latestTurn: '嗯',
    emotion: 'angry',
    confirmationSource: 'heuristic',
    evidenceRef: { source: 'transcript', text: '嗯', timestamp: 1_000, speaker: 'interviewer' },
  }));

  assert.equal(result.shouldStoreAction, false);
  assert.equal(result.autoSurfaceEligible, false);
});
