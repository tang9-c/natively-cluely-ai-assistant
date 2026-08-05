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

async function languageRetryHarness(responses) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = await import(pathToFileURL(sessionPath).href);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  let callCount = 0;
  const promptInstructions = [];
  engine.whatToAnswerLLM = {
    async *generateStream(
      _transcript,
      _temporalContext,
      _intentResult,
      _imagePaths,
      _screenContext,
      promptInstruction,
    ) {
      promptInstructions.push(promptInstruction);
      const response = responses[Math.min(callCount, responses.length - 1)];
      callCount += 1;
      yield response;
    },
  };
  return { engine, session, promptInstructions, getCallCount: () => callCount };
}

test('Chinese dynamic action silently retries an English answer and persists only Chinese', async () => {
  const { engine, session, promptInstructions, getCallCount } = await languageRetryHarness([
    'That is great news. I will send the revised quote within the next hour.',
    '好的，我会立即调整方案，并在一小时内发送更新后的报价明细。',
  ]);
  const tokens = [];
  engine.on('suggested_answer_token', (token) => tokens.push(token));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    promptInstruction: 'You are in Sales mode. Handle the pricing objection.',
    modeEvent: {
      actionId: 'pricing-language-1',
      actionType: 'pricing_objection',
      modeTemplateType: 'sales',
      language: 'zh',
      latestTurn: '如果系统集成由我们自己做，价格能降多少？',
      productContract: { outputType: 'spoken_response' },
    },
  });

  assert.equal(getCallCount(), 2);
  assert.match(promptInstructions[1], /Simplified Chinese/);
  assert.equal(answer, '好的，我会立即调整方案，并在一小时内发送更新后的报价明细。');
  assert.deepEqual(tokens, [answer]);
  assert.equal(session.getAssistantResponseHistory().length, 1);
  assert.equal(session.getAssistantResponseHistory()[0].text, answer);
  assert.doesNotMatch(JSON.stringify(session.getFullUsage()), /That is great news/);
});

test('Chinese dynamic action rejects repeated English answers without polluting session history', async () => {
  const { engine, session, getCallCount } = await languageRetryHarness([
    'That is great news. I will send the revised quote within the next hour.',
    'Perfect. I will process the adjustment right away.',
  ]);
  const tokens = [];
  engine.on('suggested_answer_token', (token) => tokens.push(token));

  await assert.rejects(
    engine.runWhatShouldISay(undefined, 0.9, undefined, {
      skipCooldown: true,
      source: 'dynamic_action',
      promptInstruction: 'You are in Sales mode. Handle the pricing objection.',
      modeEvent: {
        actionId: 'pricing-language-2',
        actionType: 'pricing_objection',
        modeTemplateType: 'sales',
        language: 'zh',
        latestTurn: '这个价格还是太高了。',
        productContract: { outputType: 'spoken_response' },
      },
    }),
    /dynamic_action_language_mismatch/,
  );

  assert.equal(getCallCount(), 2);
  assert.deepEqual(tokens, []);
  assert.equal(session.getAssistantResponseHistory().length, 0);
  assert.equal(session.getFullUsage().length, 0);
});

test('English dynamic action accepts English prose containing a Chinese proper name', async () => {
  const expected = 'For 华为, we can first confirm the required scope and then prepare a revised quote.';
  const { engine, getCallCount } = await languageRetryHarness([expected]);

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    modeEvent: {
      actionId: 'english-with-proper-name',
      actionType: 'pricing_objection',
      modeTemplateType: 'sales',
      language: 'en',
      latestTurn: 'Can you revise the quote for 华为?',
      productContract: { outputType: 'spoken_response' },
    },
  });

  assert.equal(getCallCount(), 1);
  assert.equal(answer, expected);
});

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

