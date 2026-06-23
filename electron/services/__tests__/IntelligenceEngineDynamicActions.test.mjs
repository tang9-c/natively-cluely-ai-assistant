// Phase 3 — verify the wiring between IntelligenceEngine.handleTranscript and
// DynamicActionEngine. Asserts that:
//   1. setDynamicActionContext binds session/mode and engine starts detecting.
//   2. final transcript emits dynamic_action_emitted with a real DynamicAction payload.
//   3. interim (non-final) transcript does NOT emit anything.
//   4. clearDynamicActionContext stops emissions.
//   5. switching session id resets the per-session store (no bleeding).
//   6. accept/dismiss API delegates correctly.
//
// We import compiled JS from dist-electron so the test exercises the same code
// path the Electron main process runs in production.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadIntelligenceEngine() {
  const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
  return import(pathToFileURL(enginePath).href);
}

async function loadSessionTracker() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(sessionPath).href);
}

// Minimal LLMHelper stub — engine touches getActiveModel, isStreamingSupported,
// and setNegotiationCoachingHandler in its constructor / initializeLLMs path.
// Other LLM methods are unused because we only invoke handleTranscript.
class StubLLMHelper {
  constructor(options = {}) {
    this.structuredResponses = options.structuredResponses ?? [];
    this.structuredCalls = [];
    this.throwStructured = options.throwStructured ?? false;
  }
  getActiveModel() { return { provider: 'gemini', model: 'gemini-3-flash' }; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler(_fn) { /* no-op for test */ }
  async generateContentStructured(prompt, options) {
    this.structuredCalls.push({ prompt, options });
    if (this.throwStructured) throw new Error('cloud down');
    return this.structuredResponses.shift() ?? '{"intent":"general","confidence":0.5}';
  }
  // Other methods that may be referenced during initializeLLMs():
  getGeminiClient() { return null; }
  getOpenAIClient() { return null; }
  getClaudeClient() { return null; }
  getGroqClient() { return null; }
  getOllamaClient() { return null; }
  getModesManager() { return { getActiveMode: () => null, getActiveModeSystemPromptSuffix: () => '' }; }
  getSettingsManager() { return { get: () => null, set: () => {} }; }
}

async function makeEngine(helper = new StubLLMHelper()) {
  const { IntelligenceEngine } = await loadIntelligenceEngine();
  const { SessionTracker } = await loadSessionTracker();
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(helper, session);
  return { engine, session, helper };
}

const waitForAsyncSignals = () => new Promise(resolve => setTimeout(resolve, 30));

describe('IntelligenceEngine — dynamic action wiring (Phase 3)', () => {
  test('handleTranscript emits dynamic_action_emitted for matching trigger pack', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));

    engine.setDynamicActionContext({
      sessionId: 'sess-1',
      modeId: 'mode-sales',
      modeTemplateType: 'sales', // matches SALES_TRIGGERS pack in DynamicActionDetector
    });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'Honestly, this product is too expensive for my team',
      timestamp: Date.now(),
      final: true,
    }, /* skipRefinementCheck */ true);
    await waitForAsyncSignals();

    assert.ok(emitted.length >= 1, `expected ≥1 emitted action, got ${emitted.length}`);
    const pricing = emitted.find(a => a.type === 'pricing_objection');
    assert.ok(pricing, 'expected a pricing_objection action');
    assert.equal(pricing.modeId, 'mode-sales');
    assert.equal(pricing.sessionId, 'sess-1');
    assert.equal(pricing.modeTemplateType, 'sales');
    assert.equal(pricing.status, 'candidate');
    assert.ok(Array.isArray(pricing.evidenceRefs) && pricing.evidenceRefs.length === 1);
    assert.equal(pricing.evidenceRefs[0].source, 'transcript');
  });

  test('repeated high-confidence Chinese dynamic action auto-triggers What Should I Say with prompt instruction', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"intent":"handle_objection","confidence":0.92}',
        '{"intent":"handle_objection","confidence":0.94}',
      ],
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    const autoRuns = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.runWhatShouldISay = async (...args) => {
      autoRuns.push(args);
      return 'auto-answer';
    };

    engine.setDynamicActionContext({
      sessionId: 'sess-auto',
      modeId: 'mode-sales',
      modeTemplateType: 'sales',
    });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '这个价格太高了, 老板可能不会批',
      timestamp: Date.now(),
      final: true,
      emotion: 'angry',
      emotionSource: 'sensevoice',
    }, true);
    await waitForAsyncSignals();

    assert.ok(emitted.length >= 1, 'first high-confidence evidence should emit a UI card');
    assert.equal(autoRuns.length, 0, 'ordinary objection should not auto-trigger on first evidence');

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '我们老板肯定也会觉得报价太高',
      timestamp: Date.now() + 100,
      final: true,
      emotion: 'angry',
      emotionSource: 'sensevoice',
    }, true);
    await waitForAsyncSignals();

    assert.ok(emitted.length >= 1, 'dynamic action should still be emitted for UI state');
    const autoAction = emitted.find(a => a.type === 'pricing_objection' && a.autoSurfacePolicy === 'auto');
    assert.ok(autoAction, 'expected pricing_objection action');
    assert.equal(autoAction.autoSurfacePolicy, 'auto');
    assert.equal(autoAction.autoTriggerEligible, true);
    assert.ok(autoAction.promptInstruction.includes('Sales mode'));
    assert.equal(autoRuns.length, 1, 'high-confidence final action should auto-trigger main answer flow');
    assert.equal(autoRuns[0][0], undefined, 'auto-trigger should use transcript context, not a synthetic question');
    assert.equal(autoRuns[0][1], autoAction.confidence);
    assert.equal(autoRuns[0][2], undefined);
    assert.equal(autoRuns[0][3].skipCooldown, true);
    assert.equal(autoRuns[0][3].promptInstruction, autoAction.promptInstruction);
    assert.equal(autoRuns[0][3].modeEvent.intent, 'pricing_objection');
    assert.equal(autoRuns[0][3].modeEvent.modeTemplateType, 'sales');
    assert.equal(autoRuns[0][3].modeEvent.emotion, 'angry');
    assert.match(autoRuns[0][3].modeEvent.latestTurn, /价格太高|报价太高/);
  });

  test('same high-confidence dynamic action evidence auto-triggers main answer only once', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"intent":"handle_objection","confidence":0.92}',
        '{"intent":"handle_objection","confidence":0.94}',
        '{"intent":"handle_objection","confidence":0.94}',
      ],
    });
    const { engine } = await makeEngine(helper);
    const autoRuns = [];
    engine.runWhatShouldISay = async (...args) => {
      autoRuns.push(args);
      return 'auto-answer';
    };

    engine.setDynamicActionContext({
      sessionId: 'sess-auto-dedupe',
      modeId: 'mode-sales',
      modeTemplateType: 'sales',
    });

    const segment = {
      speaker: 'interviewer',
      text: '这个价格太高了, 老板可能不会批',
      timestamp: Date.now(),
      final: true,
    };

    engine.handleTranscript(segment, true);
    engine.handleTranscript({ ...segment, timestamp: segment.timestamp + 100 }, true);
    await waitForAsyncSignals();

    assert.equal(autoRuns.length, 1);
  });

  test('active dynamic action suppresses duplicate suggestion-trigger answer for same sales intent', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"intent":"handle_objection","confidence":0.92}',
        '{"intent":"handle_objection","confidence":0.92}',
      ],
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    const answerRuns = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.runWhatShouldISay = async (...args) => {
      answerRuns.push(args);
      return 'duplicate-answer';
    };

    engine.setDynamicActionContext({
      sessionId: 'sess-suppress',
      modeId: 'mode-sales',
      modeTemplateType: 'sales',
    });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '这个价格太高了, 我们预算不够',
      timestamp: Date.now(),
      final: true,
      emotion: 'angry',
      emotionSource: 'sensevoice',
    }, true);
    await waitForAsyncSignals();

    const pricing = emitted.find(a => a.type === 'pricing_objection');
    assert.ok(pricing, 'expected dynamic action card for pricing objection');

    await engine.handleSuggestionTrigger({
      lastQuestion: '这个价格太高了, 我们预算不够',
      confidence: 0.92,
    });

    assert.equal(answerRuns.length, 0, 'planner should not emit a duplicate answer when a matching dynamic action is active');
  });

  test('final Chinese transcript uses cloud-first intent confirmation for dynamic actions', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: ['{"intent":"seize_signal","confidence":0.96}'],
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-cloud', modeId: 'm-sales', modeTemplateType: 'sales' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '我们想进入下一步, 让法务看一下合同',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    assert.ok(helper.structuredCalls.length >= 1);
    const action = emitted.find(a => a.type === 'buying_signal');
    assert.ok(action, `expected buying_signal; got ${emitted.map(a => a.type).join(', ')}`);
    assert.equal(action.confirmedIntent, 'seize_signal');
    assert.equal(action.confirmationSource, 'cloud_intent');
  });

  test('transcript scope disabled skips cloud intent confirmation', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: ['{"intent":"seize_signal","confidence":0.96}'],
    });
    const { engine } = await makeEngine(helper);
    engine._setIntentClassificationOptionsForTest({
      providerDataScopes: { transcript: false },
      cloudIntentClassifier: async () => ({ intent: 'seize_signal', confidence: 0.96 }),
    });
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-scope', modeId: 'm-sales', modeTemplateType: 'sales' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '我们想进入下一步, 让法务看一下合同',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    assert.equal(helper.structuredCalls.length, 0);
    assert.ok(emitted.some(a => a.type === 'buying_signal'), 'rules should still emit when cloud is blocked');
  });

  test('cloud classifier failure never breaks final transcript handling', async () => {
    const helper = new StubLLMHelper({ throwStructured: true });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-fail', modeId: 'm-sales', modeTemplateType: 'sales' });

    assert.doesNotThrow(() => {
      engine.handleTranscript({
        speaker: 'interviewer',
        text: '这个价格太高了',
        timestamp: Date.now(),
        final: true,
      }, true);
    });
    await waitForAsyncSignals();

    assert.ok(emitted.some(a => a.type === 'pricing_objection'), 'rule fallback should still emit after cloud failure');
  });

  test('non-final transcript does not emit dynamic actions', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.setDynamicActionContext({ sessionId: 's', modeId: 'm', modeTemplateType: 'sales' });
    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'too expensive',
      timestamp: Date.now(),
      final: false,
    }, true);
    await waitForAsyncSignals();
    assert.equal(emitted.length, 0, 'interim transcripts must not emit dynamic actions');
  });

  test('without setDynamicActionContext nothing is emitted (safe default)', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'too expensive',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();
    assert.equal(emitted.length, 0, 'engine must be a no-op until setDynamicActionContext is called');
  });

  test('clearDynamicActionContext stops further emissions', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.setDynamicActionContext({ sessionId: 's1', modeId: 'm', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'this is too expensive', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    const beforeClear = emitted.length;
    assert.ok(beforeClear >= 1);
    engine.clearDynamicActionContext();
    engine.handleTranscript({ speaker: 'interviewer', text: 'this is also too expensive', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    assert.equal(emitted.length, beforeClear, 'no new emissions after context cleared');
  });

  test('changing sessionId flushes per-session store (no cross-meeting bleed)', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));

    engine.setDynamicActionContext({ sessionId: 's-A', modeId: 'm1', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    const aCount = emitted.length;
    assert.ok(aCount >= 1, 'first session should emit');

    // Same trigger phrase in a fresh session must emit again — proving the
    // store was flushed (otherwise dedup would suppress it).
    engine.setDynamicActionContext({ sessionId: 's-B', modeId: 'm1', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    assert.ok(emitted.length > aCount, 'second session must produce a fresh action even with identical phrase');
    const last = emitted[emitted.length - 1];
    assert.equal(last.sessionId, 's-B');
  });

  test('detect failure inside DynamicActionEngine never breaks transcript path', async () => {
    const { engine } = await makeEngine();
    // Inject a broken engine that throws on detectActions.
    engine._setDynamicActionEngineForTest({
      assessSignals: () => { throw new Error('boom'); },
      detectActions: () => { throw new Error('boom'); },
      acceptAction: () => null,
      dismissAction: () => {},
      getTopActions: () => [],
    });
    engine.setDynamicActionContext({ sessionId: 's', modeId: 'm', modeTemplateType: 'sales' });

    // Should not throw — the catch in handleTranscript is the safety net.
    assert.doesNotThrow(() => {
      engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    });
    await waitForAsyncSignals();
  });

  test('acceptDynamicAction / dismissDynamicAction delegate correctly', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));
    engine.setDynamicActionContext({ sessionId: 's', modeId: 'm', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: 'too expensive', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    assert.ok(emitted.length >= 1);
    const action = emitted[0];

    // accept should return the action with status flipped to 'accepted'.
    // (The store keeps accepted actions visible until completed/dismissed —
    // the renderer can show a brief "running…" state on the accepted card.)
    const accepted = engine.acceptDynamicAction(action.id);
    assert.ok(accepted, 'acceptDynamicAction returns the action');
    assert.equal(accepted.id, action.id);
    const afterAccept = engine.getActiveDynamicActions().find(a => a.id === action.id);
    assert.ok(afterAccept, 'accepted action is still listed (renderer can show a "running" indicator)');
    assert.equal(afterAccept.status, 'accepted');

    // dismiss should remove from active list.
    engine.dismissDynamicAction(action.id);
    const afterDismiss = engine.getActiveDynamicActions().find(a => a.id === action.id);
    assert.equal(afterDismiss, undefined, 'dismissed action no longer in active list');

    // dismiss is a no-op for unknown id and must not throw.
    assert.doesNotThrow(() => engine.dismissDynamicAction('does-not-exist'));
  });

  test('acceptDynamicAction returns null when no engine bound', async () => {
    const { engine } = await makeEngine();
    assert.equal(engine.acceptDynamicAction('any'), null);
  });
});
