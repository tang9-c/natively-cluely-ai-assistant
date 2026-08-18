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

test('non-Windows automatic interaction reports are ignored', () => {
  const source = read('electron/WindowHelper.ts');
  const setter = source.slice(
    source.indexOf('public setOverlayAutomaticInteractive'),
    source.indexOf('public syncOverlayInteractionPolicy'),
  );

  assert.match(setter, /process\.platform\s*!==\s*['"]win32['"]/);
});