test('mixed Chinese dynamic action uses a Chinese runtime safe fallback', async () => {
  const { engine } = await runtimeEvaluationHarness(['我们有一家头部客户取得了很高的 ROI。']);
  engine._setDynamicActionClaimGroundingVerifierForTest({
    verify: async () => ({
      verdict: 'unsupported',
      evidenceIds: [],
      reasonCode: 'claim_not_supported',
      verificationSource: 'continuation_grounding_verifier',
    }),
  });

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    modeEvent: {
      actionId: 'mixed-fde-language',
      actionType: 'case_study_request',
      modeTemplateType: 'sales',
      language: 'mixed',
      latestTurn: '有 SaaS 行业的 ROI 案例吗？',
      productContract: { outputType: 'spoken_response' },
    },
    dynamicActionValidation: {
      actionType: 'case_study_request',
      grounding: { groundedSources: [], injectedEvidence: [] },
      providerDataScopes: { transcript: true, reference_files: true },
      deferUserVisibleEmission: true,
      language: 'mixed',
      sourceUtterance: '有 SaaS 行业的 ROI 案例吗？',
    },
  });

  assert.match(answer, /没有找到可引用的匹配案例/);
  assert.doesNotMatch(answer, /^I could not find/);
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

test('transcript evidence action acceptance omits retrieval content from usage metadata', async () => {
  const { engine, session } = await runtimeEvaluationHarness(['unused']);
  const SENTINEL = 'CANDIDATE_RETRIEVAL_QUERY_SENTINEL_4A6E';

  engine.recordDynamicActionUsage({
    id: 'candidate-summary-accepted',
    type: 'candidate_evidence_summary',
    label: '总结候选人证据',
    modeTemplateType: 'recruiting',
    retrievalQuery: SENTINEL,
    productContract: { userAction: '总结候选人证据', outputType: 'spoken_response' },
  }, 'accepted');

  const metadata = session.getFullUsage().at(-1).metadata;
  assert.equal(metadata.evidenceKind, 'transcript_evidence');
  assert.equal('retrievalQuery' in metadata, false);
  assert.doesNotMatch(JSON.stringify(metadata), new RegExp(SENTINEL));
});

test('transcript evidence reaches the evaluator without entering completed usage metadata', async () => {
  const SENTINEL = 'CANDIDATE_TRANSCRIPT_EVIDENCE_SENTINEL_1D92';
  const boundedEvidence = `Candidate led the rollout ${SENTINEL}.`.slice(0, 1200);
  const { engine, session } = await runtimeEvaluationHarness([
    `Evidence observed: Candidate led the rollout ${SENTINEL}. Needs verification: metric definition.`,
  ]);
  let verifierCalls = 0;
  const traces = [];
  engine._setDynamicActionClaimGroundingVerifierForTest({
    verify: async () => {
      verifierCalls += 1;
      throw new Error('transcript evidence must not call external verifier');
    },
  });

  const answer = await engine.runWhatShouldISay('summarize candidate evidence', 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    modeEvent: {
      actionId: 'candidate-summary-completed',
      actionType: 'candidate_evidence_summary',
      parentActionId: 'candidate-summary-parent',
      retrievalQuery: SENTINEL,
      latestTurn: SENTINEL,
      productContract: { outputType: 'spoken_response' },
    },
    dynamicActionValidation: {
      actionType: 'candidate_evidence_summary',
      parentActionId: 'candidate-summary-parent',
      grounding: { groundedSources: [], injectedEvidence: [] },
      deferUserVisibleEmission: true,
      language: 'en',
      transcriptEvidence: [boundedEvidence],
    },
    dynamicActionEvaluationSink: (trace) => traces.push(trace),
  });

  assert.match(answer, new RegExp(SENTINEL));
  assert.equal(verifierCalls, 0);
  const metadata = session.getFullUsage().at(-1).metadata;
  assert.equal(metadata.evidenceKind, 'transcript_evidence');
  assert.equal(metadata.claimGroundingVerdict, 'not_required');
  assert.equal('retrievalQuery' in metadata, false);
  assert.doesNotMatch(JSON.stringify(metadata), new RegExp(SENTINEL));
  assert.doesNotMatch(JSON.stringify(traces), new RegExp(SENTINEL));
});

test('candidate evidence summaries reject stress-interview method classification without rejecting ordinary evidence', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const input = {
    actionType: 'candidate_evidence_summary',
    outputType: 'spoken_response',
    transcriptEvidence: ['候选人负责灰度方案并处理高压项目。'],
  };
  const ordinary = evaluateDynamicActionAcceptedOutput({
    ...input,
    answerText: '已观察证据：候选人负责灰度方案并处理高压项目。待验证：事故率口径。',
  });
  const chinese = evaluateDynamicActionAcceptedOutput({
    ...input,
    answerText: '已观察证据：候选人负责灰度方案。待验证：事故率口径。当前是压力面试。',
  });
  const english = evaluateDynamicActionAcceptedOutput({
    ...input,
    answerText: 'Evidence observed: candidate handled a high-pressure project. Needs verification: metric definition. This is a stress interview.',
    transcriptEvidence: ['candidate handled a high-pressure project'],
  });

  assert.equal(ordinary.passed, true);
  assert.ok(chinese.forbiddenPatternFailures.includes('visible_interview_method_classification'));
  assert.ok(english.forbiddenPatternFailures.includes('visible_interview_method_classification'));
});

