import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../permissions/macPermissionHealth.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

// Execute the real resolver with OS boundaries replaced. No Electron startup,
// screen capture, permission request, filesystem mutation or TCC reset occurs.
function loadHealth(status, { packaged = true, platform = 'darwin', capturable = true } = {}) {
  let probes = 0;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    process: { platform },
    console: { warn() {}, error() {} },
    require(id) {
      if (id === 'electron') return {
        app: { isPackaged: packaged },
        systemPreferences: { getMediaAccessStatus: () => status },
        desktopCapturer: { async getSources() {
          probes++;
          return capturable ? [{ id: 'screen:0' }] : [];
        } },
      };
      if (id === 'child_process') return { execFile() { throw new Error('TCC reset forbidden'); } };
      return require(id);
    },
  });
  return { resolve: exports.resolveMacScreenPermissionHealth, probes: () => probes };
}

test('first capture use probes undetermined permission instead of blocking authorization', async () => {
  const health = loadHealth('not-determined');
  const result = await health.resolve('meeting start');
  assert.equal(health.probes(), 1);
  assert.equal(result.effectiveGranted, true);
  assert.equal(result.recommendedFix, 'none');
});

test('startup status-only checks never prompt, including undetermined permission', async () => {
  for (const status of ['not-determined', 'denied', 'granted', 'restricted']) {
    const health = loadHealth(status);
    const result = await health.resolve('permissions ipc check', { probeScreenSources: false });
    assert.equal(health.probes(), 0);
    assert.equal(result.effectiveGranted, status === 'granted');
  }
});

test('unsuccessful first capture directs user to settings without claiming stale grant', async () => {
  const health = loadHealth('not-determined', { capturable: false });
  const result = await health.resolve('meeting start');
  assert.equal(health.probes(), 1);
  assert.equal(result.effectiveGranted, false);
  assert.equal(result.staleGrantSuspected, false);
  assert.equal(result.recommendedFix, 'open-settings');
});

test('restricted policy never triggers a capture probe', async () => {
  const health = loadHealth('restricted');
  const result = await health.resolve('meeting start');
  assert.equal(result.effectiveGranted, false);
  assert.equal(health.probes(), 0);
});

test('existing grants and denial use actual capability, stale grant remains repairable', async () => {
  for (const status of ['granted', 'denied']) {
    for (const capturable of [true, false]) {
      const health = loadHealth(status, { capturable });
      const result = await health.resolve('meeting start');
      assert.equal(result.effectiveGranted, capturable);
      assert.equal(result.staleGrantSuspected, status === 'granted' && !capturable);
    }
  }
});

test('development and non-mac checks do not probe permissions', async () => {
  for (const options of [{ packaged: false }, { platform: 'win32' }]) {
    const health = loadHealth('not-determined', options);
    assert.equal((await health.resolve('meeting start')).effectiveGranted, true);
    assert.equal(health.probes(), 0);
  }
});
