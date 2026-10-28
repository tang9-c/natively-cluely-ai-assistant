import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let OnboardingService;
try { ({ OnboardingService } = require('../../../dist-electron/electron/services/onboarding/OnboardingService.js')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const legacy = { legacySeenStartup: false, legacyPermissionsShown: false };
function harness() {
  assert.ok(OnboardingService, 'onboarding persistence has not been implemented');
  const state = { stored: undefined, writes: 0, time: 100, platform: 'darwin', fail: false,
    evidence: { hasNonDemoMeeting: false, hasSavedServiceConfiguration: false },
    checks: { microphone: { status: 'verified' }, inputDevice: { status: 'verified' }, systemAudio: { status: 'limited' },
      stt: { status: 'missing', configIdentity: 'stt' }, ai: { status: 'missing', configIdentity: 'ai' } } };
  const deps = { load: () => structuredClone(state.stored), save: p => {
    if (state.fail) throw new Error('disk failure with sensitive detail');
    state.stored = structuredClone(p); state.writes++;
  }, readLegacyEvidence: () => state.evidence, readChecks: async () => structuredClone(state.checks),
    now: () => state.time++, platform: () => state.platform };
  return { state, deps, service: new OnboardingService(deps) };
}
const code = expected => e => e.code === expected;
test('requires explicit initialization; repeated initialization cannot change origin', async () => {
  const { service, state } = harness();
  assert.throws(() => service.getSnapshot(), code('initialization_required'));
  await assert.rejects(service.refreshChecks(), code('initialization_required'));
  assert.equal(service.initialize(legacy).progress.origin, 'fresh');
  assert.equal(service.initialize({ legacySeenStartup: true, legacyPermissionsShown: true }).progress.origin, 'fresh');
  assert.equal(state.writes, 1);
});
for (const [name, change] of [
  ['legacy welcome', h => h.legacy = { ...legacy, legacySeenStartup: true }],
  ['legacy permissions', h => h.legacy = { ...legacy, legacyPermissionsShown: true }],
  ['real meeting', h => h.state.evidence.hasNonDemoMeeting = true],
  ['saved service', h => h.state.evidence.hasSavedServiceConfiguration = true],
]) test(`${name} identifies existing users`, () => {
  const h = harness(); change(h); assert.equal(h.service.initialize(h.legacy ?? legacy).progress.origin, 'existing');
});
test('defaults/demo-only evidence does not identify an existing user; evidence errors are visible', () => {
  const h = harness(); assert.equal(h.service.initialize(legacy).progress.origin, 'fresh');
  h.deps.readLegacyEvidence = () => { throw new Error('db unavailable'); };
  const s = new OnboardingService(h.deps).initialize(legacy); // persisted origin always wins
  assert.equal(s.progress.origin, 'fresh');
  h.state.stored = undefined;
  const failed = new OnboardingService(h.deps).initialize(legacy);
  assert.equal(failed.progress.origin, 'existing'); assert.equal(failed.diagnostics[0].errorCode, 'storage_failed');
});
test('getSnapshot and passive refresh never write; snapshots cannot mutate the service', async () => {
  const h = harness(); h.service.initialize(legacy); const before = h.state.writes;
  await h.service.refreshChecks({ inputDeviceId: 'default' });
  const snap = h.service.getSnapshot(); snap.progress.origin = 'existing';
  assert.equal(h.service.getSnapshot().progress.origin, 'fresh'); assert.equal(h.state.writes, before);
  assert.equal(h.service.getSnapshot().devices.inputDeviceId, 'default');
});
test('progress survives two restarts, including independent hint dismissals', async () => {
  const h = harness(); h.service.initialize(legacy);
  await h.service.applyAction({ type: 'navigate', step: 'speech' });
  await h.service.applyAction({ type: 'dismiss-hint', hint: 'answer' });
  for (let i = 0; i < 2; i++) {
    h.service = new OnboardingService(h.deps);
    const s = h.service.initialize({ legacySeenStartup: true, legacyPermissionsShown: true });
    assert.equal(s.progress.origin, 'fresh'); assert.equal(s.progress.lastStep, 'speech');
    assert.deepEqual(s.progress.meetingHintsDismissed, { transcript: false, answer: true });
  }
});
test('failed save restores prior progress, emits diagnostic, and does not expose raw errors', async () => {
  const h = harness(); h.service.initialize(legacy); const old = h.service.getSnapshot();
  h.state.fail = true;
  await assert.rejects(h.service.applyAction({ type: 'navigate', step: 'ai' }), code('storage_failed'));
  const s = h.service.getSnapshot(); assert.deepEqual(s.progress, old.progress);
  assert.ok(s.stateRevision > old.stateRevision); assert.doesNotMatch(JSON.stringify(s), /sensitive detail/);
  h.state.fail = false; await h.service.applyAction({ type: 'navigate', step: 'ai' });
  assert.equal(h.state.stored.lastStep, 'ai');
});
test('invalid actions and renderer attempts to write private fields cannot change progress', async () => {
  const h = harness(); h.service.initialize(legacy); const old = h.state.writes;
  for (const action of [null, {}, { type: 'complete' }, { type: 'navigate', step: 'bogus' },
    { type: 'defer', origin: 'existing' }, { type: 'dismiss-hint', hint: 'bogus' },
    { type: 'initialize', legacySeenStartup: 'yes', legacyPermissionsShown: false }]) {
    await assert.rejects(h.service.applyAction(action), code('invalid_request'));
  }
  assert.equal(h.state.writes, old);
});
test('unknown schema is never overwritten', () => {
  const h = harness(); h.state.stored = { version: 2, futureData: true };
  assert.throws(() => h.service.initialize(legacy), code('schema_unsupported'));
  assert.equal(h.state.writes, 0);
});
test('permission restoration and platform change invalidate system audio acknowledgement', async () => {
  const h = harness(); h.service.initialize(legacy); await h.service.refreshChecks();
  await h.service.applyAction({ type: 'acknowledge-system-audio-limitation' });
  assert.equal(h.state.stored.acceptedSystemAudioLimitation, true);
  h.state.checks.systemAudio.status = 'verified'; const writes = h.state.writes;
  assert.equal((await h.service.refreshChecks()).progress.acceptedSystemAudioLimitation, false);
  assert.equal(h.state.writes, writes);
  h.state.checks.systemAudio.status = 'limited';
  assert.equal((await h.service.refreshChecks()).progress.acceptedSystemAudioLimitation, false);
  await h.service.applyAction({ type: 'navigate', step: 'speech' });
  assert.equal(h.state.stored.acceptedSystemAudioLimitation, false);
  await h.service.applyAction({ type: 'acknowledge-system-audio-limitation' });
  h.state.platform = 'win32'; const s = new OnboardingService(h.deps).initialize(legacy);
  assert.equal(s.progress.acceptedSystemAudioLimitation, false);
});
test('ready/defer only mark completed after current preparation passes and keep original timestamp', async () => {
  const h = harness(); h.service.initialize(legacy);
  await h.service.applyAction({ type: 'navigate', step: 'ready' });
  assert.equal(h.state.stored.configurationCompletedAt, undefined);
  h.state.checks.systemAudio.status = 'verified';
  for (const target of ['stt', 'ai']) {
    h.state.stored.validationReceipts[target] = { target, provider: 'doubao', configRevision: 0, configIdentity: target,
      checkedAt: 1, result: 'passed', depth: 'model_response' };
    h.state.checks[target].status = 'previously_verified';
  }
  h.service = new OnboardingService(h.deps); h.service.initialize(legacy);
  await h.service.applyAction({ type: 'defer' });
  const completed = h.state.stored.configurationCompletedAt; assert.equal(typeof completed, 'number');
  await h.service.applyAction({ type: 'navigate', step: 'ready' });
  assert.equal(h.state.stored.configurationCompletedAt, completed);
  const restarted = new OnboardingService(h.deps); restarted.initialize(legacy);
  assert.equal((await restarted.refreshChecks()).checks.ai.status, 'previously_verified');
});
test('subscriptions are monotonic and unsubscribe; late passive checks cannot overwrite newer selection', async () => {
  const h = harness(); h.service.initialize(legacy); const revisions = [];
  const unsubscribe = h.service.subscribe(s => revisions.push(s.stateRevision));
  let resolveOld;
  h.deps.readChecks = selection => selection?.inputDeviceId === 'old'
    ? new Promise(resolve => resolveOld = resolve) : Promise.resolve(h.state.checks);
  const old = h.service.refreshChecks({ inputDeviceId: 'old' });
  await h.service.refreshChecks({ inputDeviceId: 'new' });
  resolveOld({ ...h.state.checks, inputDevice: { status: 'failed' } }); await old;
  assert.equal(h.service.getSnapshot().devices.inputDeviceId, 'new');
  assert.equal(h.service.getSnapshot().checks.inputDevice.status, 'verified');
  await h.service.applyAction({ type: 'navigate', step: 'ai' }); unsubscribe();
  const count = revisions.length; await h.service.applyAction({ type: 'navigate', step: 'speech' });
  assert.equal(revisions.length, count);
  assert.ok(revisions.every((n, i) => i === 0 || n > revisions[i - 1]));
});

test('database evidence excludes only the fixed demo and throws visibly when database is unavailable', () => {
  const { DatabaseManager } = require('../../../dist-electron/electron/db/DatabaseManager.js');
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const manager = Object.create(DatabaseManager.prototype); manager.db = db;
  try {
    db.exec('CREATE TABLE meetings (id TEXT PRIMARY KEY)');
    assert.equal(typeof manager.hasNonDemoMeeting, 'function', 'meeting existence query is missing');
    assert.equal(manager.hasNonDemoMeeting(), false);
    db.prepare('INSERT INTO meetings VALUES (?)').run('demo-meeting');
    assert.equal(manager.hasNonDemoMeeting(), false);
    db.prepare('INSERT INTO meetings VALUES (?)').run('real-meeting');
    assert.equal(manager.hasNonDemoMeeting(), true);
    db.exec('DROP TABLE meetings'); assert.throws(() => manager.hasNonDemoMeeting());
    manager.db = null; assert.throws(() => manager.hasNonDemoMeeting());
  } finally { db.close(); }
});

test('failed validation save cannot leave an old success trusted in memory', async () => {
  const h = harness(); h.service.initialize(legacy);
  h.state.checks.ai.status = 'missing'; await h.service.refreshChecks();
  const receipt = { target: 'ai', provider: 'doubao', configRevision: 0, configIdentity: 'ai',
    checkedAt: 1, result: 'passed', depth: 'model_response' };
  h.service.recordValidation(receipt); assert.equal(h.service.getSnapshot().checks.ai.status, 'verified');
  h.state.fail = true;
  assert.throws(() => h.service.recordValidation({ ...receipt, result: 'failed' }), code('storage_failed'));
  assert.equal(h.service.getSnapshot().checks.ai.errorCode, 'storage_failed');
  h.state.fail = false; h.service.recordValidation({ ...receipt, checkedAt: 2 });
  assert.equal(h.service.getSnapshot().checks.ai.status, 'verified');
});
