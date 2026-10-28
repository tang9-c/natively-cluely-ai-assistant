import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const policy = require('../../../dist-electron/shared/onboarding.js');
export function snapshot() {
  const receipt = target => ({ target, provider: 'doubao', configRevision: 0, configIdentity: target,
    checkedAt: 1, depth: 'model_response', result: 'passed' });
  return { stateRevision: 0, progress: { version: 1, origin: 'fresh', lastStep: 'overview',
    meetingHintsDismissed: { transcript: false, answer: false }, acceptedSystemAudioLimitation: false,
    configRevision: { stt: 0, ai: 0 }, validationReceipts: { stt: receipt('stt'), ai: receipt('ai') } },
    devices: {}, checks: { microphone: { status: 'verified' }, inputDevice: { status: 'verified' },
      systemAudio: { status: 'verified' }, stt: { status: 'verified', configIdentity: 'stt' },
      ai: { status: 'verified', configIdentity: 'ai' } },
    meeting: { isActive: false, isStarting: false, generation: 0, phase: 'idle', hasTranscript: false }, downloads: [] };
}
for (const [name, mutate, step] of [
  ['microphone denied', s => s.checks.microphone.status = 'failed', 'permissions'],
  ['device missing', s => s.checks.inputDevice.status = 'missing', 'permissions'],
  ['audio limitation unacknowledged', s => s.checks.systemAudio.status = 'limited', 'permissions'],
  ['speech checking', s => s.checks.stt.status = 'checking', 'speech'],
  ['speech pending runtime', s => s.checks.stt.status = 'pending_runtime', 'speech'],
  ['AI scope denied', s => Object.assign(s.checks.ai, { status: 'failed', errorCode: 'scope_denied' }), 'ai'],
  ['AI unsupported', s => s.checks.ai.status = 'unsupported', 'ai'],
  ['stale receipt', s => s.progress.configRevision.stt++, 'speech'],
  ['changed identity', s => s.checks.ai.configIdentity = 'changed', 'ai'],
  ['failed receipt', s => s.progress.validationReceipts.ai.result = 'failed', 'ai'],
  ['no receipt', s => delete s.progress.validationReceipts.stt, 'speech'],
  ['selected model downloading', s => { s.checks.stt.modelId = 'sensevoice'; s.downloads.push({ modelId: 'sensevoice', status: 'running' }); }, 'speech'],
]) test(name, () => {
  const s = snapshot(); mutate(s);
  assert.deepEqual(policy.derivePreparationDecision(s), { allowed: false, recoveryStep: step });
  assert.deepEqual(policy.deriveFirstRunStartDecision(s), { allowed: false, recoveryStep: step });
});
test('only fresh incomplete users require first-run gating', () => {
  const s = snapshot(); assert.equal(policy.requiresFirstRunGate(s.progress), true);
  for (const change of [{ origin: 'existing' }, { configurationCompletedAt: 1 }]) {
    Object.assign(s.progress, change); s.checks.ai.status = 'failed';
    assert.equal(policy.requiresFirstRunGate(s.progress), false);
    assert.equal(policy.deriveFirstRunStartDecision(s).allowed, true);
    assert.equal(policy.derivePreparationDecision(s).allowed, false);
  }
});
test('active/starting meetings reuse existing startup while preparation stays truthful', () => {
  for (const key of ['isActive', 'isStarting']) {
    const s = snapshot(); s.meeting[key] = true; s.checks.ai.status = 'failed';
    assert.equal(policy.deriveFirstRunStartDecision(s).allowed, true);
    assert.equal(policy.derivePreparationDecision(s).allowed, false);
  }
});
test('historical verification and passive permission evidence can pass', () => {
  const s = snapshot();
  s.checks.stt.status = s.checks.ai.status = 'previously_verified';
  s.checks.microphone.status = s.checks.systemAudio.status = 'pending_runtime';
  assert.deepEqual(policy.derivePreparationDecision(s), { allowed: true });
  s.checks.systemAudio.status = 'limited'; s.progress.acceptedSystemAudioLimitation = true;
  assert.equal(policy.derivePreparationDecision(s).allowed, true);
});
test('receipt validity requires passed result, exact revision and nonempty identity', () => {
  const r = snapshot().progress.validationReceipts.ai;
  assert.equal(policy.isReceiptCurrent(r, 0, 'ai'), true);
  for (const [receipt, rev, id] of [[r, 1, 'ai'], [r, 0, 'other'], [{ ...r, result: 'failed' }, 0, 'ai'], [{ ...r, configIdentity: '' }, 0, '']]) {
    assert.equal(policy.isReceiptCurrent(receipt, rev, id), false);
  }
});

test('AI requires an actual selected-model response, not credential-only access', () => {
  const s = snapshot(); s.progress.validationReceipts.ai.depth = 'credential_access';
  assert.deepEqual(policy.derivePreparationDecision(s), { allowed: false, recoveryStep: 'ai' });
});