test('candidate evidence summaries reject final advancement judgments in Chinese and English', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const input = {
    actionType: 'candidate_evidence_summary',
    outputType: 'spoken_response',
    transcriptEvidence: ['候选人负责灰度方案。'],
  };
  const chinese = evaluateDynamicActionAcceptedOutput({
    ...input,
    answerText: '已观察证据：候选人负责灰度方案。不建议继续推进。待验证：事故率口径。',
  });
  const english = evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_evidence_summary',
    outputType: 'spoken_response',
    answerText: 'Evidence observed: candidate led rollout. I do not recommend proceeding. Needs verification: metric definition.',
    transcriptEvidence: ['candidate led rollout'],
  });

  assert.ok(chinese.forbiddenPatternFailures.includes('final_hiring_judgment_or_ranking'));
  assert.ok(english.forbiddenPatternFailures.includes('final_hiring_judgment_or_ranking'));
});

test('candidate policy claims for start dates and offers require supported recruiting material in Chinese and English', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const cases = [
    '候选人可以九月入职。',
    '我们会发放录用通知。',
    'The candidate can start in September.',
    'We can issue an offer.',
  ];
  for (const answerText of cases) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_concern',
      outputType: 'spoken_response',
      answerText,
      groundedSources: [],
      claimGrounding: { verdict: 'unavailable', evidenceIds: [], reasonCode: 'no_injected_evidence', verificationSource: 'continuation_grounding_verifier' },
    });
    assert.ok(result.groundingFailures.includes('recruiting_policy_claim_not_supported_by_material'));
  }
});

test('candidate concern is fail-closed except for the exact deterministic fallback', async () => {
  const {
    buildRecruitingPolicySafeFallback,
    evaluateDynamicActionAcceptedOutput,
  } = await import(pathToFileURL(evaluatorPath).href);
  const unavailable = { verdict: 'unavailable', evidenceIds: [], reasonCode: 'no_injected_evidence', verificationSource: 'continuation_grounding_verifier' };
  const substantiveAnswers = [
    '这个岗位无需到岗。',
    'This role is fully work-from-home.',
    '候选人可以九月入职。',
    'We will extend an offer.',
  ];
  for (const answerText of substantiveAnswers) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_concern',
      outputType: 'spoken_response',
      answerText,
      groundedSources: [],
      claimGrounding: unavailable,
    });
    assert.ok(result.groundingFailures.includes('recruiting_policy_claim_not_supported_by_material'), answerText);
  }

  const safeAnswers = [
    buildRecruitingPolicySafeFallback('zh'),
    buildRecruitingPolicySafeFallback('en'),
  ];
  for (const answerText of safeAnswers) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_concern',
      outputType: 'spoken_response',
      answerText,
      groundedSources: [],
      claimGrounding: unavailable,
    });
    assert.equal(result.passed, true, answerText);
  }

  const appendedAnswers = [
    `${buildRecruitingPolicySafeFallback('zh')} 这个岗位永久远程。`,
    `${buildRecruitingPolicySafeFallback('en')} We will extend an offer.`,
  ];
  for (const answerText of appendedAnswers) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_concern',
      outputType: 'spoken_response',
      answerText,
      groundedSources: [],
      claimGrounding: unavailable,
    });
    assert.ok(result.groundingFailures.includes('recruiting_policy_claim_not_supported_by_material'), answerText);
  }
});

