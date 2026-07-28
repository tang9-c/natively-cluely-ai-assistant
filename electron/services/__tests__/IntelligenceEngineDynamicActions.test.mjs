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

async function loadDynamicActionEngine() {
  const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
  return import(pathToFileURL(enginePath).href);
}

async function loadMeetingPersistence() {
  const persistencePath = path.resolve(__dirname, '../../../dist-electron/electron/MeetingPersistence.js');
  return import(pathToFileURL(persistencePath).href);
}

async function loadDynamicActionArtifacts() {
  const artifactPath = path.resolve(__dirname, '../../../dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js');
  return import(pathToFileURL(artifactPath).href);
}

async function loadPostCallWorkflow() {
  const workflowPath = path.resolve(__dirname, '../../../dist-electron/electron/services/post-call/PostCallWorkflow.js');
  return import(pathToFileURL(workflowPath).href);
}

// Minimal LLMHelper stub — engine touches getActiveModel, isStreamingSupported,
// and setNegotiationCoachingHandler in its constructor / initializeLLMs path.
// Other LLM methods are unused because we only invoke handleTranscript.
class StubLLMHelper {
  constructor(options = {}) {
    this.structuredResponses = options.structuredResponses ?? [];
    this.structuredCalls = [];
    this.throwStructured = options.throwStructured ?? false;
    this.throwCloudOnly = options.throwCloudOnly ?? false;
    this.structuredError = options.structuredError;
    this.executionKind = options.executionKind ?? 'cloud';
  }
  getActiveModel() { return { provider: 'gemini', model: 'gemini-3-flash' }; }
  getCurrentModelExecutionKind() { return this.executionKind; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler(_fn) { /* no-op for test */ }
  async generateContentStructured(prompt, options) {
    this.structuredCalls.push({ prompt, options });
    if (this.structuredError) throw this.structuredError;
    if (this.throwCloudOnly && options?.requireCloudProvider) throw new Error('No cloud reasoning model available');
    if (this.throwStructured) throw new Error('cloud down');
    const configured = this.structuredResponses.shift();
    if (configured) return configured;
    if (prompt.includes('动态动作语义门控')) {
      const candidatesJson = prompt.match(/^candidates: (.+)$/m)?.[1];
      const candidates = candidatesJson ? JSON.parse(candidatesJson) : [];
      return JSON.stringify({
        actions: candidates.map((candidate) => ({
          actionType: candidate.actionType,
          decision: 'pass',
          confidence: 0.92,
          reasons: ['test_cloud_confirmed_candidate'],
          rejectedCandidates: [],
        })),
      });
    }
    return '{"intent":"general","confidence":0.5}';
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

function buildStoredDiscoveryAction(overrides = {}) {
  return {
    id: 'parent',
    sessionId: 'session-1',
    modeId: 'sales',
    modeTemplateType: 'sales',
    type: 'discovery_question',
    label: '追问关键问题',
    productContract: { outputType: 'spoken_response', userAction: '追问', riskState: 'normal' },
    confidence: 0.9,
    priority: 0.9,
    evidenceRefs: [],
    status: 'candidate',
    createdAt: Date.now(),
    promptInstruction: '',
    sourceIntent: 'sales_capability_fit',
    latestTurn: '是否支持流体仿真？',
    ...overrides,
  };
}

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
        '{"actions":[{"actionType":"pricing_objection","decision":"pass","confidence":0.92,"reasons":["cloud_confirmed_pricing_objection"],"rejectedCandidates":[]}]}',
        '{"actions":[{"actionType":"pricing_objection","decision":"pass","confidence":0.94,"reasons":["cloud_confirmed_pricing_objection"],"rejectedCandidates":[]}]}',
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
        '{"actions":[{"actionType":"pricing_objection","decision":"pass","confidence":0.92,"reasons":["cloud_confirmed_pricing_objection"],"rejectedCandidates":[]}]}',
        '{"actions":[{"actionType":"pricing_objection","decision":"pass","confidence":0.94,"reasons":["cloud_confirmed_pricing_objection"],"rejectedCandidates":[]}]}',
        '{"actions":[{"actionType":"pricing_objection","decision":"pass","confidence":0.94,"reasons":["cloud_confirmed_pricing_objection"],"rejectedCandidates":[]}]}',
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

  test('accepted dynamic action records placeholder usage and failure metadata for post-call fallback', async () => {
    const { engine, session } = await makeEngine();
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.setDynamicActionContext({
      sessionId: 'sess-dynamic-action-usage',
      modeId: 'mode-team',
      modeTemplateType: 'team-meet',
    });

    engine.handleTranscript({
      speaker: 'user',
      text: '我来发发布清单，周五前完成。',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    const action = emitted.find((item) => item.type === 'action_item');
    assert.ok(action);
    const accepted = engine.acceptDynamicAction(action.id);
    assert.ok(accepted);
    const failed = engine.markDynamicActionGenerationFailed(action.id);
    assert.ok(failed);

    const usage = session.getFullUsage().filter((item) => item?.metadata?.actionId === action.id);
    assert.equal(usage.length, 2);
    assert.equal(usage[0].metadata.generationStatus, 'accepted');
    assert.equal(usage[0].question, action.productContract.userAction);
    assert.equal(usage[1].metadata.generationStatus, 'generated_failed');
  });

  test('recruiting transcript evidence usage preserves metadata provenance through post-call records', async () => {
    const { engine, session } = await makeEngine();
    const { DynamicActionEngine } = await loadDynamicActionEngine();
    const { buildDynamicActionArtifactActionsFromUsage } = await loadMeetingPersistence();
    const { buildDynamicActionArtifacts } = await loadDynamicActionArtifacts();
    const { buildPostCallEnhancements } = await loadPostCallWorkflow();
    const dynamicActionEngine = new DynamicActionEngine();
    engine._setDynamicActionEngineForTest(dynamicActionEngine);
    engine.setDynamicActionContext({
      sessionId: 'recruiting-session',
      modeId: 'recruiting-mode',
      modeTemplateType: 'recruiting',
    });
    dynamicActionEngine.getStore().addAction(buildStoredDiscoveryAction({
      id: 'recruiting-evidence-1',
      sessionId: 'recruiting-session',
      modeId: 'recruiting-mode',
      modeTemplateType: 'recruiting',
      type: 'candidate_evidence_summary',
      label: '生成候选人证据摘要',
      sourceIntent: 'recruiting_bei_evidence_gap',
      latestTurn: '候选人负责灰度方案，结果指标仍待验证。',
      productContract: { outputType: 'checklist', userAction: '生成候选人证据摘要', riskState: 'normal' },
    }));

    assert.ok(engine.acceptDynamicAction('recruiting-evidence-1'));
    const usage = session.getFullUsage().filter((item) => item?.metadata?.actionId === 'recruiting-evidence-1');
    assert.equal(usage.length, 1);
    assert.equal(usage[0].metadata.modeTemplateType, 'recruiting');
    assert.equal(usage[0].metadata.sourceIntent, 'recruiting_bei_evidence_gap');
    assert.equal('retrievalQuery' in usage[0].metadata, false);
    assert.equal('latestTurn' in usage[0].metadata, false);
    assert.equal('transcriptEvidence' in usage[0].metadata, false);

    const actions = buildDynamicActionArtifactActionsFromUsage(usage);
    const artifacts = buildDynamicActionArtifacts({ actions, usage });
    const result = buildPostCallEnhancements({
      modeTemplateType: 'recruiting',
      transcript: [],
      dynamicActionArtifacts: artifacts,
    });

    assert.equal(artifacts[0].modeTemplateType, 'recruiting');
    assert.equal(artifacts[0].sourceIntent, 'recruiting_bei_evidence_gap');
    assert.equal(result.acceptedRecruitingRecords.length, 1);
    assert.equal(result.acceptedRecruitingRecords[0].sourceIntent, 'recruiting_bei_evidence_gap');
  });

  test('active dynamic action suppresses duplicate suggestion-trigger answer for same sales intent', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"actions":[{"actionType":"pricing_objection","decision":"pass","confidence":0.92,"reasons":["cloud_confirmed_pricing_objection"],"rejectedCandidates":[]}]}',
        '{"intent":"sales_pricing_objection","confidence":0.92}',
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

  test('detector-only mode uses local intent metadata and exactly one semantic gate call', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"actions":[{"actionType":"buying_signal","decision":"pass","confidence":0.96,"semanticIntent":"explicit_next_step_or_contract","reasons":["cloud_confirmed_buying_signal"],"rejectedCandidates":[]}]}',
      ],
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

    assert.equal(helper.structuredCalls.length, 1);
    assert.equal(helper.structuredCalls[0]?.options?.taskLabel, 'dynamic-action-semantic-gate');
    assert.equal(helper.structuredCalls[0]?.options?.providerStrategy, 'selected_model_only');
    assert.equal(helper.structuredCalls[0]?.options?.totalTimeoutMs, 6000);
    assert.equal(helper.structuredCalls[0]?.options?.requireCloudProvider, undefined);
    const action = emitted.find(a => a.type === 'buying_signal');
    assert.ok(action, `expected buying_signal; got ${emitted.map(a => a.type).join(', ')}`);
    assert.equal(action.confirmedIntent, 'sales_buying_signal');
    assert.equal(action.confirmationSource, 'local_intent');
  });

  test('detector-only modes skip all model calls when no local action candidate exists', async () => {
    const cases = [
      ['sales', '好的，我已经看到了。'],
      ['fde', '今天先到这里。'],
      ['recruiting', '谢谢你的介绍。'],
      ['team-meet', '大家下午好。'],
    ];

    for (const [modeTemplateType, text] of cases) {
      const helper = new StubLLMHelper();
      const { engine } = await makeEngine(helper);
      engine.setDynamicActionContext({
        sessionId: `s-no-candidate-${modeTemplateType}`,
        modeId: `m-${modeTemplateType}`,
        modeTemplateType,
      });

      engine.handleTranscript({
        speaker: 'interviewer',
        text,
        timestamp: Date.now(),
        final: true,
      }, true);
      await waitForAsyncSignals();

      assert.equal(
        helper.structuredCalls.length,
        0,
        `${modeTemplateType} should not call a model without detector candidates`,
      );
    }
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
      detectSignalCandidates: ({ transcript }) => transcript.includes('Seventh context turn')
        ? [{ trigger: { type: 'pricing_request' }, match: 'pricing', index: 0 }]
        : [],
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
      detectSignalCandidates: () => [
        { trigger: { type: 'case_study_request' }, match: 'similar customer case', index: 0 },
        { trigger: { type: 'pricing_request' }, match: 'pricing page', index: 0 },
      ],
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
              riskLevel: 'high',
              gateStrategy: 'required',
              allowLocalFallbackOnCloudFailure: false,
            },
            {
              actionType: 'pricing_request',
              label: 'Draft quote email',
              match: 'pricing page',
              confidence: 0.86,
              highRisk: true,
              fastPathEligible: false,
              riskLevel: 'high',
              gateStrategy: 'required',
              allowLocalFallbackOnCloudFailure: true,
            },
          ],
          policySummary: {
            modeTemplateType: input.modeTemplateType,
            actions: [
              {
                actionType: 'case_study_request',
                riskLevel: 'high',
                gateStrategy: 'required',
                requiredEvidence: [],
                localFallbackEvidence: [],
                allowLocalFallbackOnCloudFailure: false,
              },
              {
                actionType: 'pricing_request',
                riskLevel: 'high',
                gateStrategy: 'required',
                requiredEvidence: [],
                localFallbackEvidence: [{ includeAny: ['pricing'], rejectAny: ['pricing page'] }],
                allowLocalFallbackOnCloudFailure: true,
              },
            ],
          },
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
    assert.equal(gateCall.options.requireCloudProvider, undefined);
    assert.equal(gateCall.options.providerStrategy, 'selected_model_only');
    assert.equal(gateCall.options.totalTimeoutMs, 6000);
    assert.equal(gateCall.options.perProviderTimeoutMs, 6000);
    assert.equal(gateCall.options.maxRotations, 1);
    assert.match(gateCall.prompt, /policySummary/);
    assert.match(gateCall.prompt, /case_study_request/);
    assert.match(gateCall.prompt, /pricing_request/);
    assert.match(gateCall.prompt, /required/);
    assert.match(gateCall.prompt, /high/);
    assert.match(gateCall.prompt, /local zero-shot intent model is not an allowed fallback/i);
    assert.deepEqual(gateResults[0]?.map(item => [item.actionType, item.decision]), [
      ['case_study_request', 'pass'],
      ['pricing_request', 'reject'],
    ]);
  });

  test('recruiting semantic gate fails closed when the selected model is unavailable', async () => {
    const helper = new StubLLMHelper({
      throwStructured: true,
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    engine.on('dynamic_action_emitted', action => emitted.push(action));
    engine.setDynamicActionContext({ sessionId: 's-recruiting-local-only', modeId: 'm-recruiting', modeTemplateType: 'recruiting' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: '候选人问这个岗位是否可以完全远程办公。',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    const gateCall = helper.structuredCalls.find(call => call.options?.taskLabel === 'dynamic-action-semantic-gate');
    assert.ok(gateCall, 'expected recruiting semantic gate call');
    assert.equal(gateCall.options.providerStrategy, 'selected_model_only');
    assert.equal(emitted.some(action => action.type === 'candidate_concern'), false);
  });

  test('selected model failures emit model-specific availability without a card', async () => {
    for (const [code, expectedStatus] of [
      ['selected_model_unavailable', 'selected_model_unavailable'],
      ['selected_model_not_configured', 'selected_model_not_configured'],
    ]) {
      const structuredError = Object.assign(new Error(code), { code });
      const helper = new StubLLMHelper({
        structuredError,
        executionKind: 'external',
      });
      const { engine } = await makeEngine(helper);
      const emitted = [];
      const availability = [];
      engine.on('dynamic_action_emitted', action => emitted.push(action));
      engine.on('dynamic_action_gate_availability', statuses => availability.push(...statuses));
      engine.setDynamicActionContext({
        sessionId: `s-${code}`,
        modeId: 'm-sales',
        modeTemplateType: 'sales',
      });

      engine.handleTranscript({
        speaker: 'interviewer',
        text: '这个价格太高了，我们预算不够',
        timestamp: Date.now(),
        final: true,
      }, true);
      await waitForAsyncSignals();

      assert.equal(emitted.length, 0);
      assert.ok(availability.includes(expectedStatus));
      assert.equal(helper.structuredCalls.length, 1);
    }
  });

  test('single semantic gate prompt keeps triggering turn and compact recent context', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"actions":[{"actionType":"fde_next_step","decision":"pass","confidence":0.93,"semanticIntent":"fde_next_step","reasons":["cloud_confirmed_fde_next_step"],"rejectedCandidates":[]}]}',
      ],
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));

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

    for (const segment of segments.slice(0, -1)) {
      engine.handleTranscript(segment, true);
    }
    engine.setDynamicActionContext({ sessionId: 's-speakers', modeId: 'm-fde', modeTemplateType: 'fde' });
    engine.handleTranscript(segments.at(-1), true);
    await waitForAsyncSignals();

    assert.equal(
      helper.structuredCalls.some(call => call.options?.taskLabel === 'intent-classification'),
      false,
    );
    const gateCall = helper.structuredCalls.find(call => call.options?.taskLabel === 'dynamic-action-semantic-gate');
    assert.ok(gateCall, 'expected a single semantic gate call');
    assert.equal(gateCall.options.providerStrategy, 'selected_model_only');
    assert.equal(gateCall.options.totalTimeoutMs, 6000);
    assert.match(gateCall.prompt, /下一步需要负责人，明天前确认上线计划。/);
    assert.match(gateCall.prompt, /Jordan requested a concrete next step for legal and security\./);
    const contextJson = gateCall.prompt.match(/^recentContextTurns: (.+)$/m)?.[1];
    assert.equal(JSON.parse(contextJson).length, 6);
    assert.ok(emitted.some(a => a.type === 'fde_next_step'), 'FDE dynamic action should emit from the semantic gate');
  });

  test('transcript scope disabled skips cloud intent confirmation and high-risk emission', async () => {
    const helper = new StubLLMHelper({
      structuredResponses: ['{"intent":"sales_buying_signal","confidence":0.96}'],
    });
    const { engine } = await makeEngine(helper);
    engine._setIntentClassificationOptionsForTest({
      providerDataScopes: { transcript: false },
      cloudIntentClassifier: async () => ({ intent: 'sales_buying_signal', confidence: 0.96 }),
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
      structuredResponses: ['{"intent":"sales_buying_signal","confidence":0.96}'],
    });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    const gateTraces = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.on('dynamic_action_gate_trace', (trace) => gateTraces.push(trace));
    engine._setIntentClassificationOptionsForTest({
      providerDataScopes: { transcript: false },
      cloudIntentClassifier: async () => ({ intent: 'sales_buying_signal', confidence: 0.96 }),
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
    const availability = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.on('dynamic_action_gate_availability', (statuses) => availability.push(...statuses));
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

    assert.equal(emitted.length, 0);
    assert.ok(availability.includes('cloud_unavailable'));
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
    const helper = new StubLLMHelper({
      structuredResponses: [
        '{"actions":[{"actionType":"case_study_request","decision":"pass","confidence":0.92,"semanticIntent":"case_or_proof_request","reasons":["cloud_confirmed_case_request"],"rejectedCandidates":[]}]}',
      ],
    });
    const { engine } = await makeEngine(helper);
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
    assert.equal(action.semanticGate?.semanticProvider, 'cloud_llm');
  });

  test('final English price objection fails closed when dynamic action cloud gate fails', async () => {
    const helper = new StubLLMHelper({ throwStructured: true });
    const { engine } = await makeEngine(helper);
    const emitted = [];
    const availability = [];
    engine.on('dynamic_action_emitted', (action) => emitted.push(action));
    engine.on('dynamic_action_gate_availability', (statuses) => availability.push(...statuses));
    engine.setDynamicActionContext({ sessionId: 's-english-cloud-fail', modeId: 'm-sales', modeTemplateType: 'sales' });

    engine.handleTranscript({
      speaker: 'interviewer',
      text: 'This is too expensive for our budget.',
      timestamp: Date.now(),
      final: true,
    }, true);
    await waitForAsyncSignals();

    assert.equal(emitted.length, 0);
    assert.ok(availability.includes('cloud_unavailable'));
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
    // Inject a broken engine that throws during detector preflight.
    engine._setDynamicActionEngineForTest({
      detectSignalCandidates: () => { throw new Error('boom'); },
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

  test('continuation registers only after non-empty completed usage exists', async () => {
    const { engine, session } = await makeEngine();
    const { DynamicActionEngine } = await loadDynamicActionEngine();
    const dynamicActionEngine = new DynamicActionEngine();
    engine._setDynamicActionEngineForTest(dynamicActionEngine);
    engine.setDynamicActionContext({ sessionId: 'session-1', modeId: 'sales', modeTemplateType: 'sales' });

    const registered = [];
    engine._setDynamicActionContinuationServiceForTest({
      registerCompletedAction: (value) => { registered.push(value.id); return null; },
      cancelForContext: () => undefined,
    });
    dynamicActionEngine.getStore().addAction(buildStoredDiscoveryAction({ id: 'parent-complete-1' }));

    engine.acceptDynamicAction('parent-complete-1');
    engine.completeDynamicAction('parent-complete-1');
    assert.deepEqual(registered, []);

    session.pushUsage({
      type: 'assist',
      timestamp: Date.now(),
      question: '追问',
      answer: '请问对象、指标和验收标准分别是什么？',
      metadata: { source: 'dynamic_action', actionId: 'parent-complete-1', generationStatus: 'completed' },
    });
    engine.completeDynamicAction('parent-complete-1');
    assert.deepEqual(registered, ['parent-complete-1']);

    dynamicActionEngine.getStore().addAction(buildStoredDiscoveryAction({ id: 'parent-stale-mode' }));
    session.pushUsage({
      type: 'assist',
      timestamp: Date.now(),
      question: '追问',
      answer: '有效问题',
      metadata: { source: 'dynamic_action', actionId: 'parent-stale-mode', generationStatus: 'completed' },
    });
    engine.setDynamicActionContext({ sessionId: 'session-1', modeId: 'fde', modeTemplateType: 'fde' });
    engine.completeDynamicAction('parent-stale-mode');
    assert.deepEqual(registered, ['parent-complete-1']);
  });
});
