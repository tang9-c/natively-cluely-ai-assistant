import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mainMethods } from './helpers/onboardingRuntime.mjs';
const require = createRequire(import.meta.url);
const { AudioCaptureHealthMonitor } = require('../../../dist-electron/electron/audio/AudioCaptureHealthMonitor.js');

// Execute the actual packaged-path orchestration with only OS/native boundaries
// replaced. A failed screen probe must not suppress an authorized audio backend.
const screenFailures = [
  ['denied', { status: 'denied', effectiveDenied: true, staleGrantSuspected: false }],
  ['granted but no screen sources', { status: 'granted', effectiveDenied: true, staleGrantSuspected: true }],
  ['screen enumeration error', null],
];
function harness(method, screenFailure = screenFailures[0][1]) {
  const captures = [], events = []; let probes = 0;
  class Capture extends EventEmitter {
    constructor(device) { super(); this.device = device; captures.push(this); }
    start() { this.started = true; }
    async destroy() {}
  }
  const Main = mainMethods([method], {
    process: { platform: 'darwin', env: {} }, app: { isPackaged: true },
    console: { log() {}, warn() {}, error() {} },
    resolveMacScreenCaptureCapability: async () => { probes++; if (!screenFailure) throw new Error('Screen enumeration failed'); return screenFailure; },
    ensureMacMicrophoneAccess: async () => true,
    formatPermissionMessage: reason => reason,
    SystemAudioCapture: Capture, MicrophoneCapture: class {}, AudioCaptureHealthMonitor,
    isNativeAudioModuleUnavailable: () => false,
    require: () => ({ CredentialsManager: { getInstance: () => ({ getSttProvider: () => 'fixture' }) } }),
  });
  const main = new Main();
  Object.assign(main, {
    _audioCaptureEpoch: 1, _audioCaptureReleases: new Set(), _captureHealth: {}, _audioRecoveryOwners: {},
    isMeetingActive: true, googleSTT: {}, googleSTT_User: {}, microphoneCapture: {},
    wireSystemCapture() {}, wireMicCapture() {}, cancelAudioRecovery() {}, normalizeDeviceId: value => value || undefined,
    broadcast: (...args) => events.push(args), broadcastDeviceSelection: event => events.push(['device', event]),
    broadcastScreenTccRepairRequired: (...args) => events.push(['repair', ...args]),
    getStaleScreenRecordingMessage: () => 'stale-screen',
    releaseAudioCapture: async capture => capture.destroy(), waitForAudioRelease: async () => {},
    maybeBroadcastSckOutputRouteIgnored() {},
  });
  return { main, captures, events, probes: () => probes };
}

for (const [scenario, failure] of screenFailures) test(`pipeline setup constructs system audio despite a failed packaged macOS screen probe (${scenario})`, async () => {
  const h = harness('setupSystemAudioPipeline', failure);
  await h.main.setupSystemAudioPipeline();
  assert.equal(h.captures.length, 1);
  assert.equal(h.probes(), 0);
  assert.equal(h.events.some(([name]) => name === 'system-audio-permission-denied'), false);
});

for (const [scenario, failure] of screenFailures) test(`device reconfiguration preserves the selected audio route without screen preflight (${scenario})`, async () => {
  const h = harness('reconfigureAudio', failure); h.main.microphoneCapture = null;
  await h.main.reconfigureAudio(undefined, 'headphones');
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].device, 'headphones');
  assert.equal(h.probes(), 0);
});

for (const [scenario, failure] of screenFailures) test(`system audio recovery reaches the native start rather than failing on screen enumeration (${scenario})`, async () => {
  const h = harness('recoverAudioCapture', failure);
  h.main._captureHealth.system = { bind() {}, beginRecovery: () => false };
  await h.main.recoverAudioCapture('system', { destroy: async () => {} }, 1);
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].started, true);
  assert.equal(h.probes(), 0);
});

for (const [scenario, failure] of screenFailures) test(`meeting startup does not announce an audio denial before attempting native capture (${scenario})`, async () => {
  const h = harness('startMeetingInternal', failure);
  const boundary = new Error('reached audio setup boundary');
  Object.assign(h.main, { windowHelper: { resetOverlayPosition() {}, setWindowMode() {} },
    resetMeetingEchoDiagnostics() {}, logSttRuntimeDiagnostics() { throw boundary; } });
  await assert.rejects(h.main.startMeetingInternal(), error => error === boundary);
  assert.equal(h.probes(), 0);
  assert.equal(h.events.some(([name]) => name === 'system-audio-permission-denied'), false);
});

test('a real native permission error still becomes a terminal audio warning without retry or TCC reset', async () => {
  const h = harness('wireCaptureHealth');
  const capture = new EventEmitter(); capture.destroy = async () => {}; h.main.systemAudioCapture = capture;
  h.main.recoverAudioCapture = () => { throw new Error('Permanent denial must not retry'); };
  h.main.wireCaptureHealth('system', capture);
  capture.emit('error', new Error('System audio access denied'));
  const health = h.main._captureHealth.system;
  assert.equal(health.state, 'failed'); assert.equal(health.attempts, 0);
  const warning = h.events.find(([name, payload]) => name === 'audio-capture-failed' && payload.terminal)?.[1];
  assert.equal(warning.channel, 'system'); assert.equal(warning.recommendedFix, 'open-settings');
  assert.equal(h.probes(), 0);
  await Promise.all(h.main._audioCaptureReleases);
});

test('valid audio callbacks confirm capture and send the healthy warning-clear event', () => {
  const h = harness('wireCaptureHealth');
  const capture = new EventEmitter(); h.main.systemAudioCapture = capture;
  capture.supportsContinuousHeartbeat = () => false; capture.getActualDeviceId = () => 'headphones';
  h.main.wireCaptureHealth('system', capture);
  capture.emit('start'); capture.emit('data', Buffer.alloc(8));
  assert.equal(h.main._captureHealth.system.state, 'healthy');
  assert.equal(h.events.some(([name, payload]) => name === 'audio-capture-failed' && payload.state === 'healthy' && payload.message === ''), true);
  h.main._captureHealth.system.stop();
});
