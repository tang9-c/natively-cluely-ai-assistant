import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../main.ts');
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
function lifecycleHarness() {
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const cls = tree.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'AppState');
  const names = new Set(['endMeeting', 'startMeetingInternal', 'finishMeetingBeforeQuit']);
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
    isMeetingActive: true, _isDraining: false, _pendingTeardown: null,
    windowHelper: {setWindowMode(){}, resetOverlayPosition(){}},
    getWindowHelper: () => ({getOverlayWindow: () => null}), broadcastMeetingState(){}, broadcast(){},
    stopDefaultOutputWatcher(){}, processingHelper: {cancelAndDrain: async () => true}, clearQueues(){},
    transcriptIpcBatcher: {flush(){}, snapshotAndResetDiagnostics(){}},
    adaptivePreloadManager: {notifyMeetingStopped(){}},
    intelligenceManager: {stopMeeting: async () => 'A', resetEngine(){}, clearDynamicActionContext(){}},
    drainSttFinalsForMeetingStop: async () => {}, processCompletedMeetingForRAG: async () => {},
  });
  return {state, notices};
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
  Object.assign(state, {setQuitting(){}, disposeIdleResources: async () => {cleanups++;}, getRAGManager: () => null});
  const start = source.indexOf('let quitCleanupPromise:');
  const end = source.indexOf('// app.dock?.hide()', start);
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
