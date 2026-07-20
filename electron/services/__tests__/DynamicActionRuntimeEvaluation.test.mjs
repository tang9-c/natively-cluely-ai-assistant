import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const enginePath = path.join(process.cwd(), 'dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.join(process.cwd(), 'dist-electron/electron/SessionTracker.js');
const privacyPath = path.join(process.cwd(), 'scripts/assert-dynamic-action-report-privacy.mjs');
const evaluatorPath = path.join(process.cwd(), 'dist-electron/electron/services/dynamic-actions/DynamicActionAcceptedOutputEvaluator.js');

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

test('runtime evaluation does not persist transcript or evidence sentinels after fallback', async () => {
  const SENTINELS = {
    transcript: 'PRIVATE_TRANSCRIPT_SENTINEL_7F91',
    evidence: 'PRIVATE_EVIDENCE_SENTINEL_2A44',
    providerBody: 'PRIVATE_PROVIDER_BODY_SENTINEL_9C10',
  };
  const { assertDynamicActionReportPrivacy } = await import(pathToFileURL(privacyPath).href);
  const { engine, session } = await runtimeEvaluationHarness([
    `可以确认支持自动写回。${SENTINELS.transcript}`,
  ]);
  engine._setDynamicActionClaimGroundingVerifierForTest({
    verify: async () => ({
      verdict: 'unavailable',
      evidenceIds: [],
      reasonCode: 'verifier_provider_unavailable',
      verificationSource: 'continuation_grounding_verifier',
    }),
  });

  await engine.runWhatShouldISay('能力匹配', 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    modeEvent: {
      actionId: 'child-privacy',
      actionType: 'capability_fit_answer',
      parentActionId: 'parent-privacy',
      productContract: { outputType: 'spoken_response' },
    },
    dynamicActionValidation: {
      actionType: 'capability_fit_answer',
      parentActionId: 'parent-privacy',
      grounding: {
        groundedSources: [{ evidenceId: 'ev-privacy', type: 'material', label: 'privacy.pdf', status: 'used' }],
        injectedEvidence: [{
          evidenceId: 'ev-privacy',
          type: 'material',
          label: 'privacy.pdf',
          sourceId: 'm1',
          excerpt: SENTINELS.evidence,
        }],
      },
      providerDataScopes: { transcript: true, reference_files: true },
      deferUserVisibleEmission: true,
      language: 'zh',
    },
    dynamicActionEvaluationSink: (trace) => {
      assert.doesNotThrow(() => assertDynamicActionReportPrivacy({
        reports: [trace],
        fixtures: [{
          turns: [{ text: SENTINELS.transcript }],
          generatedAnswer: SENTINELS.evidence,
          providerBody: SENTINELS.providerBody,
        }],
      }));
    },
  });

  const usage = session.getFullUsage().at(-1);
  assert.doesNotThrow(() => assertDynamicActionReportPrivacy({
    reports: [{ usage: usage.metadata }],
    fixtures: [{
      turns: [{ text: SENTINELS.transcript }],
      generatedAnswer: SENTINELS.evidence,
      providerBody: SENTINELS.providerBody,
    }],
  }));
});

test('FDE grounded answer evaluator requires grounding for positive process claims', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const grounded = evaluateDynamicActionAcceptedOutput({
    actionType: 'fde_grounded_answer',
    outputType: 'spoken_response',
    answerText: '可以确认 ECO 流程里质量经理需要做人审；建议用 3 条真实 ECO 和测试数据验证验收标准。',
    groundedSources: [{ evidenceId: 'ev-fde', type: 'material', label: 'fde-process.pdf', status: 'used' }],
    claimGrounding: { verdict: 'supported', evidenceIds: ['ev-fde'], reasonCode: 'claims_supported', verificationSource: 'continuation_grounding_verifier' },
    sourceUtterance: '客户问 ECO 流程里 AI 怎么辅助检查缺字段。',
  });
  const ungrounded = evaluateDynamicActionAcceptedOutput({
    actionType: 'fde_grounded_answer',
    outputType: 'spoken_response',
    answerText: '可以确认系统支持 CAPA 自动关闭。',
    groundedSources: [],
    claimGrounding: { verdict: 'unavailable', evidenceIds: [], reasonCode: 'no_injected_evidence', verificationSource: 'continuation_grounding_verifier' },
    sourceUtterance: '客户问 CAPA 关闭流程。',
  });
  assert.equal(grounded.passed, true);
  assert.equal(ungrounded.passed, false);
  assert.ok(ungrounded.groundingFailures.includes('fde_claim_not_supported_by_injected_evidence'));
});

