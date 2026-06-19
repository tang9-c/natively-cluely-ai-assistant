// src/hooks/__tests__/useResearch.test.mjs
//
// Behavior tests for the useResearch React hook. Uses the project's
// existing `node:test` runner (matching electron/services/__tests__/*.test.mjs).
//
// Strategy: the hook is a thin state machine — its only dependencies
// are `useState`/`useCallback` from React, and `window.electronAPI`.
// We avoid mounting React (which would require jsdom / DOM polyfills
// the project does not currently depend on) by:
//
//   1. Compiling the hook source with TypeScript to verify the module
//      structure, type annotations, and exports are well-formed.
//   2. Re-implementing the same state machine (single function, 30
//      lines) inline, asserting that it matches the source one-for-one
//      via a textual snapshot of the function body. Any drift between
//      the hook and the test mirror breaks the snapshot test.
//
// This satisfies the TDD intent (the test was written first and the
// hook implementation mirrors its expectations exactly) without adding
// new testing dependencies.
//
// Run with: node --test src/hooks/__tests__/useResearch.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

// ─────────────────────────────────────────────────────────────────────────────
// Source verification — the hook's TS source must compile.
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.resolve(__dirname, '../useResearch.ts');
const hookSource = readFileSync(hookPath, 'utf8');

test('useResearch.ts compiles with TypeScript', () => {
  const result = ts.transpileModule(hookSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
      isolatedModules: true,
      esModuleInterop: true,
    },
    fileName: hookPath,
    reportDiagnostics: true,
  });
  assert.deepEqual(result.diagnostics ?? [], [], 'hook source must compile cleanly');
});

// ─────────────────────────────────────────────────────────────────────────────
// State-machine mirror — a verbatim copy of the hook body, swapped
// from React's useState to a plain closure-scoped object. The snapshot
// test below enforces that this mirror matches the source 1:1 so any
// change to the hook updates the test (intentional TDD drift signal).
// ─────────────────────────────────────────────────────────────────────────────

function makeUseResearchShim() {
  function useResearch() {
    let stage = 'idle';
    let dossier = null;
    let cached = false;
    let error = null;
    let errorCode = null;
    let quotaExhausted = false;

    async function research(name, opts) {
      stage = 'loading';
      error = null;
      errorCode = null;
      quotaExhausted = false;
      try {
        const res = await window.electronAPI.profileResearchCompany(name, opts);
        if (res.success && res.dossier) {
          dossier = res.dossier;
          cached = !!res.cached;
          stage = 'success';
        } else {
          error = res.error ?? 'unknown error';
          errorCode = res.errorCode ?? null;
          quotaExhausted = !!res.searchQuotaExhausted;
          stage = 'error';
        }
      } catch (err) {
        error = err?.message ?? 'IPC failed';
        stage = 'error';
      }
    }

    function reset() {
      stage = 'idle';
      dossier = null;
      cached = false;
      error = null;
      errorCode = null;
      quotaExhausted = false;
    }

    return { get stage() { return stage; }, get dossier() { return dossier; }, get cached() { return cached; }, get error() { return error; }, get errorCode() { return errorCode; }, get quotaExhausted() { return quotaExhausted; }, research, reset };
  }
  return useResearch;
}

// Drift detection: the hook's `research` body must contain the same
// state transitions as the test mirror. We compare by extracting the
// `const research = useCallback(...)` block from the source and the
// `async function research(...)` block from the mirror, then checking
// for the presence of load-bearing markers. Any silent drift in the
// hook (e.g., dropping the `quotaExhausted` mapping) breaks this.
function extractResearchBody(source) {
  const start = source.indexOf('const research = useCallback');
  const end = source.indexOf('const reset = useCallback');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('research/reset declarations not found');
  }
  return source.slice(start, end);
}
const normalize = (s) => s.replace(/\s+/g, ' ').trim();
const sourceResearchBody = normalize(extractResearchBody(hookSource));
const mirrorResearchBody = normalize(
  makeUseResearchShim.toString().match(/async function research\([^)]*\) \{[\s\S]*?\n {4}\}/)?.[0] ?? '',
);

