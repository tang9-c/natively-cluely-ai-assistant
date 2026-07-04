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

const waitForAsyncSignals = () => new Promise(resolve => setTimeout(resolve, 80));

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
      text: '这个价格太高了，我们预算不够',
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
    assert.ok(pricing.evidenceRefs[0].text.includes('价格'));
  });

  test('repeated high-confidence Chinese dynamic action emits auto card without direct What Should I Say run', async () => {
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
    assert.equal(autoRuns.length, 0, 'renderer countdown should trigger answer flow, not main process auto-run');
  });

  test('same high-confidence dynamic action evidence does not direct-run main answer repeatedly', async () => {
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

    assert.equal(autoRuns.length, 0);
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

  test('dynamic action assessment receives compact recent context and provider scope', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: ['{"intent":"general","confidence":0.5}'],
    });
    const { engine } = await makeEngine(helper);
    const calls = [];
    engine.setDynamicActionContext({ sessionId: 's-gate-context', modeId: 'm-sales', modeTemplateType: 'sales' });
    engine._setIntentClassificationOptionsForTest({
      providerDataScopes: { transcript: true },
    });
    engine._setDynamicActionEngineForTest({
      assessSignals: async input => {
        calls.push(input);
        return [];
      },
      detectActions: () => [],
      acceptAction: () => null,
      dismissAction: () => {},
      getTopActions: () => [],
    });

    const base = Date.now();
    const segments = [
      { speaker: 'interviewer', speakerId: 's-1', speakerLabel: 'Alex', text: 'First context turn.', timestamp: base + 1, final: true },
      { speaker: 'user', speakerId: 's-me', speakerLabel: 'Me', text: 'Second context turn.', timestamp: base + 2, final: true },
      { speaker: 'interviewer', speakerId: 's-2', speakerLabel: 'Priya', text: 'Third context turn.', timestamp: base + 3, final: true },
      { speaker: 'interviewer', speakerId: 's-3', speakerLabel: 'Sam', text: 'Fourth context turn.', timestamp: base + 4, final: true },
      { speaker: 'interviewer', speakerId: 's-4', speakerLabel: 'Mei', text: 'Fifth context turn.', timestamp: base + 5, final: true },
      { speaker: 'interviewer', speakerId: 's-5', speakerLabel: 'Jordan', text: 'Sixth context turn.', timestamp: base + 6, final: true },
      { speaker: 'interviewer', speakerId: 's-6', speakerLabel: 'Taylor', text: 'Seventh context turn asks for pricing page.', timestamp: base + 7, final: true },
    ];

    for (const segment of segments) {
      engine.handleTranscript(segment, true);
    }
    await waitForAsyncSignals();

    const lastCall = calls.at(-1);
    assert.ok(lastCall, 'expected dynamic action engine to be called');
    assert.equal(lastCall.providerDataScopes.transcript, true);
    assert.equal(lastCall.recentContextTurns.length, 6);
    assert.equal(lastCall.recentContextTurns[0].speaker, 'Me');
    assert.equal(lastCall.recentContextTurns.at(-1).text, 'Seventh context turn asks for pricing page.');
    assert.equal(typeof lastCall.cloudClassifier, 'function');
  });

  test('dynamic action semantic gate uses structured cloud arbitration for English high-risk actions', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"actions":[{"actionType":"case_study_request","decision":"pass","confidence":0.93,"semanticIntent":"case_or_proof_request","reasons":["cloud_confirmed_case"],"rejectedCandidates":[]},{"actionType":"pricing_request","decision":"reject","confidence":0.88,"semanticIntent":"neutral_pricing_reference","reasons":["pricing_page_is_context"],"rejectedCandidates":["pricing_request"]}]}',
      ],
    });
    const { engine } = await makeEngine(helper);
    engine.setDynamicActionContext({ sessionId: 's-gate-cloud', modeId: 'm-sales', modeTemplateType: 'sales' });
    const gateResults = [];
    engine._setDynamicActionEngineForTest({
      assessSignals: async input => {
        const result = await input.cloudClassifier({
          transcript: input.transcript,
          recentContextTurns: input.recentContextTurns,
          modeTemplateType: input.modeTemplateType,
          speaker: input.speaker,
          intentResult: input.intentResult,
          candidates: [
            {
              actionType: 'case_study_request',
              label: 'Share relevant case study',
              match: 'similar customer case',
              confidence: 0.87,
              highRisk: true,
              fastPathEligible: false,
            },
            {
              actionType: 'pricing_request',
              label: 'Draft quote email',
              match: 'pricing page',
              confidence: 0.86,
              highRisk: true,
              fastPathEligible: false,
            },
          ],
        });
        gateResults.push(result);
        return [];
      },
      detectActions: () => [],
      acceptAction: () => null,
      dismissAction: () => {},
      getTopActions: () => [],
    });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'We need a similar customer case, not the pricing page.',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    const gateCall = helper.structuredCalls.find(call => call.options?.taskLabel === 'dynamic-action-semantic-gate');
    assert.ok(gateCall, 'expected dynamic action semantic gate structured call');
    assert.match(gateCall.prompt, /case_study_request/);
    assert.match(gateCall.prompt, /pricing_request/);
    assert.deepEqual(gateResults[0]?.map(item => [item.actionType, item.decision]), [
      ['case_study_request', 'pass'],
      ['pricing_request', 'reject'],
    ]);
  });

  test('cloud intent prompt keeps triggering turn and speaker-diverse meeting context', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: ['{"intent":"fde_next_step","confidence":0.96}'],
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-speakers', modeId: 'm-fde', modeTemplateType: 'fde' });

    const base = Date.now();
    const segments = [
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan opened with pricing context for the rollout.', timestamp: base + 1, final: true },
      { speaker: 'interviewer', speakerId: 's-priya', speakerLabel: 'Priya', text: 'Priya described the security review requirements.', timestamp: base + 2, final: true },
      { speaker: 'interviewer', speakerId: 's-mei', speakerLabel: 'Mei', text: 'Mei raised integration ownership and API constraints.', timestamp: base + 3, final: true },
      { speaker: 'interviewer', speakerId: 's-sam', speakerLabel: 'Sam', text: 'Sam explained support readiness and customer risk.', timestamp: base + 4, final: true },
      { speaker: 'user', speakerId: 's-me', speakerLabel: 'Me', text: 'I can coordinate the rollout plan with product and engineering.', timestamp: base + 5, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan added another pricing detail for enterprise customers.', timestamp: base + 6, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan repeated budget sensitivity for this account.', timestamp: base + 7, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan mentioned implementation timing after approval.', timestamp: base + 8, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan asked whether discount approval can happen this week.', timestamp: base + 9, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan wants a clear decision owner before Friday.', timestamp: base + 10, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan asked for a risk mitigation plan for launch.', timestamp: base + 11, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: 'Jordan requested a concrete next step for legal and security.', timestamp: base + 12, final: true },
      { speaker: 'interviewer', speakerId: 's-jordan', speakerLabel: 'Jordan', text: '下一步需要负责人，明天前确认上线计划。', timestamp: base + 13, final: true },
    ];

    for (const segment of segments) {
      engine.handleTranscript(segment, true);
    }
    await waitForAsyncSignals();

    assert.ok(helper.structuredCalls.length >= 1);
    const lastPrompt = helper.structuredCalls.at(-1).prompt;
    assert.match(lastPrompt, /\[INTERVIEWER: Jordan\]: 下一步需要负责人，明天前确认上线计划。/);
    assert.match(lastPrompt, /\[INTERVIEWER: Priya\]: priya described the security review requirements\./);
    assert.match(lastPrompt, /\[INTERVIEWER: Mei\]: mei raised integration ownership and api constraints\./);
    assert.match(lastPrompt, /\[INTERVIEWER: Sam\]: sam explained support readiness and customer risk\./);
    assert.match(lastPrompt, /\[ME\]: i can coordinate the rollout plan with product and engineering\./);
    assert.ok(emitted.some(a => a.type === 'fde_next_step'), 'FDE dynamic action should still emit from confirmed cloud intent');
  });

  test('transcript scope disabled skips cloud intent confirmation and high-risk emission', async () => {
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
    assert.equal(emitted.length, 0, 'high-risk dynamic actions should not emit when transcript scope is denied');
  });

  test('final transcript emits semantic gate trace for deferred high-risk action', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: ['{"intent":"seize_signal","confidence":0.96}'],
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    const gateTraces = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.on('dynamic_action_gate_trace', (trace) => gateTraces.push(trace));
    engine._setIntentClassificationOptionsForTest({
      providerDataScopes: { transcript: false },
      cloudIntentClassifier: async () => ({ intent: 'seize_signal', confidence: 0.96 }),
    });
    engine.setDynamicActionContext({ sessionId: 's-gate-trace', modeId: 'm-sales', modeTemplateType: 'sales' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '我们想进入下一步, 让法务看一下合同',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    assert.equal(emitted.length, 0);
    const buyingTrace = gateTraces.find(trace => trace.actionType === 'buying_signal');
    assert.ok(buyingTrace, `expected buying_signal gate trace; got ${gateTraces.map(trace => trace.actionType).join(', ')}`);
    assert.equal(buyingTrace.decision, 'defer');
    assert.equal(buyingTrace.degradedReason, 'provider_scope_denied');
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

  test('final Chinese quote request emits pricing_request dynamic action', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-pricing-request', modeId: 'm-sales', modeTemplateType: 'sales' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '给客户发一版报价',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    const action = emitted.find(item => item.type === 'pricing_request');
    assert.ok(action, `expected pricing_request; got ${emitted.map(item => item.type).join(', ')}`);
    assert.equal(action.answerStyle?.format, 'email');
    assert.equal(action.semanticGate?.decision, 'pass');
  });

  test('final Chinese case request emits case_study_request dynamic action', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-case-request', modeId: 'm-sales', modeTemplateType: 'sales' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '客户要证明材料和类似客户案例',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    const action = emitted.find(item => item.type === 'case_study_request');
    assert.ok(action, `expected case_study_request; got ${emitted.map(item => item.type).join(', ')}`);
    assert.equal(action.semanticGate?.decision, 'pass');
  });

  test('final English price objection emits when dynamic action cloud gate fails', async () => {
    const helper = new StubLLMHelper({ throwStructured: true });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-english-cloud-fail', modeId: 'm-sales', modeTemplateType: 'sales' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'This is too expensive for our budget.',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    const action = emitted.find(item => item.type === 'pricing_objection');
    assert.ok(action, `expected pricing_objection; got ${emitted.map(item => item.type).join(', ')}`);
    assert.equal(action.semanticGate?.decision, 'pass');
    assert.equal(action.semanticGate?.semanticProvider, 'local_intent');
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
    engine.handleTranscript({ speaker: 'interviewer', text: '这个价格太高了', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    const beforeClear = emitted.length;
    assert.ok(beforeClear >= 1);
    engine.clearDynamicActionContext();
    engine.handleTranscript({ speaker: 'interviewer', text: '这个报价太高了', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    assert.equal(emitted.length, beforeClear, 'no new emissions after context cleared');
  });

  test('changing sessionId flushes per-session store (no cross-meeting bleed)', async () => {
    const { engine } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (a) => emitted.push(a));

    engine.setDynamicActionContext({ sessionId: 's-A', modeId: 'm1', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: '这个价格太高了', timestamp: Date.now(), final: true }, true);
    await waitForAsyncSignals();
    const aCount = emitted.length;
    assert.ok(aCount >= 1, 'first session should emit');

    // Same trigger phrase in a fresh session must emit again — proving the
    // store was flushed (otherwise dedup would suppress it).
    engine.setDynamicActionContext({ sessionId: 's-B', modeId: 'm1', modeTemplateType: 'sales' });
    engine.handleTranscript({ speaker: 'interviewer', text: '这个价格太高了', timestamp: Date.now(), final: true }, true);
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
    engine.handleTranscript({ speaker: 'interviewer', text: '这个价格太高了', timestamp: Date.now(), final: true }, true);
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