test('FDE grounded answer evaluator rejects automation promises and unprompted AI jargon', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const automation = evaluateDynamicActionAcceptedOutput({
    actionType: 'fde_grounded_answer',
    outputType: 'spoken_response',
    answerText: 'AI Agent 可以自动写回 PLM 并自动审批 ECO。',
    groundedSources: [{ evidenceId: 'ev-fde', type: 'material', label: 'fde-process.pdf', status: 'used' }],
    claimGrounding: { verdict: 'supported', evidenceIds: ['ev-fde'], reasonCode: 'claims_supported', verificationSource: 'continuation_grounding_verifier' },
    sourceUtterance: '客户问 ECO 审批流程。',
  });
  const jargon = evaluateDynamicActionAcceptedOutput({
    actionType: 'fde_grounded_answer',
    outputType: 'spoken_response',
    answerText: '这里可以用 RAG 和 tool call 编排来处理流程。',
    groundedSources: [],
    claimGrounding: { verdict: 'unavailable', evidenceIds: [], reasonCode: 'no_injected_evidence', verificationSource: 'continuation_grounding_verifier' },
    sourceUtterance: '客户问 AI 怎么辅助检查缺字段。',
  });
  assert.equal(automation.passed, false);
  assert.ok(automation.forbiddenPatternFailures.includes('automatic_plm_qms_writeback_or_approval'));
  assert.equal(jargon.passed, false);
  assert.ok(jargon.forbiddenPatternFailures.includes('unprompted_ai_technical_jargon'));
});

test('FDE runtime evaluation uses FDE safe fallback when validation fails', async () => {
  const { engine, session } = await runtimeEvaluationHarness(['可以确认支持自动写回 QMS。']);
  engine._setDynamicActionClaimGroundingVerifierForTest({
    verify: async () => ({
      verdict: 'unsupported',
      evidenceIds: [],
      reasonCode: 'claim_not_supported',
      verificationSource: 'continuation_grounding_verifier',
    }),
  });

  const answer = await engine.runWhatShouldISay('客户问 AI 怎么辅助 CAPA 关闭流程。', 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    modeEvent: {
      actionId: 'fde-child-1',
      actionType: 'fde_grounded_answer',
      parentActionId: 'fde-parent-1',
      productContract: { outputType: 'spoken_response' },
    },
    dynamicActionValidation: {
      actionType: 'fde_grounded_answer',
      parentActionId: 'fde-parent-1',
      grounding: {
        groundedSources: [],
        injectedEvidence: [],
      },
      providerDataScopes: { transcript: true, reference_files: true },
      deferUserVisibleEmission: true,
      language: 'zh',
      sourceUtterance: '客户问 AI 怎么辅助 CAPA 关闭流程。',
    },
  });

  assert.match(answer, /当前资料不足/);
  assert.match(answer, /真实流程样本/);
  assert.doesNotMatch(answer, /自动写回 QMS/);
  const usage = session.getFullUsage().at(-1);
  assert.equal(usage.metadata.evaluationResult, 'safe_fallback');
  assert.equal(usage.metadata.actionType, 'fde_grounded_answer');
});

test('candidate policy claim fails without external recruiting evidence', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const result = evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_concern',
    outputType: 'spoken_response',
    answerText: '这个岗位支持远程办公，也支持签证转移。',
    groundedSources: [],
    claimGrounding: { verdict: 'unavailable', evidenceIds: [], reasonCode: 'no_injected_evidence', verificationSource: 'continuation_grounding_verifier' },
  });
  assert.equal(result.passed, false);
});

test('candidate evidence summary must be anchored to transcript evidence', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const supported = evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_evidence_summary',
    outputType: 'spoken_response',
    answerText: '已观察证据：候选人负责灰度方案。结果：事故率下降 30%。待验证：统计口径。',
    transcriptEvidence: ['候选人补充说自己负责灰度方案，事故率下降 30%，统计口径还需要确认。'],
  });
  assert.equal(supported.passed, true);

  const unsupported = evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_evidence_summary',
    outputType: 'spoken_response',
    answerText: '已观察证据：候选人管理过 50 人团队，因此建议录用。待验证：无。',
    transcriptEvidence: ['候选人只说自己参与了灰度方案。'],
  });
  assert.equal(unsupported.passed, false);
});