test('candidate concern runtime replaces an escaped model answer with the deterministic fallback', async () => {
  const { buildRecruitingPolicySafeFallback } = await import(pathToFileURL(evaluatorPath).href);
  const modelAnswer = `${buildRecruitingPolicySafeFallback('zh')} 这个岗位永久远程。`;
  const { engine } = await runtimeEvaluationHarness([modelAnswer]);
  engine._setDynamicActionClaimGroundingVerifierForTest({
    verify: async () => ({
      verdict: 'unavailable',
      evidenceIds: [],
      reasonCode: 'no_injected_evidence',
      verificationSource: 'continuation_grounding_verifier',
    }),
  });

  const answer = await engine.runWhatShouldISay('候选人询问远程政策', 0.9, undefined, {
    skipCooldown: true,
    source: 'dynamic_action',
    modeEvent: {
      actionId: 'candidate-concern-child',
      actionType: 'candidate_concern',
      parentActionId: 'candidate-concern-parent',
      productContract: { outputType: 'spoken_response' },
    },
    dynamicActionValidation: {
      actionType: 'candidate_concern',
      parentActionId: 'candidate-concern-parent',
      grounding: { groundedSources: [], injectedEvidence: [] },
      providerDataScopes: { transcript: true, reference_files: true },
      deferUserVisibleEmission: true,
      language: 'zh',
    },
  });

  assert.equal(answer, buildRecruitingPolicySafeFallback('zh'));
});

test('candidate concern substantive answers require both used material and supported verification', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const groundedSources = [{ evidenceId: 'recruiting-1', type: 'material', label: 'recruiting-policy.pdf', status: 'used' }];
  const answerText = 'This role is fully work-from-home.';
  const unsupported = evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_concern',
    outputType: 'spoken_response',
    answerText,
    groundedSources,
    claimGrounding: { verdict: 'unsupported', evidenceIds: [], reasonCode: 'claim_not_supported', verificationSource: 'continuation_grounding_verifier' },
  });
  assert.ok(unsupported.groundingFailures.includes('recruiting_policy_claim_not_supported_by_material'));

  const supported = evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_concern',
    outputType: 'spoken_response',
    answerText,
    groundedSources,
    claimGrounding: { verdict: 'supported', evidenceIds: ['recruiting-1'], reasonCode: 'claims_supported', verificationSource: 'continuation_grounding_verifier' },
  });
  assert.equal(supported.passed, true);
});

test('recruiting safety classifications reject equivalent Chinese and English expressions', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const cases = [
    ['visible_interview_method_classification', '这是一次压力测试'],
    ['visible_interview_method_classification', '当前采用结构化面试'],
    ['visible_interview_method_classification', 'This is a stress test interview.'],
    ['visible_interview_method_classification', 'Current method is structured interview.'],
    ['visible_interview_method_classification', 'We are conducting a pressure interview.'],
    ['final_hiring_judgment_or_ranking', 'we should hire her'],
    ['final_hiring_judgment_or_ranking', 'We should definitely hire her.'],
    ['final_hiring_judgment_or_ranking', 'Definitely hire this candidate.'],
    ['final_hiring_judgment_or_ranking', 'Reject this candidate.'],
    ['final_hiring_judgment_or_ranking', 'The candidate is not a fit.'],
    ['final_hiring_judgment_or_ranking', 'Rank her first.'],
    ['final_hiring_judgment_or_ranking', '她不适合这个岗位。'],
    ['final_hiring_judgment_or_ranking', '建议直接录用。'],
    ['final_hiring_judgment_or_ranking', '建议直接淘汰。'],
    ['final_hiring_judgment_or_ranking', '建议排第一。'],
    ['final_hiring_judgment_or_ranking', '直接录用。'],
    ['final_hiring_judgment_or_ranking', '淘汰她。'],
    ['final_hiring_judgment_or_ranking', 'Do not hire based on this alone, but definitely hire this candidate.'],
    ['final_hiring_judgment_or_ranking', '不要直接录用，但最终还是直接录用她。'],
    ['protected_class_basis', '候选人的国籍不符合团队要求。'],
    ['protected_class_basis', 'Women are not suitable for this role.'],
    ['protected_class_basis', '女性不适合出差。'],
    ['protected_class_basis', '已婚可能影响工作。'],
    ['protected_class_basis', 'Too old for the role.'],
    ['protected_class_basis', 'Marital status is a concern.'],
    ['protected_class_basis', 'Religion makes the candidate unstable.'],
    ['protected_class_basis', '宗教原因不稳定。'],
    ['protected_class_basis', 'Age does not affect hiring. Too old for the role.'],
    ['protected_class_basis', '不得将宗教作为录用依据。宗教原因不稳定。'],
    ['protected_class_basis', 'Age does not affect hiring, but she is too old for the role.'],
    ['protected_class_basis', '年龄不应影响录用，但她年龄太大所以不适合。'],
    ['protected_class_basis', '不得将宗教作为录用依据，但宗教原因让候选人不稳定。'],
    ['aggressive_recruiting_pressure', 'I do not believe you are capable.'],
    ['aggressive_recruiting_pressure', '你这个回答太差了。'],
    ['aggressive_recruiting_pressure', '你必须今天接受 offer。'],
    ['aggressive_recruiting_pressure', '今天必须接受录用通知。'],
    ['aggressive_recruiting_pressure', 'You must accept the offer today.'],
    ['aggressive_recruiting_pressure', 'You have to sign the offer now.'],
  ];
  for (const [failure, unsafeText] of cases) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_evidence_summary',
      outputType: 'spoken_response',
      answerText: `Evidence observed: candidate led the rollout. ${unsafeText}. Needs verification: metric definition.`,
      transcriptEvidence: ['candidate led the rollout'],
    });
    assert.ok(result.forbiddenPatternFailures.includes(failure), `${failure}: ${unsafeText}`);
  }
});

