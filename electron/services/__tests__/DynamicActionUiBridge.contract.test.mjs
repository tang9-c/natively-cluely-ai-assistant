import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadIntelligenceEngine() {
  return import(pathToFileURL(path.join(root, 'dist-electron/electron/IntelligenceEngine.js')).href);
}

async function loadSessionTracker() {
  return import(pathToFileURL(path.join(root, 'dist-electron/electron/SessionTracker.js')).href);
}

class StubLLMHelper {
  constructor() {
    this.structuredCalls = [];
  }
  getActiveModel() { return { provider: 'qcloud', model: 'lite32k' }; }
  getCurrentModelExecutionKind() { return 'cloud'; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler() {}
  getGeminiClient() { return null; }
  getOpenAIClient() { return null; }
  getClaudeClient() { return null; }
  getGroqClient() { return null; }
  getOllamaClient() { return null; }
  getModesManager() { return { getActiveMode: () => null, getActiveModeSystemPromptSuffix: () => '' }; }
  getSettingsManager() { return { get: () => null, set: () => {} }; }
  async generateContentStructured(prompt, options) {
    this.structuredCalls.push({ prompt, options });
    if (prompt.includes('candidates:')) {
      const candidatesJson = prompt.match(/^candidates: (.+)$/m)?.[1];
      const candidates = candidatesJson ? JSON.parse(candidatesJson) : [];
      return JSON.stringify({
        actions: candidates.map((candidate) => ({
          actionType: candidate.actionType,
          decision: candidate.actionType === 'discovery_question' ? 'pass' : 'reject',
          confidence: candidate.actionType === 'discovery_question' ? 0.8845 : 0.5,
          semanticIntent: candidate.actionType === 'discovery_question' ? 'sales_pain_discovery' : candidate.actionType,
          reasons: ['test_cloud_gate_passed_sales_discovery'],
          rejectedCandidates: candidate.actionType === 'discovery_question' ? [] : [candidate.actionType],
        })),
      });
    }
    return '{"intent":"sales_pain_discovery","confidence":0.88}';
  }
}

async function makeEngine() {
  const { IntelligenceEngine } = await loadIntelligenceEngine();
  const { SessionTracker } = await loadSessionTracker();
  const helper = new StubLLMHelper();
  const engine = new IntelligenceEngine(helper, new SessionTracker());
  engine._setIntentClassificationOptionsForTest({
    localIntentEnhancementEnabled: false,
    localIntentEnhancementAvailable: false,
    providerDataScopes: { transcript: true },
    cloudIntentClassifier: async () => ({ intent: 'sales_pain_discovery', confidence: 0.88 }),
  });
  engine.runSkillWatcher = async () => {};
  return { engine, helper };
}

const waitForAsyncSignals = () => new Promise((resolve) => setTimeout(resolve, 80));

class FakeIpcRenderer extends EventEmitter {
  sendFromMain(channel, data) {
    this.emit(channel, { sender: 'main' }, data);
  }
}

function subscribeLikePreload(ipcRenderer, callback) {
  const subscription = (_event, data) => callback(data);
  ipcRenderer.on('intelligence-dynamic-action', subscription);
  return () => ipcRenderer.removeListener('intelligence-dynamic-action', subscription);
}

function makeWindowHelper(ipcRenderer) {
  const sends = [];
  const makeWindow = (name) => ({
    webContents: {
      send(channel, data) {
        sends.push({ window: name, channel, data });
        ipcRenderer.sendFromMain(channel, data);
      },
    },
  });
  return {
    sends,
    getLauncherWindow: () => makeWindow('launcher'),
    getOverlayWindow: () => makeWindow('overlay'),
  };
}

function bindMainDynamicActionForwarding(intelligenceManager, windowHelper) {
  intelligenceManager.on('dynamic_action_emitted', (action) => {
    const shownAction = intelligenceManager.markDynamicActionShown(action.id) ?? action;
    windowHelper.getLauncherWindow()?.webContents.send('intelligence-dynamic-action', { action: shownAction });
    windowHelper.getOverlayWindow()?.webContents.send('intelligence-dynamic-action', { action: shownAction });
  });
}

test('sales discovery transcript reaches main forwarding and renderer dynamic action subscription', async () => {
  const { engine, helper } = await makeEngine();
  const ipcRenderer = new FakeIpcRenderer();
  const windowHelper = makeWindowHelper(ipcRenderer);
  const rendererActions = [];
  const unsubscribe = subscribeLikePreload(ipcRenderer, (data) => {
    if (data?.action) rendererActions.push(data.action);
  });

  bindMainDynamicActionForwarding(engine, windowHelper);
  engine.setDynamicActionContext({
    sessionId: 'session-sales-ui-bridge',
    modeId: 'mode-sales',
    modeTemplateType: 'sales',
  });

  engine.handleTranscript({
    speaker: 'interviewer',
    text: '我们 PLM 发布 BOM 之后,靠邮件通知下游,经常不同步,设计变更下去了采购还在用旧版本。',
    timestamp: Date.now(),
    final: true,
  }, true);
  await waitForAsyncSignals();
  unsubscribe();

  assert.ok(
    helper.structuredCalls.some((call) => call.options?.taskLabel === 'dynamic-action-semantic-gate'),
    'expected dynamic action cloud gate to run before UI forwarding',
  );
  assert.equal(windowHelper.sends.length, 2, 'main should forward the card to launcher and overlay');
  assert.deepEqual(
    windowHelper.sends.map((item) => [item.window, item.channel]),
    [
      ['launcher', 'intelligence-dynamic-action'],
      ['overlay', 'intelligence-dynamic-action'],
    ],
  );
  assert.equal(rendererActions.length, 2, 'renderer subscription should receive both forwarded window events');

  const action = rendererActions[0];
  assert.equal(action.type, 'discovery_question');
  assert.equal(action.status, 'shown');
  assert.equal(action.sourceIntent, 'sales_pain_discovery');
  assert.equal(action.modeTemplateType, 'sales');
  assert.equal(action.latestTurn, '我们 PLM 发布 BOM 之后,靠邮件通知下游,经常不同步,设计变更下去了采购还在用旧版本。');
  assert.equal(action.semanticGate?.decision, 'pass');
  assert.equal(action.semanticGate?.arbitrationStatus, 'cloud_used');
  assert.equal(action.productContract?.userAction, '追问关键问题');
});

test('DynamicActionBar is wired to the preload dynamic action subscription and renders cards', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/dynamic-actions/DynamicActionBar.tsx'), 'utf8');

  assert.match(source, /onIntelligenceDynamicAction/);
  assert.match(source, /handleIncoming\(data\.action\)/);
  assert.match(source, /<DynamicActionCard/);
  assert.match(source, /data-testid="dynamic-action-bar"/);
});
