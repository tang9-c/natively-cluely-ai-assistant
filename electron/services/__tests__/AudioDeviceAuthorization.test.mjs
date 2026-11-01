import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../audio/AudioDevices.ts'), 'utf8');
function load(platform = 'darwin', permission = 'not-determined') {
  let nativeCalls = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, process: { platform }, console: { warn() {}, error() {} },
    require(name) {
      if (name === 'electron') return { systemPreferences: { getMediaAccessStatus(kind) {
        assert.equal(kind, 'microphone'); if (permission instanceof Error) throw permission; return permission;
      } } };
      return { loadNativeModule: () => ({ getInputDevices() {
        nativeCalls++;
        if (platform === 'darwin' && permission !== 'granted') throw new Error('native enumeration entered the TCC wait');
        return [{ id: 'Saved USB Mic', name: 'Saved USB Mic' }];
      }, getOutputDevices: () => [{ id: 'speaker', name: 'Speaker' }] }) };
    },
  });
  return { devices: exports.AudioDevices, calls: () => nativeCalls, grant: () => { permission = 'granted'; } };
}
for (const permission of ['not-determined', 'unknown', 'denied', 'restricted', new Error('status unavailable')]) {
  test(`macOS input enumeration stays out of native code until microphone permission is confirmed: ${String(permission)}`, () => {
    const h = load('darwin', permission);
    assert.equal(h.devices.getInputDevices().length, 0);
    assert.equal(h.calls(), 0, 'must not enter a native function that can block before authorization');
    assert.equal(h.devices.getOutputDevices()[0].id, 'speaker');
    h.grant();
    assert.equal(h.devices.getInputDevices()[0].id, 'Saved USB Mic');
    assert.equal(h.calls(), 1, 'refresh after grant must enumerate rather than retain an empty cache');
  });
}
for (const platform of ['darwin', 'win32', 'linux']) test(`authorized input enumeration preserves native IDs on ${platform}`, () => {
  const h = load(platform, platform === 'darwin' ? 'granted' : 'unknown');
  assert.equal(h.devices.getInputDevices()[0].id, 'Saved USB Mic');
  assert.equal(h.calls(), 1);
});
