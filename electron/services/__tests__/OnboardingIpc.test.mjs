import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OnboardingService } = require('../../../dist-electron/electron/services/onboarding/OnboardingService.js');
let register;
try { ({ registerOnboardingHandlers: register } = require('../../../dist-electron/electron/services/onboarding/registerOnboardingHandlers.js')); }
catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
function harness() {
  assert.equal(typeof register, 'function', 'onboarding IPC registration is missing');
  let stored; const handlers = new Map(), broadcasts = [], navigation = [];
  const service = new OnboardingService({ load: () => stored, save: p => stored = p,
    readLegacyEvidence: () => ({ hasNonDemoMeeting: false, hasSavedServiceConfiguration: false }),
    readChecks: async () => ({ microphone: { status: 'pending_runtime' }, inputDevice: { status: 'verified' },
      systemAudio: { status: 'pending_runtime' }, stt: { status: 'missing' }, ai: { status: 'missing' } }), now: () => 100, platform: () => 'test' });
  const deps = { safeHandle: (name, fn) => handlers.set(name, fn), service,
    validator: { validate: async () => ({ success: false, errorCode: 'unsupported_check', messageKey: 'onboarding.unsupported_check' }) },
    getSenderRole: event => ({ 1: 'launcher', 2: 'settings', 3: 'overlay' })[event.sender.id],
    openLauncher: input => navigation.push(input), broadcast: (name, value) => broadcasts.push([name, value]) };
  register(deps);
  const invoke = (id, name, ...args) => handlers.get(name)({ sender: { id } }, ...args);
  return { service, handlers, broadcasts, navigation, invoke, deps };
}
const initialize = { type: 'initialize', legacySeenStartup: false, legacyPermissionsShown: false };
test('unknown windows cannot read, initialize, validate or navigate, regardless of their claimed URL', async () => {
  const h = harness();
  for (const [name, arg] of [['get-onboarding-state'], ['update-onboarding-progress', initialize],
    ['validate-onboarding-service', { target: 'ai', expectedRevision: 0 }], ['open-onboarding', { step: 'ai' }]]) {
    assert.equal((await h.invoke(99, name, arg)).success, false);
  }
  assert.throws(() => h.service.getSnapshot(), e => e.code === 'initialization_required');
});
test('only Launcher initializes/navigates; overlay can dismiss hints; private fields and invalid actions are rejected', async () => {
  const h = harness();
  assert.equal((await h.invoke(2, 'update-onboarding-progress', initialize)).errorCode, 'forbidden');
  assert.equal((await h.invoke(1, 'update-onboarding-progress', initialize)).success, true);
  assert.equal((await h.invoke(3, 'update-onboarding-progress', { type: 'navigate', step: 'ai' })).errorCode, 'forbidden');
  assert.equal((await h.invoke(3, 'update-onboarding-progress', { type: 'dismiss-hint', hint: 'answer' })).success, true);
  assert.equal((await h.invoke(1, 'update-onboarding-progress', { type: 'defer', configurationCompletedAt: 1 })).errorCode, 'invalid_request');
  assert.equal(h.service.getSnapshot().progress.configurationCompletedAt, undefined);
});
test('pre-initialization/state errors use the result union; non-Launcher device projections cannot overwrite selection', async () => {
  const h = harness(); assert.equal((await h.invoke(1, 'get-onboarding-state')).errorCode, 'initialization_required');
  await h.invoke(1, 'update-onboarding-progress', initialize);
  await h.invoke(1, 'get-onboarding-state', { inputDeviceId: 'saved' });
  assert.equal((await h.invoke(3, 'get-onboarding-state', { inputDeviceId: 'other' })).errorCode, 'forbidden');
  const s = await h.invoke(3, 'get-onboarding-state'); assert.equal(s.snapshot.devices.inputDeviceId, 'saved');
  assert.equal((await h.invoke(1, 'get-onboarding-state', { inputDeviceId: 12 })).errorCode, 'invalid_request');
});
test('opening onboarding uses restricted cross-window navigation without persisting lastStep', async () => {
  const h = harness(); await h.invoke(1, 'update-onboarding-progress', initialize);
  assert.equal((await h.invoke(2, 'open-onboarding', { step: 'speech' })).success, true);
  assert.equal(h.navigation[0].step, 'speech'); assert.equal(h.service.getSnapshot().progress.lastStep, 'overview');
  assert.equal((await h.invoke(2, 'open-onboarding', { step: 'bad' })).success, false);
});
test('state broadcasts are snapshots, subscriptions replace previous registration and contain no secret inputs', async () => {
  const h = harness(); register(h.deps);
  await h.invoke(1, 'update-onboarding-progress', initialize);
  const before = h.broadcasts.length; await h.invoke(1, 'update-onboarding-progress', { type: 'navigate', step: 'ai' });
  assert.equal(h.broadcasts.length, before + 1);
  assert.deepEqual(h.broadcasts.at(-1)[1], h.service.getSnapshot());
  assert.doesNotMatch(JSON.stringify(h.broadcasts), /apiKey|transcriptText|promptBody/);
});

