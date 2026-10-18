import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../main.ts');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(mainPath, 'utf8');
const endMeetingStart = source.indexOf('public async endMeeting');
const endMeetingEnd = source.indexOf('private async processCompletedMeetingForRAG', endMeetingStart);
const endMeetingSource = source.slice(endMeetingStart, endMeetingEnd);

test('endMeeting always clears draining state after background teardown', () => {
  assert.ok(endMeetingStart >= 0, 'endMeeting should exist');
  assert.ok(endMeetingEnd > endMeetingStart, 'endMeeting source should be isolated');

  const finallyIndex = endMeetingSource.indexOf('} finally {');
  const clearIndex = endMeetingSource.indexOf('this._isDraining = false;', finallyIndex);

  assert.ok(finallyIndex >= 0, 'background teardown should have a finally block');
  assert.ok(clearIndex > finallyIndex, '_isDraining must be cleared inside finally');
});

test('endMeeting keeps draining enabled during STT grace window', () => {
  // The original implementation blocked endMeeting with a synchronous 250 ms
  // setTimeout so trailing STT finals could arrive. That has since been
  // rewritten as an async IIFE on `_pendingTeardown` so endMeeting returns
  // ~1 ms after Stop click and the renderer can paint the launcher
  // immediately. The semantic guarantee — `_isDraining` stays true while the
  // STT drain runs — is preserved by setting `_isDraining = true;` up front
  // and clearing it only inside the IIFE's `finally` block (asserted by the
  // previous test). Here we verify the draining flag is set before the
  // background teardown that performs the actual STT drain.
  assert.match(
    endMeetingSource,
    /this\._isDraining = true;[\s\S]*this\._pendingTeardown = \(async[\s\S]*drainSttFinalsForMeetingStop/,
  );
});

// Execute production methods with controlled collaborators, rather than asserting source order.
import ts from 'typescript';
import vm from 'node:vm';
import os from 'node:os';
import { createRequire } from 'node:module';
function lifecycleHarness() {
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const cls = tree.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'AppState');
  const names = new Set(['endMeeting', 'startMeeting', 'startMeetingInternal', 'finishMeetingBeforeQuit']);
  const methods = cls.members.filter(n => n.name && names.has(n.name.getText(tree))).map(n => n.getText(tree)).join('\n');
  const notices = [];
  const compiled = ts.transpileModule(`class Lifecycle { ${methods} }; globalThis.Lifecycle = Lifecycle;`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  const context = {console: {log(){}, error(){}, warn(){}}, BrowserWindow: {getAllWindows: () => []}, require: name => {
    if (name === 'electron') return {dialog: {showErrorBox: (...args) => notices.push(args)}};
    throw new Error('unused collaborator');
  }};
  vm.runInNewContext(compiled, context);
  const state = new context.Lifecycle();
  Object.assign(state, {
    isMeetingActive: true, _isDraining: false, _pendingTeardown: null, _captureHealth: {},
    windowHelper: {setWindowMode(){}, resetOverlayPosition(){}},
    getWindowHelper: () => ({getOverlayWindow: () => null, flushLauncherEdits: async () => true}), broadcastMeetingState(){}, broadcast(){},
    cancelAudioRecovery(){}, stopDefaultOutputWatcher(){}, processingHelper: {cancelAndDrain: async () => true}, clearQueues(){},
    transcriptIpcBatcher: {flush(){}, snapshotAndResetDiagnostics(){}},
    adaptivePreloadManager: {notifyMeetingStopped(){}},
    intelligenceManager: {stopMeeting: async () => 'A', resetEngine(){}, clearDynamicActionContext(){}},
    drainSttFinalsForMeetingStop: async () => {}, processCompletedMeetingForRAG: async () => {},
  });
  return {state, notices, context};
}
function deferred() { let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve}; }

test('A2-M1 repeated Stop during final drain saves A once', async () => {
  const {state} = lifecycleHarness();
  const gate = deferred(); let saves = 0;
  state.drainSttFinalsForMeetingStop = () => gate.promise;
  state.intelligenceManager.stopMeeting = async () => {saves++; return 'A';};
  await state.endMeeting();
  const first = state._pendingTeardown;
  const duplicate = state.endMeeting();
  gate.resolve(); await duplicate; await first; await state._pendingTeardown;
  assert.equal(saves, 1);
});

