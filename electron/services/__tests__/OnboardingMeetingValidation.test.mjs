import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mainMethods } from './helpers/onboardingRuntime.mjs';

const require = createRequire(import.meta.url);
const { OnboardingService } = require('../../../dist-electron/electron/services/onboarding/OnboardingService.js');
const { OnboardingValidation } = require('../../../dist-electron/electron/services/onboarding/OnboardingValidation.js');
const { supportsInMeetingValidation } = require('../../../dist-electron/shared/onboarding.js');

function harness(target = 'stt', provider = 'qcloud-stt', execute, errorCode) {
  const State = mainMethods(['isOnboardingBusy'], { supportsInMeetingValidation });
  const state = new State();
  state.isMeetingActive = true;
  let stored;
  const service = new OnboardingService({
    load: () => stored, save: value => { stored = value; }, platform: () => 'darwin', now: () => 1,
    readLegacyEvidence: () => ({ hasNonDemoMeeting: false, hasSavedServiceConfiguration: false }),
    readConfiguration: () => ({ configured: true, provider, modelId: provider === 'natively' ? 'natively' : 'selected', configIdentity: 'saved-config', ...(errorCode ? { errorCode } : {}) }),
    readChecks: async () => { throw new Error('not used'); },
  });
  service.initialize({ legacySeenStartup: false, legacyPermissionsShown: false });
  const validator = new OnboardingValidation({ service,
    isBusy: (target, check) => state.isOnboardingBusy({ target, check }),
    execute: execute ?? (async (_target, check) => ({ provider: check.provider, modelId: check.modelId, depth: target === 'stt' ? 'credential_access' : 'model_response' })),
  });
  return { state, service, validator };
}

for (const [target, provider] of [['stt', 'qcloud-stt'], ['stt', 'doubao-auc'], ['stt', 'openai'], ['stt', 'groq'], ['stt', 'azure'], ['stt', 'ibmwatson'], ['ai', 'natively'], ['ai', 'doubao']]) {
  test(`active meeting validates saved ${target}/${provider} and records the result`, async () => {
    const { validator, service, state } = harness(target, provider);
    assert.equal((await validator.validate(target, 0)).success, true);
    assert.equal(service.getSnapshot().progress.validationReceipts[target].result, 'passed');
    assert.equal(state.isOnboardingBusy(), true, 'configuration mutations remain blocked');
  });
}

test('local and CLI validation stay blocked, as do meeting startup, draining and capture tests', async () => {
  for (const [target, provider] of [['stt', 'local-sensevoice'], ['stt', 'local-whisper'], ['ai', 'codex-cli'], ['ai', 'custom']]) {
    const { validator } = harness(target, provider, () => { throw new Error('must not execute'); });
    assert.equal((await validator.validate(target, 0)).errorCode, 'busy');
  }
  for (const flag of ['_meetingStartInFlight', '_isDraining', 'preparationDictation', 'audioTestCapture']) {
    const { state, validator } = harness('stt', 'qcloud-stt', () => { throw new Error('must not execute'); });
    state[flag] = true;
    assert.equal((await validator.validate('stt', 0)).errorCode, 'busy', flag);
  }
});

test('cloud validation shares identical requests and keeps timed-out work busy until it ends', async () => {
  let finish, expire, signal;
  const pending = new Promise(resolve => { finish = resolve; });
  const { state, service } = harness();
  const validator = new OnboardingValidation({ service,
    isBusy: (target, check) => state.isOnboardingBusy({ target, check }),
    execute: (_target, _check, abortSignal) => { signal = abortSignal; return pending; },
    setTimeout: callback => { expire = callback; }, clearTimeout() {},
  });
  const first = validator.validate('stt', 0);
  assert.equal(validator.validate('stt', 0), first);
  await new Promise(setImmediate);
  expire();
  assert.equal((await first).errorCode, 'timeout');
  assert.equal(signal.aborted, true);
  assert.equal((await validator.validate('stt', 0)).errorCode, 'busy');
  finish({ provider: 'qcloud-stt', modelId: 'selected', depth: 'credential_access' });
  await new Promise(setImmediate);
  assert.equal(service.getSnapshot().progress.validationReceipts.stt.result, 'failed');
});

test('cloud checks still respect scope denial and become busy if capture starts before settlement', async () => {
  const denied = harness('ai', 'natively', () => { throw new Error('must not execute'); }, 'scope_denied');
  assert.equal((await denied.validator.validate('ai', 0)).errorCode, 'scope_denied');
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { state, validator, service } = harness('stt', 'qcloud-stt', () => pending);
  const result = validator.validate('stt', 0);
  await new Promise(setImmediate);
  state.audioTestCapture = {};
  finish({ provider: 'qcloud-stt', modelId: 'selected', depth: 'credential_access' });
  assert.equal((await result).errorCode, 'busy');
  assert.equal(service.getSnapshot().progress.validationReceipts.stt.result, 'failed');
});

test('cloud validation preserves authentication failures and rejects a changed configuration', async () => {
  const auth = harness('stt', 'qcloud-stt', async () => { throw { status: 401 }; });
  assert.equal((await auth.validator.validate('stt', 0)).errorCode, 'authentication_failed');
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { validator, service } = harness('stt', 'qcloud-stt', () => pending);
  const result = validator.validate('stt', 0);
  await new Promise(setImmediate);
  service.invalidate('stt');
  finish({ provider: 'qcloud-stt', modelId: 'selected', depth: 'credential_access' });
  assert.equal((await result).errorCode, 'stale_config');
  assert.equal(service.getSnapshot().progress.validationReceipts.stt, undefined);
});
