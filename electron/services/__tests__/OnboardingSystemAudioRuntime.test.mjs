import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mainMethods } from './helpers/onboardingRuntime.mjs';
const require = createRequire(import.meta.url);
const { AudioCaptureHealthMonitor } = require('../../../dist-electron/electron/audio/AudioCaptureHealthMonitor.js');
const { createOnboardingReadinessReader } = require('../../../dist-electron/electron/services/onboarding/OnboardingReadiness.js');

function harness() {
  const State = mainMethods(['getOnboardingSystemAudioCheck']);
  const state = new State();
  const health = new AudioCaptureHealthMonitor({ onState() {}, onFailure() {} });
  state.isMeetingActive = true;
  state.systemAudioCapture = {};
  state._captureHealth = { system: health };
  const read = createOnboardingReadinessReader({ isPackaged: () => true,
    readPermissions: async () => ({ platform: 'darwin', microphone: 'granted', screen: 'denied' }),
    inputDevices: () => [{ id: 'default', name: 'Mic' }], outputDevices: () => [{ id: 'default', name: 'Output' }],
    speechCheck: () => ({ status: 'missing' }), systemAudioCheck: selection => state.getOnboardingSystemAudioCheck(selection) });
  return { state, health, read };
}

test('only current system capture data confirms audio, regardless of screen preflight', async () => {
  const { state, health, read } = harness();
  assert.equal((await read()).systemAudio.status, 'pending_runtime');
  const token = health.bind(); health.start(token, false);
  assert.equal((await read()).systemAudio.status, 'pending_runtime', 'start alone is not audio evidence');
  health.recordData(token, 4);
  assert.equal((await read()).systemAudio.status, 'verified');
  assert.equal((await read()).systemAudio.evidenceSource, 'runtime');
  state.isMeetingActive = false;
  assert.equal((await read()).systemAudio.status, 'pending_runtime', 'ended meeting cannot supply current evidence');
  state.isMeetingActive = true; health.resetSession();
  health.recordData(token, 4);
  assert.equal((await read()).systemAudio.status, 'pending_runtime', 'old callback cannot verify a new session');
});

test('recovery and failure revoke success without claiming every capture error is permission denial', async () => {
  const { health, read, state } = harness();
  const token = health.bind(); health.start(token, false); health.recordData(token, 4);
  health.beginRecovery(token);
  assert.equal((await read()).systemAudio.status, 'pending_runtime');
  const next = health.bind(); health.start(next, false); health.recordData(next, 4);
  health.beginRecovery(next, true); state.systemAudioCapture = null;
  const failed = (await read()).systemAudio;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, undefined);
  assert.equal(failed.messageKey, 'onboarding.system_audio_failed');
});

test('stopped capture, other output selection and microphone activity cannot verify system audio', async () => {
  const { health, read, state } = harness();
  state._captureHealth.mic = { state: 'healthy', isCapturing: true };
  assert.equal((await read()).systemAudio.status, 'pending_runtime');
  const token = health.bind(); health.start(token, false); health.recordData(token, 4);
  state._lastRequestedOutputDeviceId = 'sck';
  assert.equal((await read({ outputDeviceId: 'default' })).systemAudio.status, 'pending_runtime');
  assert.equal((await read({ outputDeviceId: 'sck' })).systemAudio.status, 'verified');
  health.stop();
  assert.equal((await read({ outputDeviceId: 'sck' })).systemAudio.status, 'pending_runtime');
});
