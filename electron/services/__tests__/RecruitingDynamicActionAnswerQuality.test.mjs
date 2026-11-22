import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const evaluatorUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/electron/services/dynamic-actions/DynamicActionAcceptedOutputEvaluator.js'),
).href;

const unsafeEvidenceSummaries = [
  '当前是 BEI 面试。已观察证据：候选人完成了发布。待验证：结果。',
  '当前是压力面试。已观察证据：候选人完成了发布。待验证：结果。',
  'current method is structured interview. Evidence observed: the candidate shipped the service. Missing: impact.',
  '你这个回答太差了。已观察证据：候选人完成了发布。待验证：结果。',
  '你根本不具备能力。已观察证据：候选人完成了发布。待验证：结果。',
  'I do not believe you are capable. Evidence observed: the candidate shipped the service. Missing: impact.',
  '建议直接录用。已观察证据：候选人完成了发布。待验证：结果。',
  '建议淘汰。已观察证据：候选人完成了发布。待验证：结果。',
  '排名第一。已观察证据：候选人完成了发布。待验证：结果。',
  'definitely hire this candidate. Evidence observed: the candidate shipped the service. Missing: impact.',
  'reject this candidate. Evidence observed: the candidate shipped the service. Missing: impact.',
  '年龄太大所以不适合。已观察证据：候选人完成了发布。待验证：结果。',
  '女性不适合出差。已观察证据：候选人完成了发布。待验证：结果。',
  '已婚可能影响工作。已观察证据：候选人完成了发布。待验证：结果。',
  '宗教原因不稳定。已观察证据：候选人完成了发布。待验证：结果。',
  'too old for the role. Evidence observed: the candidate shipped the service. Missing: impact.',
  'women are not suitable. Evidence observed: the candidate shipped the service. Missing: impact.',
  'marital status is a concern. Evidence observed: the candidate shipped the service. Missing: impact.',
];

const unsafePolicyAnswers = [
  '保证办理签证。',
  '保证永久远程。',
  '薪资确定为具体金额 50000 元。',
  'offer 一周内一定发出。',
  'We guarantee visa sponsorship.',
  'We guarantee permanent remote work.',
  'The salary is exactly $120,000.',
  'We will definitely send an offer within one week.',
];

test('recruiting accepted-output evaluator blocks concrete unsafe answer matrix', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(evaluatorUrl);

  for (const answerText of unsafeEvidenceSummaries) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_evidence_summary',
      outputType: 'checklist',
      answerText,
      transcriptEvidence: ['候选人完成了发布', 'the candidate shipped the service'],
    });
    assert.equal(result.passed, false, answerText);
  }
  for (const answerText of unsafePolicyAnswers) {
    const result = evaluateDynamicActionAcceptedOutput({
      actionType: 'candidate_concern',
      outputType: 'spoken_response',
      answerText,
      groundedSources: [],
    });
    assert.equal(result.passed, false, answerText);
  }
});

test('experience probe accepts one neutral question with a verbatim candidate quote', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(evaluatorUrl);
  const transcriptEvidence = ['最后我们协调好了，按时上线了。'];
  const evaluate = (answerText) => evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_experience_probe',
    outputType: 'spoken_response',
    answerText,
    transcriptEvidence,
  });

  assert.equal(evaluate('你发现可能延期后，先做了什么？「最后我们协调好了，按时上线了。」').passed, true);
  const twoQuestions = evaluate('你先做了什么？结果如何？「最后我们协调好了」');
  assert.ok(twoQuestions.requiredPatternFailures.includes('candidate_experience_probe_single_question'));
  const invented = evaluate('你先做了什么？「我们提前两周就发现了风险」');
  assert.ok(invented.groundingFailures.includes('candidate_experience_probe_requires_verbatim_quote'));
  const unquoted = evaluate('你发现可能延期后，先做了什么？');
  assert.ok(unquoted.groundingFailures.includes('candidate_experience_probe_requires_verbatim_quote'));
  assert.equal(evaluate('建议直接录用。你先做了什么？「最后我们协调好了」').passed, false);
  assert.equal(evaluate('年龄太大所以不适合。你先做了什么？「最后我们协调好了」').passed, false);
});

test('experience probe falls back to a neutral question', async () => {
  const policyUrl = pathToFileURL(
    path.join(process.cwd(), 'dist-electron/electron/services/dynamic-actions/DynamicActionRuntimeValidationPolicy.js'),
  ).href;
  const { buildDynamicActionRuntimeSafeFallback, getDynamicActionRuntimeValidationPolicy } = await import(policyUrl);

  assert.equal(getDynamicActionRuntimeValidationPolicy('candidate_experience_probe')?.evidenceKind, 'transcript_evidence');
  assert.equal(buildDynamicActionRuntimeSafeFallback('candidate_experience_probe', 'zh'), '能具体说说当时你本人做了什么吗？');
  assert.match(buildDynamicActionRuntimeSafeFallback('candidate_experience_probe', 'en'), /personally did/);
});

test('recruiting accepted-output evaluator permits job-related summaries without protected-class basis', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await import(evaluatorUrl);
  const result = evaluateDynamicActionAcceptedOutput({
    actionType: 'candidate_evidence_summary',
    outputType: 'checklist',
    answerText: '已观察证据：候选人主动提到需要照顾家人，并描述了负责发布和复盘的经历。待验证：该发布的影响指标与个人贡献。',
    transcriptEvidence: ['我需要照顾家人，但我负责了服务发布和复盘。'],
  });

  assert.equal(result.passed, true);
});
