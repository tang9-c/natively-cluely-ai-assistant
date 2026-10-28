import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/hooks/useOnboarding.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { acceptOnboardingSnapshot, resolveOnboardingLeave } = module.exports;
test('renderer rejects older and duplicate state revisions, new hook instance accepts a restarted process baseline', () => {
  const current = { stateRevision: 8, progress: { lastStep: 'speech' } };
  assert.equal(acceptOnboardingSnapshot(current, { stateRevision: 7 }), current);
  assert.equal(acceptOnboardingSnapshot(current, { stateRevision: 8 }), current);
  const next = { stateRevision: 9 }; assert.equal(acceptOnboardingSnapshot(current, next), next);
  const restarted = { stateRevision: 1 }; assert.equal(acceptOnboardingSnapshot(null, restarted), restarted);
});
test('dirty navigation only leaves after successful save or explicit discard; failed/thrown save and stay retain form', async () => {
  let saves = 0, discarded = 0; const guard = { isDirty: () => true, save: async () => { saves++; return false; }, discard: () => discarded++ };
  assert.equal(await resolveOnboardingLeave('save', guard), false);
  guard.save = async () => { throw new Error('private credential'); }; assert.equal(await resolveOnboardingLeave('save', guard), false);
  assert.equal(await resolveOnboardingLeave('stay', guard), false); assert.equal(discarded, 0);
  assert.equal(await resolveOnboardingLeave('discard', guard), true); assert.equal(discarded, 1);
  guard.save = async () => { saves++; return true; }; assert.equal(await resolveOnboardingLeave('save', guard), true); assert.equal(saves, 2);
});

test('open requested during initial snapshot refresh is retained even after a state broadcast', async () => {
  const state = { stateRevision: 1, progress: { origin: 'existing', lastStep: 'overview' }, meeting: { phase: 'idle', isActive: false } };
  const values = []; let stateIndex = 0, effect, receiveState, receiveOpen, resolveGet;
  const react = { useState: initial => { const i = stateIndex++; values[i] = initial; return [initial, value => { values[i] = value; }]; },
    useRef: current => ({ current }), useCallback: fn => fn, useEffect: fn => { effect = fn; } };
  const api = {
    onOnboardingStateChanged: fn => { receiveState = fn; return () => {}; },
    onOpenOnboarding: fn => { receiveOpen = fn; return () => {}; },
    getOnboardingState: () => new Promise(resolve => { resolveGet = resolve; }),
    updateOnboardingProgress: async () => ({ success: true, snapshot: state }),
  };
  const isolated = { exports: {} };
  new Function('require', 'module', 'exports', 'window', 'localStorage', compiled)(
    name => name === 'react' ? react : require(name), isolated, isolated.exports,
    { electronAPI: api, addEventListener() {}, removeEventListener() {} }, { getItem: () => null });
  isolated.exports.useOnboarding(true); const cleanup = effect();
  receiveState(state); receiveOpen({ step: 'ai' });
  await new Promise(setImmediate);
  resolveGet({ success: true, snapshot: state }); await new Promise(setImmediate);
  assert.equal(values[3], true, 'explicit open must not be replaced by existing-user default homepage');
  cleanup();
});
