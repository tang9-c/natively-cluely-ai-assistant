import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let AudioTestSession;
try { ({ AudioTestSession } = require('../../../dist-electron/electron/audio/AudioTestSession.js')); }
catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function owner(id) {
  const value = new EventEmitter(); value.id = id; value.destroyed = false; value.isDestroyed = () => value.destroyed;
  value.close = () => { value.destroyed = true; value.emit('destroyed'); }; return value;
}
function harness(permission = async () => true) {
  assert.ok(AudioTestSession, 'audio test lifecycle is missing');
  const h = { activeMeeting: false, captures: [], states: [], failPreferred: false, teardown: null };
  h.session = new AudioTestSession({ isBusy: () => h.activeMeeting, requestPermission: permission,
    createCapture: id => {
      const capture = new EventEmitter(); capture.id = id; capture.stopped = 0;
      capture.start = () => { if (h.failPreferred && id) throw new Error('private device failure'); };
      capture.destroy = async () => { capture.stopped++; if (h.teardown) await h.teardown.promise; };
      h.captures.push(capture); return capture;
    }, onState: (id, state) => h.states.push({ ownerId: id, ...state }), onData() {} });
  return h;
}
for (const action of ['stop', 'close', 'meeting']) test(`${action} during unresolved permission prevents late capture creation`, async () => {
  const permission = deferred(); const entered = deferred();
  const h = harness(() => { entered.resolve(); return permission.promise; }); const o = owner(1);
  const starting = h.session.start('preferred', o, 'one'); await entered.promise;
  if (action === 'stop') await h.session.stop(o.id, 'one');
  if (action === 'close') o.close();
  if (action === 'meeting') { h.activeMeeting = true; await h.session.stop(); }
  permission.resolve(true); const result = await starting;
  assert.equal(result.success, false); assert.equal(h.captures.length, 0); assert.equal(h.session.isActive, false);
});
test('reports actual default fallback only after preferred capture teardown; no overlapping captures', async () => {
  const h = harness(); h.failPreferred = true; h.teardown = deferred(); const o = owner(1);
  const pending = h.session.start('unavailable', o, 'fallback');
  await new Promise(setImmediate); assert.equal(h.captures.length, 1); assert.equal(h.captures[0].stopped, 1);
  h.teardown.resolve(); const result = await pending;
  assert.deepEqual(result, { success: true, actualDeviceId: 'default', usedDefaultFallback: true, operationId: 'fallback' });
  assert.equal(h.captures[1].id, undefined); await h.session.stop(o.id);
});
test('other owner and stale operation stop cannot stop a newer test; duplicate request reuses pending start', async () => {
  const h = harness(); const o = owner(1), other = owner(2);
  const a = h.session.start('preferred', o, 'one'); const b = h.session.start('preferred', o, 'one'); assert.equal(a, b); await a;
  assert.equal((await h.session.start('preferred', other, 'other')).errorCode, 'busy');
  await h.session.stop(other.id); assert.equal(h.captures[0].stopped, 0);
  await h.session.start('new', o, 'two');
  await h.session.stop(o.id, 'one'); assert.equal(h.session.isActive, true); assert.equal(h.captures[1].stopped, 0);
  await h.session.stop(o.id); assert.equal(h.captures[1].stopped, 1); assert.equal(o.listenerCount('destroyed'), 0);
});
test('permission rejection, capture errors and busy meetings emit only safe metadata', async () => {
  const denied = harness(async () => false); const o = owner(1);
  assert.equal((await denied.session.start('preferred', o, 'denied')).errorCode, 'permission_denied');
  const h = harness(); await h.session.start('preferred', o, 'capture');
  h.captures[0].emit('error', new Error('private native device error'));
  await new Promise(setImmediate);
  assert.equal(h.session.isActive, false); assert.equal(h.states.at(-1).status, 'failed');
  assert.equal(h.states.at(-1).errorCode, 'device_missing'); assert.doesNotMatch(JSON.stringify(h.states), /private native/);
  h.activeMeeting = true; assert.equal((await h.session.start('preferred', o, 'busy')).errorCode, 'busy');
  assert.equal(h.captures.length, 1);
});
test('destroyed owners and malformed operation IDs are rejected without opening a microphone', async () => {
  const h = harness(); const o = owner(1); o.close();
  assert.equal((await h.session.start('preferred', o, 'closed')).success, false);
  const alive = owner(2);
  assert.equal((await h.session.start('preferred', alive, '')).errorCode, 'invalid_request');
  assert.equal(h.captures.length, 0);
});

