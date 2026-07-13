import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const enginePath = path.join(process.cwd(), 'dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.join(process.cwd(), 'dist-electron/electron/SessionTracker.js');

class StubLLMHelper {
  getActiveModel() { return { provider: 'gemini', model: 'gemini-3-flash' }; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler() {}
  async generateContentStructured() { return '{"intent":"general","confidence":0.5}'; }
  getGeminiClient() { return null; }
  getOpenAIClient() { return null; }
  getClaudeClient() { return null; }
  getGroqClient() { return null; }
  getOllamaClient() { return null; }
  getModesManager() { return { getActiveMode: () => null, getActiveModeSystemPromptSuffix: () => '' }; }
  getSettingsManager() { return { get: () => null, set: () => {} }; }
}

function deferredVerifier() {
  let resolveCalled;
  let calledResolve;
  const called = new Promise((resolve) => { calledResolve = resolve; });
  const promise = new Promise((resolve) => { resolveCalled = resolve; });
  return {
    called,
    resolve: resolveCalled,
    service: {
      verify: async () => {
        calledResolve();
        return promise;
      },
    },
  };
}

async function runtimeEvaluationHarness(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = await import(pathToFileURL(sessionPath).href);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };
  return { engine, session };
}

test('capability stream stays invisible until claim verifier resolves', async () => {
  const verifier = deferredVerifier();
  const { engine, session } = await runtimeEvaluationHarness(['可以确认支持温升分析，', '边界仍需 PoC。']);
  engine._setDynamicActionClaimGroundingVerifierForTest(verifier.service);
  const tokens = [];
  const finals = [];
  engine.on('suggested_answer_token', (token) => tokens.push(token));
  engine.on('suggested_answer', (answer) => finals.push(answer));
  const answerPromise = engine.runWhatShouldISay('能力匹配', 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    modeEvent: {
      actionId: 'child-1',
      actionType: 'capability_fit_answer',
      parentActionId: 'parent-1',
      productContract: { outputType: 'spoken_response' },
    },
    dynamicActionValidation: {
      actionType: 'capability_fit_answer',
      parentActionId: 'parent-1',
      grounding: {
        groundedSources: [{ evidenceId: 'ev-1', type: 'material', label: 'capability.pdf', status: 'used' }],
        injectedEvidence: [{ evidenceId: 'ev-1', type: 'material', label: 'capability.pdf', sourceId: 'm1', excerpt: '仅确认支持压降分析。' }],
      },
      providerDataScopes: { transcript: true, reference_files: true },
      deferUserVisibleEmission: true,
      language: 'zh',
    },
  });
  await verifier.called;
  assert.equal(tokens.length, 0);
  verifier.resolve({
    verdict: 'unsupported',
    evidenceIds: [],
    reasonCode: 'claim_not_supported',
    verificationSource: 'continuation_grounding_verifier',
  });
  const answer = await answerPromise;
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0], answer);
  assert.doesNotMatch(tokens[0], /支持温升/);
  assert.deepEqual(finals, [answer]);
  assert.doesNotMatch(session.getAssistantResponseHistory().at(-1).text, /支持温升/);
  const usage = session.getFullUsage().at(-1);
  assert.equal(usage.metadata.evaluationResult, 'safe_fallback');
  assert.equal(usage.metadata.parentActionId, 'parent-1');
});