test('A2-M2 failed placeholder blocks B before shared session reset', async () => {
  const {state, notices} = lifecycleHarness();
  state.intelligenceManager.stopMeeting = async () => {throw new Error('private SQLite detail');};
  await state.endMeeting();
  await assert.rejects(state._pendingTeardown);
  let resets = 0;
  state.resetMeetingEchoDiagnostics = () => {resets++; throw new Error('must not start B');};
  await state.startMeetingInternal();
  assert.equal(resets, 0);
  assert.equal(state.isMeetingActive, false);
  assert.ok(notices.length);
  assert.ok(notices.every(args => !args.join(' ').includes('private SQLite detail')));
});

test('A2-M3 explicit Stop after write failure retries A and releases B gate', async () => {
  const {state} = lifecycleHarness(); let saves = 0;
  state.intelligenceManager.stopMeeting = async () => {if (++saves === 1) throw new Error('disk'); return 'A';};
  await state.endMeeting(); await assert.rejects(state._pendingTeardown);
  await state.endMeeting(); await state._pendingTeardown;
  await state.endMeeting();
  assert.equal(saves, 2);
});

function quitHarness(state) {
  let callback; let quits = 0; let cleanups = 0;
  Object.assign(state, {setQuitting(value){this._isQuitting = value;}, disposeIdleResources: async () => {cleanups++;}, getRAGManager: () => null});
  const start = source.indexOf('let quitCleanupPromise:');
  const end = source.indexOf('\n  appState.createWindow()', start);
  const code = ts.transpileModule(source.slice(start, end), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {app: {on: (name, cb) => {callback = cb;}, quit: () => {quits++;}}, appState: state,
    OllamaManager: {getInstance: () => ({stop(){}})}, console: {log(){}, error(){}}, require: name => {
      if (name === 'electron') return {dialog: {showErrorBox(){}}};
      throw new Error('unused collaborator');
    }});
  return {trigger: () => callback({preventDefault(){}}), quits: () => quits, cleanups: () => cleanups};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('A2-Q1 quit while recording waits for received finals to save before cleanup', async () => {
  const {state} = lifecycleHarness(); const gate = deferred(); let saved = false;
  state.drainSttFinalsForMeetingStop = () => gate.promise;
  state.intelligenceManager.stopMeeting = async () => {saved = true; return 'A';};
  const quit = quitHarness(state); quit.trigger(); await tick();
  assert.equal(quit.quits(), 0); assert.equal(quit.cleanups(), 0); assert.equal(saved, false);
  gate.resolve(); await tick(); assert.equal(saved, true); assert.equal(quit.quits(), 1);
});

test('A2-Q2 Stop then immediate Quit waits for one save', async () => {
  const {state} = lifecycleHarness(); const gate = deferred(); let saves = 0;
  state.drainSttFinalsForMeetingStop = () => gate.promise;
  state.intelligenceManager.stopMeeting = async () => {saves++; return 'A';};
  await state.endMeeting(); const quit = quitHarness(state); quit.trigger(); await tick();
  assert.equal(quit.quits(), 0); gate.resolve(); await tick();
  assert.equal(saves, 1); assert.equal(quit.quits(), 1);
});

test('A2-Q3 first-write failure prevents quit and leaves retry resources intact', async () => {
  const {state} = lifecycleHarness();
  state.intelligenceManager.stopMeeting = async () => {throw new Error('disk');};
  const quit = quitHarness(state); quit.trigger(); await tick();
  assert.equal(quit.quits(), 0); assert.equal(quit.cleanups(), 0);
  state.intelligenceManager.stopMeeting = async () => 'A';
  quit.trigger(); await tick(); assert.equal(quit.quits(), 1);
});

test('A2-M4 concurrent Stop waiters share one retry after the same first-write failure', async () => {
  const {state} = lifecycleHarness(); const firstWrite = deferred(); const retryWrite = deferred(); let saves = 0;
  state.intelligenceManager.stopMeeting = async () => {
    if (++saves === 1) {await firstWrite.promise; throw new Error('disk');}
    await retryWrite.promise; return 'A';
  };
  await state.endMeeting();
  const duplicateOne = state.endMeeting(); const duplicateTwo = state.endMeeting();
  firstWrite.resolve(); await tick();
  let bInitialized = false;
  state.resetMeetingEchoDiagnostics = () => {bInitialized = true; throw new Error('B begins');};
  const startB = state.startMeeting().catch(error => assert.match(error.message, /B begins/));
  await tick();
  try {assert.equal(saves, 2); assert.equal(bInitialized, false);}
  finally {retryWrite.resolve(); await Promise.all([duplicateOne, duplicateTwo, startB]);}
  assert.equal(saves, 2); assert.equal(bInitialized, true);
});

test('A2-M5 existing Start action retries retained A before allowing B initialization', async () => {
  const {state} = lifecycleHarness(); let saves = 0;
  state.intelligenceManager.stopMeeting = async () => {if (++saves === 1) throw new Error('disk'); return 'A';};
  await state.endMeeting(); await assert.rejects(state._pendingTeardown);
  state.resetMeetingEchoDiagnostics = () => {assert.equal(saves, 2); throw new Error('B initialization reached after A save');};
  await assert.rejects(state.startMeeting(), /B initialization reached after A save/);
  assert.equal(saves, 2);
});

test('A2-M6 Start joining another failed retry reports failed status without initializing B', async () => {
  const {state} = lifecycleHarness(); const retryWrite = deferred(); const events = []; let saves = 0; let resets = 0;
  state.broadcast = (channel, payload) => events.push({channel, payload});
  state.resetMeetingEchoDiagnostics = () => {resets++;};
  state.intelligenceManager.stopMeeting = async () => {
    if (++saves > 1) await retryWrite.promise;
    throw new Error('private disk failure');
  };
  await state.endMeeting(); await assert.rejects(state._pendingTeardown);
  const retryStop = state.endMeeting();
  const start = state.startMeeting();
  // Observe rejection immediately so the deliberately failing RED run does not create an unhandled rejection.
  const result = start.then(() => null, error => error);
  await tick(); retryWrite.resolve(); await retryStop;
  assert.equal(await result, null);
  assert.equal(resets, 0);
  assert.ok(events.some(event => event.channel === 'meeting-start-status' && event.payload.phase === 'failed'));
});


test('A2-fix2-Q4 Start is blocked while quit waits on save', async () => {
  const {state} = lifecycleHarness(); const drain = deferred(); let resets = 0;
  state.drainSttFinalsForMeetingStop = () => drain.promise;
  state.resetMeetingEchoDiagnostics = () => {resets++; throw new Error('B must not initialize');};
  const quit = quitHarness(state); quit.trigger(); await tick();
  const start = state.startMeeting().then(() => null, error => error);
  drain.resolve(); await tick();
  assert.equal(await start, null); assert.equal(resets, 0); assert.equal(quit.quits(), 1);
});

test('A2-fix2-Q5 Start already awaiting microphone permission cannot commit after Quit', async () => {
  const {state, context} = lifecycleHarness(); const permission = deferred(); let initialized = 0;
  state.isMeetingActive = false;
  state.resetMeetingEchoDiagnostics = () => {};
  state.logSttRuntimeDiagnostics = () => {initialized++; throw new Error('B must not initialize');};
  context.ensureMacMicrophoneAccess = () => permission.promise;
  context.process = {platform: 'linux'};
  const start = state.startMeeting().then(() => null, error => error);
  const quit = quitHarness(state); quit.trigger(); await tick(); permission.resolve(true); await tick();
  assert.equal(await start, null); assert.equal(initialized, 0); assert.equal(state.isMeetingActive, false);
  assert.equal(quit.quits(), 1);
});

test('A2-fix2-Q6 durable SQLite placeholder permits quit while live RAG and an earlier Start remain pending', async () => {
  const {state} = lifecycleHarness(); const embedding = deferred(); const title = deferred(); let completedRag = 0;
  const require = createRequire(import.meta.url);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-quit-'));
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {id: electronPath, filename: electronPath, loaded: true, exports: {
    app: {getPath: () => userData, getAppPath: () => root, isReady: () => true, isPackaged: false, whenReady: async () => {}, getVersion: () => 'test'},
    BrowserWindow: {getAllWindows: () => []},
  }};
  const {MeetingPersistence} = require(path.join(root, 'dist-electron/electron/MeetingPersistence.js'));
  const transcript = Array.from({length: 3}, (_, i) => ({speaker: 'user', text: `durable fixture ${i}`, timestamp: i}));
  const session = {flushInterimTranscript(){}, getSessionStartTime: () => Date.now() - 5000,
    getFullTranscript: () => transcript, getEffectiveFullTranscript: () => transcript, getFullUsage: () => [],
    getFullSessionContext: () => 'fixture', getMeetingMetadata: () => null, reset(){}};
  let calls = 0;
  const persistence = new MeetingPersistence(session, {generateMeetingSummary: async () => ++calls === 1 ? title.promise : JSON.stringify({keyPoints: [], actionItems: [], decisions: [], openQuestions: []})});
  let meetingId;
  state.intelligenceManager.stopMeeting = async () => {meetingId = await persistence.stopMeeting(); return meetingId;};
  state.ragManager = {stopLiveIndexing: () => embedding.promise};
  state.processCompletedMeetingForRAG = async () => {completedRag++;};
  state.resetMeetingEchoDiagnostics = () => {throw new Error('B must not initialize');};
  await state.endMeeting(); await tick();
  const start = state.startMeeting().then(() => null, error => error);
  const quit = quitHarness(state); quit.trigger(); await tick();
  const Database = require('better-sqlite3');
  const reopened = new Database(path.join(userData, 'natively.db'), {readonly: true});
  try {
    assert.equal(quit.quits(), 1);
    assert.equal(reopened.prepare('SELECT is_processed FROM meetings WHERE id = ?').get(meetingId).is_processed, 0);
    assert.deepEqual(reopened.prepare('SELECT content FROM transcripts WHERE meeting_id = ? ORDER BY timestamp_ms').all(meetingId).map(row => row.content), transcript.map(segment => segment.text));
  } finally {reopened.close(); embedding.resolve(); title.resolve('fixture title'); await state._pendingTeardown;}
  assert.equal(await start, null); assert.equal(completedRag, 0);
});

test('A2-fix2-Q7 Start is blocked while post-save quit cleanup remains pending', async () => {
  const {state} = lifecycleHarness(); state.isMeetingActive = false;
  const cleanup = deferred(); let resets = 0;
  const quit = quitHarness(state);
  state.disposeIdleResources = () => cleanup.promise;
  state.resetMeetingEchoDiagnostics = () => {resets++; throw new Error('B must not initialize');};
  quit.trigger(); await tick();
  try {await state.startMeeting(); assert.equal(resets, 0); assert.equal(quit.quits(), 0);}
  finally {cleanup.resolve(); await tick();}
  assert.equal(quit.quits(), 1);
});

test('T7 renderer save failure blocks quit before meeting or resource teardown and explicit Quit retries', async () => {
  const {state} = lifecycleHarness(); let flushes = 0; let saves = 0;
  state.getWindowHelper = () => ({ getOverlayWindow: () => null, flushLauncherEdits: async () => ++flushes > 1 });
  state.intelligenceManager.stopMeeting = async () => { saves++; return 'A'; };
  const quit = quitHarness(state); quit.trigger(); await tick();
  assert.equal(flushes, 1); assert.equal(saves, 0); assert.equal(quit.cleanups(), 0); assert.equal(quit.quits(), 0); assert.equal(state._isQuitting, false);
  quit.trigger(); await tick();
  assert.equal(flushes, 2); assert.equal(saves, 1); assert.equal(quit.cleanups(), 1); assert.equal(quit.quits(), 1);
});

test('T7 repeated Quit joins the pending renderer barrier and does not permit a new meeting', async () => {
  const {state} = lifecycleHarness(); const flush = deferred(); let flushes = 0; let resets = 0;
  state.getWindowHelper = () => ({ getOverlayWindow: () => null, flushLauncherEdits: () => { flushes++; return flush.promise; } });
  state.resetMeetingEchoDiagnostics = () => { resets++; throw new Error('new meeting must remain blocked'); };
  const quit = quitHarness(state); quit.trigger(); quit.trigger(); await tick();
  await state.startMeeting(); assert.equal(flushes, 1); assert.equal(resets, 0); assert.equal(quit.cleanups(), 0);
  flush.resolve(false); await tick(); assert.equal(quit.quits(), 0); assert.equal(state._isQuitting, false);
});
