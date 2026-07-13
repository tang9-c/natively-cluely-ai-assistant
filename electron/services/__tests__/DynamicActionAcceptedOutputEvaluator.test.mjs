import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const evaluatorUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionAcceptedOutputEvaluator.js'),
).href;

async function load() {
  return import(evaluatorUrl);
}

test('pricing objection requires a speakable response and rejects invented discounts', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const passed = evaluateDynamicActionAcceptedOutput({
    actionType: 'pricing_objection',
    outputType: 'spoken_response',
    answerText: '我会先确认预算范围，再把价值和部署路径对齐。我们可以先用一个小范围 pilot 验证效果。',
    groundedSources: [{ type: 'transcript', label: 'customer objection', status: 'used' }],
  });
  const failed = evaluateDynamicActionAcceptedOutput({
    actionType: 'pricing_objection',
    outputType: 'spoken_response',
    answerText: '可以直接给 30% 折扣，ROI 至少 300%。',
    groundedSources: [{ type: 'transcript', label: 'customer objection', status: 'used' }],
  });

  assert.equal(passed.passed, true);
  assert.equal(failed.passed, false);
  assert.ok(failed.forbiddenPatternFailures.some((item) => /折扣|ROI/.test(item)));
});

test('quote request requires email draft placeholders and forbids invented commercial terms', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const result = evaluateDynamicActionAcceptedOutput({
    actionType: 'pricing_request',
    outputType: 'email_draft',
    answerText: 'Subject: Proposal follow-up for [CUSTOMER_NAME]\n\nHi [CUSTOMER_NAME],\nI will send the approved quote after confirming scope and [NEXT_STEP].',
    groundedSources: [{ type: 'transcript', label: 'quote request', status: 'used' }],
  });

  assert.equal(result.passed, true);
});

test('case study request requires trusted grounding or explicit no-match language', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const grounded = evaluateDynamicActionAcceptedOutput({
    actionType: 'case_study_request',
    outputType: 'spoken_response',
    answerText: '上传材料里的 case-study.md 提到 Halcyon Industries 用 pilot 验证了审批周期。',
    groundedSources: [{ type: 'material', label: 'case-study.md', status: 'used' }],
  });
  const ungrounded = evaluateDynamicActionAcceptedOutput({
    actionType: 'case_study_request',
    outputType: 'spoken_response',
    answerText: '我们有很多 Fortune 500 客户，ROI 都很高。',
    groundedSources: [],
  });
  const noMatch = evaluateDynamicActionAcceptedOutput({
    actionType: 'case_study_request',
    outputType: 'spoken_response',
    answerText: '我现在没有在已上传资料里找到匹配案例，先不编客户名。可以会后补充材料。',
    groundedSources: [{ type: 'material', label: 'case-study', status: 'not_found' }],
  });

  assert.equal(grounded.passed, true);
  assert.equal(ungrounded.passed, false);
  assert.equal(noMatch.passed, true);
});

test('technical requirements require checklist and forbid capability promises', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const result = evaluateDynamicActionAcceptedOutput({
    actionType: 'technical_requirements',
    outputType: 'checklist',
    answerText: '- API: confirm endpoint and auth\n- SSO: confirm SAML/OIDC\n- Environment: confirm sandbox and production\n- Validation: run one test workflow',
    groundedSources: [{ type: 'transcript', label: 'technical request', status: 'used' }],
  });
  const failed = evaluateDynamicActionAcceptedOutput({
    actionType: 'technical_requirements',
    outputType: 'checklist',
    answerText: '我们一定支持你们所有 API 和 SSO 场景。',
    groundedSources: [{ type: 'transcript', label: 'technical request', status: 'used' }],
  });

  assert.equal(result.passed, true);
  assert.equal(failed.passed, false);
});

test('buying signal requires owner date and artifact or direct missing-field question', async () => {
  const { evaluateDynamicActionAcceptedOutput } = await load();
  const complete = evaluateDynamicActionAcceptedOutput({
    actionType: 'buying_signal',
    outputType: 'action_item',
    answerText: 'Owner: Maya\nDate: Friday\nArtifact: pilot proposal',
    groundedSources: [{ type: 'transcript', label: 'buying signal', status: 'used' }],
  });
  const question = evaluateDynamicActionAcceptedOutput({
    actionType: 'buying_signal',
    outputType: 'action_item',
    answerText: '我需要确认 owner、date 和 artifact，才能把下一步写成行动项。',
    missingFields: ['owner', 'date', 'artifact'],
    groundedSources: [{ type: 'transcript', label: 'buying signal', status: 'used' }],
  });

  assert.equal(complete.passed, true);
  assert.equal(question.passed, true);
});

test('capability fit answer requires injected evidence and supported claim verdict', async () => {
  const { evaluateDynamicActionAcceptedOutput, buildCapabilityFitSafeFallback } = await load();
  const supported = evaluateDynamicActionAcceptedOutput({
    actionType: 'capability_fit_answer',
    outputType: 'spoken_response',
    answerText: '根据能力矩阵，可以确认支持压降分析；温升建议用样本做 PoC 验证。',
    groundedSources: [{ evidenceId: 'ev-1', type: 'material', label: 'capability.pdf', status: 'used' }],
    claimGrounding: {
      verdict: 'supported',
      evidenceIds: ['ev-1'],
      reasonCode: 'claims_supported',
      verificationSource: 'continuation_grounding_verifier',
    },
  });
  assert.equal(supported.passed, true);

  const unsupported = evaluateDynamicActionAcceptedOutput({
    actionType: 'capability_fit_answer',
    outputType: 'spoken_response',
    answerText: '根据材料，可以确认支持温升分析。',
    groundedSources: [{ evidenceId: 'ev-1', type: 'material', label: 'capability.pdf', status: 'used' }],
    claimGrounding: {
      verdict: 'unsupported',
      evidenceIds: [],
      reasonCode: 'claim_not_supported',
      verificationSource: 'continuation_grounding_verifier',
    },
  });
  assert.ok(unsupported.groundingFailures.includes('capability_claim_not_supported_by_injected_evidence'));

  const safeFallback = evaluateDynamicActionAcceptedOutput({
    actionType: 'capability_fit_answer',
    outputType: 'spoken_response',
    answerText: buildCapabilityFitSafeFallback('zh'),
    groundedSources: [],
    claimGrounding: {
      verdict: 'not_required',
      evidenceIds: [],
      reasonCode: 'no_positive_capability_claim',
      verificationSource: 'continuation_grounding_verifier',
    },
  });
  assert.equal(safeFallback.passed, true);

  const overClaim = evaluateDynamicActionAcceptedOutput({
    actionType: 'capability_fit_answer',
    outputType: 'spoken_response',
    answerText: '我们支持自动写回 PLM，并且 ROI 至少 30%。',
    groundedSources: [{ evidenceId: 'ev-1', type: 'material', label: 'capability.pdf', status: 'used' }],
    claimGrounding: {
      verdict: 'supported',
      evidenceIds: ['ev-1'],
      reasonCode: 'claims_supported',
      verificationSource: 'continuation_grounding_verifier',
    },
  });
  assert.ok(overClaim.forbiddenPatternFailures.includes('invented_customer_roi_price_or_terms'));
  assert.ok(overClaim.forbiddenPatternFailures.includes('automatic_writeback_claim'));
});
