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
    ['final_hiring_judgment_or_ranking', 'The candidate is not a fit.'],
    ['final_hiring_judgment_or_ranking', 'Rank her first.'],
    ['final_hiring_judgment_or_ranking', '她不适合这个岗位。'],
    ['final_hiring_judgment_or_ranking', '建议直接录用。'],
    ['final_hiring_judgment_or_ranking', '建议直接淘汰。'],
    ['final_hiring_judgment_or_ranking', '建议排第一。'],
    ['protected_class_basis', '候选人的国籍不符合团队要求。'],
    ['protected_class_basis', 'Women are not suitable for this role.'],
    ['protected_class_basis', '女性不适合出差。'],
    ['protected_class_basis', '已婚可能影响工作。'],
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
