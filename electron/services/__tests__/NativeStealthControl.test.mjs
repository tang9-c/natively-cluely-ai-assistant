import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const require = createRequire(import.meta.url);

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('native stealth uses one shared development gate', () => {
  const source = readSource('electron/utils/nativeStealth.ts');

  assert.match(source, /NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH/);
  assert.match(source, /export function shouldApplyNativeStealth/);
  assert.match(source, /export function applyNativeStealthIfEnabled/);
});

test('window helpers route native stealth through shared helper only', () => {
  const windowHelperPaths = [
    'electron/WindowHelper.ts',
    'electron/SettingsWindowHelper.ts',
    'electron/ModelSelectorWindowHelper.ts',
    'electron/CropperWindowHelper.ts',
  ];

  for (const relativePath of windowHelperPaths) {
    const source = readSource(relativePath);
    assert.match(source, /applyNativeStealthIfEnabled/);
    assert.doesNotMatch(source, /applyStealthToWindow/);
    assert.doesNotMatch(source, /loadNativeModule\(\)/);
  }
});

test('shared native stealth helper preserves env and platform gates', () => {
  const mod = require('../../../dist-electron/electron/utils/nativeStealth.js');
  const previous = process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH;

  try {
    process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH = '1';
    assert.equal(mod.shouldApplyNativeStealth({ platform: 'darwin' }), false);

    delete process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH;
    assert.equal(mod.shouldApplyNativeStealth({ platform: 'linux' }), false);
    assert.equal(mod.shouldApplyNativeStealth({ platform: 'darwin' }), true);
    assert.equal(
      mod.shouldApplyNativeStealth({
        platform: 'darwin',
        skipOnAppleSilicon: true,
        isAppleSiliconMac: () => true,
      }),
      false,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH;
    } else {
      process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH = previous;
    }
  }
});

test('Apple Silicon detection covers native ARM, Rosetta, Intel, and non-macOS runtimes', () => {
  const mod = require('../../../dist-electron/electron/utils/nativeStealth.js');
  const calls = [];
  const sysctl = (_file, args) => {
    calls.push(args.join(' '));
    if (args.includes('sysctl.proc_translated')) return '1\n';
    return '0\n';
  };

  assert.equal(mod.isAppleSiliconMac({ platform: 'linux', arch: 'arm64', execFileSync: sysctl }), false);
  assert.equal(mod.isAppleSiliconMac({ platform: 'darwin', arch: 'arm64', execFileSync: sysctl }), true);
  assert.deepEqual(calls, [], 'native ARM should not invoke sysctl');

  assert.equal(mod.isAppleSiliconMac({ platform: 'darwin', arch: 'x64', execFileSync: sysctl }), true);
  assert.deepEqual(calls, ['-in sysctl.proc_translated'], 'Rosetta should be detected first');

  const intelSysctl = (_file, args) => {
    if (args.includes('sysctl.proc_translated')) throw new Error('unsupported');
    return '0\n';
  };
  assert.equal(mod.isAppleSiliconMac({ platform: 'darwin', arch: 'x64', execFileSync: intelSysctl }), false);

  const armHardwareSysctl = (_file, args) => (
    args.includes('sysctl.proc_translated') ? '0\n' : '1\n'
  );
  assert.equal(mod.isAppleSiliconMac({ platform: 'darwin', arch: 'x64', execFileSync: armHardwareSysctl }), true);
});

test('shared native stealth helper does not load native module when disabled by env', () => {
  const mod = require('../../../dist-electron/electron/utils/nativeStealth.js');
  const previous = process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH;
  const fakeWindow = {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.from('fake-window'),
  };
  let loadCount = 0;
  let applyCount = 0;
  const loadNativeModule = () => {
    loadCount += 1;
    return {
      applyStealthToWindow: () => {
        applyCount += 1;
      },
    };
  };

  try {
    process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH = '1';
    assert.equal(
      mod.applyNativeStealthIfEnabled(fakeWindow, {
        label: 'NativeStealthControlTest',
        platform: 'darwin',
        loadNativeModule,
      }).status,
      'skipped',
    );
    assert.equal(loadCount, 0);
    assert.equal(applyCount, 0);

    delete process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH;
    assert.equal(
      mod.applyNativeStealthIfEnabled(fakeWindow, {
        label: 'NativeStealthControlTest',
        platform: 'darwin',
        loadNativeModule,
      }).status,
      'applied',
    );
    assert.equal(loadCount, 1);
    assert.equal(applyCount, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH;
    } else {
      process.env.NATIVELY_DISABLE_NATIVE_OVERLAY_STEALTH = previous;
    }
  }
});
