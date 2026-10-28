import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const validation = require('../../../dist-electron/electron/services/onboarding/OnboardingValidation.js');
const { OnboardingService } = require('../../../dist-electron/electron/services/onboarding/OnboardingService.js');
const { CodexCliService } = require('../../../dist-electron/electron/services/CodexCliService.js');
function executor(config, request) {
  assert.equal(typeof validation.createAiExecutor, 'function', 'selected AI validator is missing');
  return validation.createAiExecutor({ readSavedConfig: () => config, post: request, validateCodex: (...args) => CodexCliService.validateInference(...args) });
}
const check = { provider: 'doubao', modelId: 'doubao-selected', configIdentity: 'v1', status: 'missing' };
test('uses saved selected model and dedicated key, fixed short input, no tools or fallback', async () => {
  const requests = []; const signal = new AbortController().signal;
  const run = executor({ ...check, apiKey: 'saved-llm-key', transcriptAllowed: true }, async (...args) => {
    requests.push(args); return { status: 200, data: { choices: [{ message: { content: 'OK' } }] } };
  });
  const evidence = await run(check, signal); assert.deepEqual(evidence, { provider: 'doubao', modelId: 'doubao-selected', depth: 'model_response' });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0][1], { model: 'doubao-selected', messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16 });
  assert.equal(requests[0][2].headers.Authorization, 'Bearer saved-llm-key'); assert.equal(requests[0][2].signal, signal);
});
test('scope denial and unsupported selected providers make no external request', async () => {
  let requests = 0;
  const request = async () => { requests++; throw new Error('must not call'); };
  for (const [config, expected] of [[{ ...check, transcriptAllowed: false }, 'scope_denied'],
    [{ ...check, provider: 'custom', transcriptAllowed: true }, 'unsupported_check']]) {
    const run = executor(config, request);
    await assert.rejects(run({ ...check, provider: config.provider }, new AbortController().signal), e => e.code === expected);
  }
  assert.equal(requests, 0);
});
for (const [status, expected] of [[401, 'authentication_failed'], [403, 'authentication_failed'], [404, 'model_unavailable'], [429, 'model_unavailable'], [503, 'network_error']]) {
  test(`HTTP ${status} is classified without leaking provider response`, async () => {
    const run = executor({ ...check, apiKey: 'private-key', transcriptAllowed: true }, async () => { throw { response: { status, data: 'private provider body' } }; });
    await assert.rejects(run(check, new AbortController().signal), e => e.code === expected && !e.message.includes('private'));
  });
}
test('empty response, wrong model and changed saved selection cannot verify', async () => {
  const config = { ...check, apiKey: 'key', transcriptAllowed: true };
  for (const response of [{ status: 200, data: {} }, { status: 200, data: { model: 'wrong', choices: [{ message: { content: 'OK' } }] } }]) {
    await assert.rejects(executor(config, async () => response)(check, new AbortController().signal), e => e.code === 'model_unavailable');
  }
  await assert.rejects(executor({ ...config, modelId: 'changed' }, () => { throw new Error('must not request'); })(check, new AbortController().signal), e => e.code === 'stale_config');
});
test('Codex executable presence is never inference success; unaudited isolation is unsupported without spawning normal run', async () => {
  assert.equal(typeof CodexCliService.validateInference, 'function', 'isolated inference boundary is missing');
  const result = await CodexCliService.validateInference({ enabled: true, path: '/must-not-execute', model: 'selected', timeoutMs: 60000, sandboxMode: 'read-only' }, new AbortController().signal);
  assert.equal(result.success, false); assert.equal(result.errorCode, 'unsupported_check');
  const run = executor({ provider: 'codex', modelId: 'codex-cli', transcriptAllowed: true,
    codex: { enabled: true, path: '/must-not-execute', model: 'selected', timeoutMs: 60000, sandboxMode: 'read-only' } }, () => { throw new Error('no HTTP fallback'); });
  await assert.rejects(run({ provider: 'codex', modelId: 'codex-cli' }, new AbortController().signal), e => e.code === 'unsupported_check');
});
test('AI shares 60-second cancellation and busy retention with STT; late output cannot persist success', async () => {
  let timer, signal, resolve; const pendingRequest = new Promise(r => resolve = r); let stored;
  const service = new OnboardingService({ load: () => stored, save: p => stored = p, now: () => 1, platform: () => 'test',
    readLegacyEvidence: () => ({ hasNonDemoMeeting: false, hasSavedServiceConfiguration: false }),
    readChecks: async () => { throw new Error('not used'); }, readConfiguration: () => check });
  service.initialize({ legacySeenStartup: false, legacyPermissionsShown: false });
  const validator = new validation.OnboardingValidation({ service, isBusy: () => false,
    execute: (_t, _c, s) => { signal = s; return pendingRequest; }, setTimeout: fn => timer = fn, clearTimeout() {} });
  const first = validator.validate('ai', 0); await new Promise(setImmediate); timer();
  assert.equal((await first).errorCode, 'timeout'); assert.equal(signal.aborted, true);
  assert.equal((await validator.validate('ai', 0)).errorCode, 'busy');
  resolve({ provider: 'doubao', modelId: 'doubao-selected', depth: 'model_response' }); await new Promise(setImmediate);
  assert.equal(service.getSnapshot().progress.validationReceipts.ai.result, 'failed');
});
