import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('WindowHelper owns an idempotent automatic overlay interaction policy', () => {
  const source = read('electron/WindowHelper.ts');

  assert.match(source, /resolveOverlayMouseInteractionPolicy/);
  assert.match(source, /overlayAutomaticInteractive/);
  assert.match(source, /lastAppliedIgnoreMouseEvents/);
  assert.match(source, /setOverlayAutomaticInteractive\(interactive:\s*boolean\)/);
  assert.match(source, /lastAppliedIgnoreMouseEvents\s*===\s*policy\.ignoreMouseEvents/);
});

test('Windows overlay starts transparent-area passthrough before each show', () => {
  const source = read('electron/WindowHelper.ts');
  const switchToOverlay = source.slice(
    source.indexOf('public switchToOverlay'),
    source.indexOf('public switchToLauncher'),
  );

  assert.match(switchToOverlay, /resetOverlayAutomaticInteraction/);
  assert.ok(
    switchToOverlay.indexOf('resetOverlayAutomaticInteraction')
      < switchToOverlay.indexOf('this.overlayWindow.show'),
    'automatic hit state must reset before the native window is shown',
  );
});

test('duplicate switchToOverlay calls do not clear a current interactive hit', () => {
  const source = read('electron/WindowHelper.ts');
  const switchToOverlay = source.slice(
    source.indexOf('public switchToOverlay'),
    source.indexOf('public switchToLauncher'),
  );

  assert.match(switchToOverlay, /shouldResetAutomaticInteraction/);
  assert.match(
    switchToOverlay,
    /currentWindowMode\s*!==\s*['"]overlay['"][\s\S]{0,120}!this\.overlayWindow\?\.isVisible\(\)/,
  );
  assert.match(
    switchToOverlay,
    /if\s*\(shouldResetAutomaticInteraction\)\s*\{\s*this\.resetOverlayAutomaticInteraction\(\);\s*\}/,
  );
});

test('WindowHelper enables automatic interaction on Windows and macOS only', () => {
  const source = read('electron/WindowHelper.ts');
  const resetter = source.slice(
    source.indexOf('private resetOverlayAutomaticInteraction'),
    source.indexOf('public setOverlayAutomaticInteractive'),
  );
  const setter = source.slice(
    source.indexOf('public setOverlayAutomaticInteractive'),
    source.indexOf('public syncOverlayInteractionPolicy'),
  );

  assert.match(source, /supportsOverlayAutomaticHitTesting/);
  assert.match(
    source,
    /overlayAutomaticInteractive\s*=\s*!supportsOverlayAutomaticHitTesting\(process\.platform\)/,
  );
  assert.match(resetter, /!supportsOverlayAutomaticHitTesting\(process\.platform\)/);
  assert.match(setter, /!supportsOverlayAutomaticHitTesting\(process\.platform\)/);
  assert.doesNotMatch(resetter, /process\.platform\s*!==\s*['"]win32['"]/);
  assert.doesNotMatch(setter, /process\.platform\s*!==\s*['"]win32['"]/);
});

test('restoring overlay interaction keeps the native window focusable', () => {
  const source = read('electron/WindowHelper.ts');
  const syncPolicy = source.slice(
    source.indexOf('public syncOverlayInteractionPolicy'),
    source.indexOf('public showOverlay'),
  );

  assert.match(syncPolicy, /setIgnoreMouseEvents\(false\)/);
  assert.match(syncPolicy, /setFocusable\(true\)/);
  assert.doesNotMatch(syncPolicy, /setFocusable\(false\)/);
});