test('actual audio IPC derives owner exclusively from sender and carries operation IDs', async () => {
  const { ipcHandler } = await import('./helpers/onboardingRuntime.mjs'); const calls = [];
  const appState = { startAudioTest: (...args) => { calls.push(args); return { success: true }; }, stopAudioTest: async (...args) => calls.push(args) };
  const sender = { id: 77 }; await ipcHandler('start-audio-test', { appState })({ sender }, 'device', 'operation');
  assert.equal(calls[0][2], sender); assert.deepEqual(calls[0].slice(0, 2), ['device', 'operation']);
  await ipcHandler('stop-audio-test', { appState })({ sender }, 'operation'); assert.deepEqual(calls[1], [77, 'operation']);
});
test('actual meeting entry stops pending audio test without waiting for its permission', async () => {
  const { mainMethods } = await import('./helpers/onboardingRuntime.mjs'); const App = mainMethods(['startMeeting']); const app = new App();
  const permission = deferred(); const entered = deferred(); const h = harness(() => { entered.resolve(); return permission.promise; });
  app.stopAudioTest = () => h.session.stop(); app.windowHelper = {}; let meetings = 0; app.startMeetingInternal = async () => meetings++;
  const pending = h.session.start('preferred', owner(1), 'one'); await entered.promise;
  await app.startMeeting(); assert.equal(meetings, 1); assert.equal(h.captures.length, 0);
  permission.resolve(true); assert.equal((await pending).success, false);
});
test('actual preload forwards operation IDs and unsubscribes audio state events', async () => {
  const fs = await import('node:fs'); const vm = await import('node:vm'); const path = await import('node:path');
  let api; const calls = [], listeners = new Map();
  const electron = { contextBridge: { exposeInMainWorld: (_key, value) => api = value }, ipcRenderer: {
    on: (key, fn) => listeners.set(key, fn), removeListener: (key, fn) => { if (listeners.get(key) === fn) listeners.delete(key); },
    invoke: async (...args) => { calls.push(args); return false; } } };
  vm.runInNewContext(fs.readFileSync(path.resolve(import.meta.dirname, '../../../dist-electron/electron/preload.js'), 'utf8'), {
    module: { exports: {} }, require: () => electron, console: { ...console }, process,
  });
  await api.startAudioTest('device', 'one'); assert.deepEqual(calls.at(-1), ['start-audio-test', 'device', 'one']);
  await api.stopAudioTest('one'); assert.deepEqual(calls.at(-1), ['stop-audio-test', 'one']);
  const events = []; const unsubscribe = api.onAudioTestState(state => events.push(state));
  listeners.get('audio-test-state')({}, { operationId: 'one', status: 'failed' }); assert.equal(events[0].operationId, 'one');
  unsubscribe(); assert.equal(listeners.has('audio-test-state'), false);
});

test('existing settings uses actual fallback and rejects late results after its audio effect unmounts', async () => {
  const { settingsAudioEffect } = await import('./helpers/onboardingRuntime.mjs'); const levels = [], notices = [], stops = [];
  let stateListener, levelListener; const pending = deferred();
  const api = { startAudioTest: () => pending.promise, stopAudioTest: async op => stops.push(op),
    onAudioTestLevel: cb => { levelListener = cb; return () => {}; }, onAudioTestState: cb => { stateListener = cb; return () => {}; } };
  const effect = settingsAudioEffect({ isOpen: true, activeTab: 'audio', selectedInput: 'preferred', crypto: { randomUUID: () => 'one' },
    window: { electronAPI: api }, setMicLevel: x => levels.push(x), setDeviceFallbackNotice: x => notices.push(x) });
  const cleanup = effect();
  levelListener(0.9); assert.equal(levels.length, 0);
  pending.resolve({ success: true, usedDefaultFallback: true, actualDeviceId: 'default', operationId: 'one' }); await new Promise(setImmediate);
  assert.equal(notices[0].actual, '系统默认麦克风'); levelListener(0.5); assert.equal(levels.at(-1), 50);
  stateListener({ operationId: 'one', status: 'failed', errorCode: 'device_missing' }); levelListener(0.7); assert.equal(levels.at(-1), 0);
  cleanup(); assert.deepEqual(stops, ['one']);
  const late = deferred(); api.startAudioTest = () => late.promise;
  const cleanupLate = effect(); cleanupLate(); const count = notices.length;
  late.resolve({ success: true, usedDefaultFallback: true, actualDeviceId: 'default', operationId: 'one' });
  await new Promise(setImmediate); assert.equal(notices.length, count);
});
