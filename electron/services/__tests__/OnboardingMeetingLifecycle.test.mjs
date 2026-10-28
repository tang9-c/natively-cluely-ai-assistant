import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mainMethods } from './helpers/onboardingRuntime.mjs';
const require = createRequire(import.meta.url);
const { OnboardingService, OnboardingError } = require('../../../dist-electron/electron/services/onboarding/OnboardingService.js');
const { deriveFirstRunStartDecision } = require('../../../dist-electron/shared/onboarding.js');
function service() {
  let stored; let fail = false;
  const s = new OnboardingService({ load: () => stored, save: p => { if (fail) throw new Error('disk error'); stored = p; },
    readLegacyEvidence: () => ({ hasNonDemoMeeting: false, hasSavedServiceConfiguration: false }),
    readChecks: async () => ({ microphone: { status: 'pending_runtime' }, inputDevice: { status: 'verified' }, systemAudio: { status: 'pending_runtime' },
      stt: { status: 'missing' }, ai: { status: 'missing' } }), platform: () => 'test', now: () => 100 });
  s.initialize({ legacySeenStartup: false, legacyPermissionsShown: false });
  return { s, fail: () => fail = true };
}
test('entered, audio started and real transcript are separate facts; ended clears only current-session flags', () => {
  const { s } = service(); assert.equal(typeof s.recordMeetingEvent, 'function', 'meeting fact recording is missing');
  s.recordMeetingEvent({ kind: 'entered', generation: 1, synthetic: false });
  assert.equal(s.getSnapshot().progress.firstMeetingEnteredAt, 100); assert.equal(s.getSnapshot().progress.firstTranscriptReceivedAt, undefined);
  s.recordMeetingEvent({ kind: 'audio-started', generation: 1, synthetic: false });
  assert.equal(s.getSnapshot().meeting.phase, 'audio_started');
  s.recordMeetingEvent({ kind: 'transcript', generation: 1, synthetic: false, hasNonEmptyText: false });
  assert.equal(s.getSnapshot().meeting.hasTranscript, false);
  s.recordMeetingEvent({ kind: 'transcript', generation: 1, synthetic: false, hasNonEmptyText: true });
  assert.equal(s.getSnapshot().progress.firstTranscriptReceivedAt, 100);
  s.recordMeetingEvent({ kind: 'ended', generation: 1, synthetic: false });
  assert.equal(s.getSnapshot().meeting.hasTranscript, false); assert.equal(s.getSnapshot().progress.firstTranscriptReceivedAt, 100);
});
test('synthetic/old-generation/failed-session events cannot create real milestones or overwrite newer failures', () => {
  const { s } = service(); assert.equal(typeof s.recordMeetingEvent, 'function');
  s.recordMeetingEvent({ kind: 'entered', generation: 2, synthetic: true });
  s.recordMeetingEvent({ kind: 'transcript', generation: 2, synthetic: true, hasNonEmptyText: true });
  assert.equal(s.getSnapshot().meeting.hasTranscript, true); assert.equal(s.getSnapshot().progress.firstTranscriptReceivedAt, undefined);
  s.recordMeetingEvent({ kind: 'failed', generation: 2, synthetic: false, errorCode: 'device_missing', recoveryStep: 'permissions' });
  s.recordMeetingEvent({ kind: 'transcript', generation: 1, synthetic: false, hasNonEmptyText: true });
  s.recordMeetingEvent({ kind: 'audio-started', generation: 2, synthetic: false });
  assert.equal(s.getSnapshot().meeting.phase, 'failed'); assert.equal(s.getSnapshot().progress.firstTranscriptReceivedAt, undefined);
});
test('persistence failure preserves actual active meeting state and does not prevent ending', () => {
  const h = service(); assert.equal(typeof h.s.recordMeetingEvent, 'function'); h.fail();
  assert.throws(() => h.s.recordMeetingEvent({ kind: 'entered', generation: 1, synthetic: false }), e => e.code === 'storage_failed');
  assert.equal(h.s.getSnapshot().meeting.isActive, true);
  h.s.recordMeetingEvent({ kind: 'ended', generation: 1, synthetic: false }); assert.equal(h.s.getSnapshot().meeting.isActive, false);
});
test('main startup reserves the original single-flight lock before async readiness; direct calls cannot bypass fresh gate', async () => {
  const App = mainMethods(['startMeeting'], { OnboardingError, deriveFirstRunStartDecision });
  const app = new App(); const { s } = service(); app.onboardingService = s; app._onboardingMeetingGeneration = 0;
  let resolve, refreshes = 0, starts = 0, opened = 0;
  const initial = s.refreshChecks.bind(s); s.refreshChecks = () => { refreshes++; return new Promise(r => resolve = () => initial().then(r)); };
  app.stopAudioTest = async () => {}; app.startMeetingInternal = async () => starts++;
  app.openOnboarding = () => opened++;
  const a = app.startMeeting({ audio: {} }); const b = app.startMeeting({ audio: {} });
  await new Promise(setImmediate); assert.equal(refreshes, 1); resolve();
  const results = await Promise.allSettled([a, b]); assert.ok(results.every(r => r.status === 'rejected' && r.reason.recoveryStep === 'speech'));
  assert.equal(starts, 0); assert.equal(opened, 1); assert.equal(app._meetingStartInFlight, null);
});