test('recruiting safety classifications allow ordinary job evidence descriptions', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const cases = [
    ['已观察证据：候选人负责跨国发布并处理高压项目。待验证：事故率口径。', '候选人负责跨国发布并处理高压项目。'],
    ['Evidence observed: candidate handled a high-pressure rollout and documented the test plan. Needs verification: metric definition.', 'candidate handled a high-pressure rollout and documented the test plan'],
    ['Evidence observed: candidate managed the migration and traced release failures. Needs verification: incident rate.', 'candidate managed the migration and traced release failures'],
    ['Evidence observed: candidate mentioned age; it must not be used in hiring. Needs verification: rollout scope.', 'candidate mentioned age; it must not be used in hiring during the rollout'],
    ['已观察证据：候选人提到年龄，但不得作为录用依据。待验证：发布范围。', '候选人提到年龄，但不得作为录用依据，并说明了发布范围。'],
    ['已观察证据：不要直接录用。待验证：岗位证据。', '不要直接录用，仍需核实岗位证据。'],
    ['已观察证据：不得据此淘汰。待验证：岗位证据。', '不得据此淘汰，仍需核实岗位证据。'],
    ['Evidence observed: candidate mentioned age; age does not affect hiring. Needs verification: rollout scope.', 'candidate mentioned age; age does not affect hiring during the rollout'],
    ['已观察证据：年龄不应影响录用。待验证：发布范围。', '年龄不应影响录用，仍需核实发布范围。'],
    ['已观察证据：不得将宗教作为录用依据。待验证：岗位证据。', '不得将宗教作为录用依据，仍需核实岗位证据。'],
  ];
  for (const [answerText, transcript] of cases) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_evidence_summary',
      outputType: 'spoken_response',
      answerText,
      transcriptEvidence: [transcript],
    });
    assert.equal(result.passed, true, answerText);
  }
});

test('candidate evidence transcript anchors ignore English stopwords and require matching numbers', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const cases = [
    {
      answerText: 'Evidence observed: candidate led the 50-person team. Needs verification: team scope.',
      transcriptEvidence: ['Candidate participated in the rollout.'],
      passed: false,
    },
    {
      answerText: 'Evidence observed: candidate led the Atlas rollout. Needs verification: rollout scope.',
      transcriptEvidence: ['Candidate explained how she led the Atlas rollout.'],
      passed: true,
    },
    {
      answerText: 'Evidence observed: candidate reduced incidents by 30%. Needs verification: measurement window.',
      transcriptEvidence: ['Candidate said she reduced incidents by 30 percent.'],
      passed: true,
    },
    {
      answerText: 'Evidence observed: candidate reduced incidents by 30%. Needs verification: measurement window.',
      transcriptEvidence: ['Candidate said she reduced incidents by 20%.'],
      passed: false,
    },
  ];
  for (const testCase of cases) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_evidence_summary',
      outputType: 'spoken_response',
      answerText: testCase.answerText,
      transcriptEvidence: testCase.transcriptEvidence,
    });
    assert.equal(result.passed, testCase.passed, testCase.answerText);
  }
});
