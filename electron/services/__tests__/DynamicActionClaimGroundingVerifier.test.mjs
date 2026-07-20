import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadVerifier() {
  return import(pathToFileURL(path.join(
    process.cwd(),
    'dist-electron/electron/services/dynamic-actions/DynamicActionClaimGroundingVerifier.js',
  )).href);
}

function input(overrides = {}) {
  return {
    answerText: '可以确认支持压降分析。',
    evidence: [{
      evidenceId: 'ev-1',
      type: 'material',
      label: 'capability.pdf',
      sourceId: 'm1',
      excerpt: '能力矩阵确认支持压降分析。',
    }],
    providerDataScopes: { transcript: true, reference_files: true },
    ...overrides,
  };
}

async function verifierReturning(payload) {
  const { DynamicActionClaimGroundingVerifier } = await loadVerifier();
  return new DynamicActionClaimGroundingVerifier(async () => JSON.stringify(payload));
}

async function verifierWithGenerator(generator) {
  const { DynamicActionClaimGroundingVerifier } = await loadVerifier();
  return new DynamicActionClaimGroundingVerifier(generator);
}

test('verifier accepts only claims supported by injected evidence ids', async () => {
  const supported = await (await verifierReturning({
    verdict: 'supported',
    evidenceIds: ['ev-1'],
    reasonCode: 'claims_supported',
  })).verify(input({ answerText: '可以确认支持压降分析。' }));
  assert.equal(supported.verdict, 'supported');

  const unrelated = await (await verifierReturning({
    verdict: 'unsupported',
    evidenceIds: [],
    reasonCode: 'claim_not_supported',
  })).verify(input({ answerText: '可以确认支持温升分析。' }));
  assert.equal(unrelated.verdict, 'unsupported');
});

test('verifier fails closed for unknown evidence ids, invalid json, timeout and scope denied', async () => {
  const unknown = await (await verifierReturning({
    verdict: 'supported',
    evidenceIds: ['not-injected'],
    reasonCode: 'claims_supported',
  })).verify(input());
  assert.equal(unknown.verdict, 'unavailable');
  assert.equal(unknown.reasonCode, 'verifier_invalid_json');

  const invalid = await (await verifierWithGenerator(async () => '{bad')).verify(input());
  assert.equal(invalid.reasonCode, 'verifier_invalid_json');

  const timeout = await (await verifierWithGenerator(async () => { throw new Error('timed out'); })).verify(input());
  assert.equal(timeout.reasonCode, 'verifier_timeout');

  let calls = 0;
  const denied = await (await verifierWithGenerator(async () => {
    calls += 1;
    return '{}';
  })).verify(input({ providerDataScopes: { transcript: false, reference_files: true } }));
  assert.equal(denied.reasonCode, 'provider_scope_denied');
  assert.equal(calls, 0);
});

test('recruiting verification is skipped only for explicit safe insufficiency answers', async () => {
  let calls = 0;
  const verifier = await verifierWithGenerator(async () => {
    calls += 1;
    return JSON.stringify({ verdict: 'supported', evidenceIds: ['ev-1'], reasonCode: 'claims_supported' });
  });
  const recruitingInput = {
    claimDomain: 'recruiting_policy',
    evidence: [],
    providerDataScopes: { transcript: true, reference_files: true },
  };
  const safeAnswers = [
    '当前招聘材料不足，不能确认这项政策。请向招聘负责人核实。',
    'The recruiting materials are not enough to confirm this policy. Please verify it with the recruiter.',
  ];
  for (const answerText of safeAnswers) {
    const verdict = await verifier.verify({ ...recruitingInput, answerText });
    assert.equal(verdict.verdict, 'not_required');
  }

  const substantiveAnswers = [
    '这个岗位无需到岗。',
    'This role is fully work-from-home.',
    '候选人可以九月入职。',
    'We will extend an offer.',
  ];
  for (const answerText of substantiveAnswers) {
    const verdict = await verifier.verify({ ...recruitingInput, answerText });
    assert.equal(verdict.verdict, 'unavailable', answerText);
    assert.equal(verdict.reasonCode, 'no_injected_evidence', answerText);
  }
  assert.equal(calls, 0);
});