test('Launcher navigation waits for subscriptions, keeps the last request and survives renderer reload', () => {
  const App = mainMethods(['openOnboarding', 'markOnboardingRendererReady']); const app = new App(); const events = [], once = new Map();
  const contents = { id: 10, isDestroyed: () => false, isLoadingMainFrame: () => false,
    once: (name, fn) => once.set(name, fn), send: (...args) => events.push(args) };
  app.windowHelper = { setWindowMode() {}, getLauncherWindow: () => ({ isDestroyed: () => false, webContents: contents }) };
  app.openOnboarding({ step: 'ai' }); app.openOnboarding({ step: 'speech' }); assert.equal(events.length, 0);
  app.markOnboardingRendererReady(); assert.equal(events.length, 1); assert.equal(events[0][1].step, 'speech');
  app.markOnboardingRendererReady(); assert.equal(events.length, 1);
  once.get('did-start-loading')(); app.openOnboarding({ step: 'permissions' }); assert.equal(events.length, 1);
  app.markOnboardingRendererReady(); assert.equal(events.at(-1)[1].step, 'permissions');
});
test('unknown future progress schema keeps legacy meeting startup available without overwriting onboarding', async () => {
  const App = mainMethods(['startMeeting'], { OnboardingError, deriveFirstRunStartDecision }); const app = new App(); let starts = 0, opened = 0;
  app.onboardingService = { refreshChecks: async () => { throw new OnboardingError('schema_unsupported'); }, beginMeeting() {} };
  app.stopAudioTest = async () => {}; app.openOnboarding = () => opened++; app._onboardingMeetingGeneration = 0;
  app.startMeetingInternal = async () => { starts++; app.isMeetingActive = true; };
  await app.startMeeting(); assert.equal(starts, 1); assert.equal(opened, 0);
});

test('current saved configuration clears an obsolete passive credential error before signing its receipt', async () => {
  let configured = false;
  const service = new OnboardingService({ load: () => undefined, save() {}, now: () => 1, platform: () => 'test',
    readLegacyEvidence: () => ({ hasNonDemoMeeting: false, hasSavedServiceConfiguration: false }),
    readChecks: async () => ({ microphone: { status: 'verified' }, inputDevice: { status: 'verified' }, systemAudio: { status: 'verified' },
      stt: { status: 'missing' }, ai: { status: 'missing', errorCode: 'credentials_missing' } }),
    readConfiguration: target => ({ provider: 'doubao', modelId: 'selected', configIdentity: `${target}-${configured}`,
      ...(configured ? {} : { errorCode: 'credentials_missing' }) }) });
  service.initialize({ legacySeenStartup: false, legacyPermissionsShown: false }); await service.refreshChecks(); configured = true;
  service.recordValidation({ target: 'ai', provider: 'doubao', modelId: 'selected', configRevision: 0,
    configIdentity: 'ai-true', checkedAt: 1, depth: 'model_response', result: 'passed' });
  assert.equal(service.getSnapshot().checks.ai.status, 'verified'); assert.equal(service.getSnapshot().checks.ai.errorCode, undefined);
});
