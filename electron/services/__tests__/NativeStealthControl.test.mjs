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