test('passive readiness re-enumerates devices and does not certify static development grants', async () => {
  const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');
  let inputs = [{ id: 'saved', name: 'saved' }];
  const read = createOnboardingReadinessReader({ isPackaged: () => false,
    readPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen: 'granted', systemAudioHealth: { effectiveGranted: true } }),
    inputDevices: () => inputs, outputDevices: () => [{ id: 'default', name: 'default' }], speechCheck: () => ({ status: 'missing' }) });
  assert.equal((await read({ inputDeviceId: 'saved' })).microphone.status, 'pending_runtime');
  assert.equal((await read()).systemAudio.evidenceSource, 'unavailable');
  inputs = []; assert.equal((await read({ inputDeviceId: 'saved' })).inputDevice.errorCode, 'device_missing');
});
test('one failed passive check does not discard other readiness rows', async () => {
  const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');
  const read = createOnboardingReadinessReader({ isPackaged: () => true,
    readPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen: 'granted' }),
    inputDevices: () => [{ id: 'default', name: 'default' }], outputDevices: () => [{ id: 'default', name: 'default' }],
    speechCheck: () => { throw new Error('private file error'); } });
  const snapshot = await read(); assert.equal(snapshot.microphone.status, 'verified'); assert.equal(snapshot.stt.status, 'failed');
  assert.equal(snapshot.ai.status, 'missing'); assert.doesNotMatch(JSON.stringify(snapshot), /private file/);
});

test('unprobed audio clears an obsolete limitation acknowledgement without claiming authorization', async () => {
  const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');
  let screen = 'denied';
  const h = harness();
  h.service.setCheckReader(async () => ({ microphone: { status: 'verified' }, inputDevice: { status: 'verified' },
    systemAudio: { status: 'limited', errorCode: 'permission_denied', evidenceSource: 'runtime' }, stt: { status: 'missing' }, ai: { status: 'missing' } }));
  await h.invoke(1, 'update-onboarding-progress', initialize);
  await h.invoke(1, 'update-onboarding-progress', { type: 'acknowledge-system-audio-limitation' });
  assert.equal(h.service.getSnapshot().progress.acceptedSystemAudioLimitation, true);
  h.service.setCheckReader(createOnboardingReadinessReader({ isPackaged: () => true,
    readPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen }),
    inputDevices: () => [{ id: 'default' }], outputDevices: () => [{ id: 'default' }], speechCheck: () => ({ status: 'missing' }) }));
  const restored = await h.service.refreshChecks();
  assert.equal(restored.checks.systemAudio.status, 'pending_runtime');
  assert.equal(restored.checks.systemAudio.evidenceSource, 'unavailable');
  assert.equal(restored.progress.acceptedSystemAudioLimitation, false);
  await h.invoke(1, 'update-onboarding-progress', { type: 'navigate', step: 'speech' });
  assert.equal(h.service.getSnapshot().progress.acceptedSystemAudioLimitation, false);
  screen = 'granted'; await h.service.refreshChecks();
  screen = 'denied'; await h.service.refreshChecks();
  assert.equal(h.service.getSnapshot().progress.acceptedSystemAudioLimitation, false);
});

test('screen-derived positive health cannot certify unprobed system audio authorization', async () => {
  const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');
  const read = createOnboardingReadinessReader({ isPackaged: () => true,
    readPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen: 'not-determined', systemAudioHealth: { effectiveGranted: true } }),
    inputDevices: () => [{ id: 'default' }], outputDevices: () => [{ id: 'default' }], speechCheck: () => ({ status: 'missing' }) });
  const check = (await read()).systemAudio;
  assert.equal(check.status, 'pending_runtime'); assert.equal(check.evidenceSource, 'unavailable');
  assert.equal(check.errorCode, undefined);
});

for (const screen of ['unknown', 'not-determined', 'denied', 'restricted', 'granted']) test(`passive macOS screen permission ${screen} cannot determine system audio access`, async () => {
  const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');
  const read = createOnboardingReadinessReader({ isPackaged: () => true,
    readPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen, systemAudioHealth: { effectiveGranted: screen === 'granted' } }),
    inputDevices: () => [{ id: 'default' }], outputDevices: () => [{ id: 'default' }], speechCheck: () => ({ status: 'missing' }) });
  const check = (await read()).systemAudio;
  assert.equal(check.status, 'pending_runtime'); assert.equal(check.evidenceSource, 'unavailable'); assert.equal(check.errorCode, undefined);
});

test('a failed permission read remains an error rather than an audio grant or a screen denial', async () => {
  const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');
  const read = createOnboardingReadinessReader({ isPackaged: () => true,
    readPermissions: async () => { throw new Error('permission reader unavailable'); },
    inputDevices: () => [{ id: 'default' }], outputDevices: () => [{ id: 'default' }], speechCheck: () => ({ status: 'missing' }) });
  const checks = await read();
  assert.equal(checks.systemAudio.status, 'failed'); assert.equal(checks.systemAudio.errorCode, 'unsupported_check');
  assert.equal(checks.microphone.errorCode, 'unsupported_check'); assert.equal(checks.inputDevice.status, 'verified');
});
test('positive system audio authorization does not hide a missing output device', async () => {
  const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');
  const read = createOnboardingReadinessReader({ isPackaged: () => true,
    readPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen: 'granted', systemAudioHealth: { effectiveGranted: true } }),
    inputDevices: () => [{ id: 'default' }], outputDevices: () => [], speechCheck: () => ({ status: 'missing' }) });
  assert.equal((await read()).systemAudio.errorCode, 'device_missing');
});