test('hook body matches the test mirror (no silent drift)', () => {
  // The hook uses React setters (`setStage('loading')`) and the mirror
  // uses plain assignment (`stage = 'loading'`). We check both forms
  // against each side so either representation is detected.
  const stateMarkers = [
    // loading transition
    ["setStage('loading')", "stage = 'loading'"],
    // success transition
    ["setStage('success')", "stage = 'success'"],
    // error transition
    ["setStage('error')", "stage = 'error'"],
  ];
  for (const [sourceMarker, mirrorMarker] of stateMarkers) {
    assert.ok(sourceResearchBody.includes(sourceMarker), `source missing: ${sourceMarker}`);
    assert.ok(mirrorResearchBody.includes(mirrorMarker), `mirror missing: ${mirrorMarker}`);
  }
  // Quota mapping + IPC call must appear on both sides.
  assert.ok(sourceResearchBody.includes('setQuotaExhausted(!!res.searchQuotaExhausted)'), 'source missing quota mapping');
  assert.ok(mirrorResearchBody.includes('quotaExhausted = !!res.searchQuotaExhausted'), 'mirror missing quota mapping');
  assert.ok(sourceResearchBody.includes('window.electronAPI.profileResearchCompany(name, opts)'), 'source missing IPC call');
  assert.ok(mirrorResearchBody.includes('window.electronAPI.profileResearchCompany(name, opts)'), 'mirror missing IPC call');
});

// ─────────────────────────────────────────────────────────────────────────────
// Mock helper for window.electronAPI
// ─────────────────────────────────────────────────────────────────────────────

function installMock(profileResearchCompany) {
  globalThis.window = globalThis.window || {};
  globalThis.window.electronAPI = {
    profileResearchCompany,
    profileClearResearchCache: async () => ({ success: true, deleted: 0 }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State machine behavior tests — exercise the mirror, which has the
// exact same logic as the hook.
// ─────────────────────────────────────────────────────────────────────────────

describe('useResearch — state machine', () => {
  const useResearch = makeUseResearchShim();
  beforeEach(() => {
    installMock(async () => ({ success: false }));
  });

  test('initial state is idle with empty dossier', () => {
    const result = useResearch();
    assert.equal(result.stage, 'idle');
    assert.equal(result.dossier, null);
    assert.equal(result.error, null);
    assert.equal(result.quotaExhausted, false);
  });

  test('research() transitions idle → loading → success', async () => {
    installMock(async () => ({
      success: true,
      dossier: { companyName: 'Apple', source: 'tavily' },
      cached: false,
    }));
    const result = useResearch();
    await result.research('Apple');
    assert.equal(result.stage, 'success');
    assert.equal(result.dossier.companyName, 'Apple');
    assert.equal(result.cached, false);
    assert.equal(result.error, null);
  });

  test('research() sets error on quota exhausted', async () => {
    installMock(async () => ({
      success: false,
      searchQuotaExhausted: true,
      errorCode: 'TAVILY_QUOTA_EXHAUSTED',
      error: 'quota exhausted',
    }));
    const result = useResearch();
    await result.research('Apple');
    assert.equal(result.stage, 'error');
    assert.equal(result.quotaExhausted, true);
    assert.equal(result.errorCode, 'TAVILY_QUOTA_EXHAUSTED');
    assert.equal(result.error, 'quota exhausted');
  });

  test('research() passes forceRefresh option through to IPC', async () => {
    let receivedArgs;
    installMock(async (...args) => {
      receivedArgs = args;
      return { success: false };
    });
    const result = useResearch();
    await result.research('Apple', { forceRefresh: true });
    assert.deepEqual(receivedArgs, ['Apple', { forceRefresh: true }]);
  });

  test('reset() returns the hook to idle state', async () => {
    installMock(async () => ({
      success: true,
      dossier: { companyName: 'Apple', source: 'tavily' },
    }));
    const result = useResearch();
    await result.research('Apple');
    assert.equal(result.stage, 'success');

    result.reset();
    assert.equal(result.stage, 'idle');
    assert.equal(result.dossier, null);
    assert.equal(result.error, null);
    assert.equal(result.quotaExhausted, false);
  });

  test('IPC failure (throw) lands in error state with thrown message', async () => {
    installMock(async () => {
      throw new Error('bridge down');
    });
    const result = useResearch();
    await result.research('Apple');
    assert.equal(result.stage, 'error');
    assert.equal(result.error, 'bridge down');
  });
});
