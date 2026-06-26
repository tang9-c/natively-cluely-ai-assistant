import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const source = fs.readFileSync(path.join(repoRoot, 'electron/WindowHelper.ts'), 'utf8');
const nativeLoaderSource = fs.readFileSync(
  path.join(repoRoot, 'electron/audio/nativeModuleLoader.ts'),
  'utf8',
);
const ipcHandlersSource = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

test('expanded overlay resize cannot collapse to a 1px invisible window', () => {
  assert.match(
    source,
    /const minimumHeight = width >= WindowHelper\.OVERLAY_DEFAULT_WIDTH[\s\S]{0,120}\? WindowHelper\.OVERLAY_MIN_HEIGHT[\s\S]{0,80}: 1;/,
    'expanded overlay resize paths should clamp to OVERLAY_MIN_HEIGHT',
  );
});

test('hiding the overlay marks the main window as not visible so shortcuts can recover it', () => {
  const start = source.indexOf('public hideOverlay(): void');
  assert.ok(start >= 0, 'hideOverlay() must exist');
  const body = source.slice(start, source.indexOf('\n  public showMainWindow', start));
  assert.match(
    body,
    /this\.overlayWindow\.hide\(\);\s*\n\s*this\.isWindowVisible = false;/,
    'hideOverlay() must clear isWindowVisible after hiding the active overlay',
  );
});

test('overlay diagnostics capture state after showing and stealth setup', () => {
  assert.match(
    source,
    /private logOverlayState\(label: string\): void/,
    'WindowHelper should expose a low-noise overlay state diagnostic helper',
  );
  assert.match(
    source,
    /this\.logOverlayState\('switchToOverlay-after-show'\);/,
    'switchToOverlay() should log post-show geometry and visibility',
  );
  assert.match(
    source,
    /this\.logOverlayState\('overlay-ready-to-show-after-stealth'\);/,
    'ready-to-show stealth setup should log the overlay state on macOS',
  );
});

test('Apple Silicon overlay skips native AppKit stealth path', () => {
  assert.match(
    source,
    /private shouldApplyNativeOverlayStealth\(\): boolean/,
    'WindowHelper should gate native overlay stealth behind a dedicated helper',
  );
  assert.match(
    source,
    /return process\.arch !== 'arm64';/,
    'native overlay stealth should be disabled on Apple Silicon until the native path is fixed',
  );
  assert.match(
    source,
    /overlay-ready-to-show-native-stealth-skipped/,
    'skipping native overlay stealth should be visible in logs',
  );
});

test('native module diagnostics identify the loaded architecture-specific binary', () => {
  assert.match(
    nativeLoaderSource,
    /console\.log\('\[nativeModuleLoader\] Loaded native module:', \{/,
    'native loader should always log the selected binary once it loads',
  );
  assert.match(
    nativeLoaderSource,
    /binary,[\s\S]{0,120}filePath,[\s\S]{0,120}platform: process\.platform,[\s\S]{0,120}arch: process\.arch/,
    'native loader diagnostic should include binary path, platform, and CPU architecture',
  );
});

test('renderer hide-window cannot physically hide an active meeting overlay', () => {
  const start = ipcHandlersSource.indexOf("safeHandle('hide-window'");
  assert.ok(start >= 0, 'hide-window handler must exist');
  const body = ipcHandlersSource.slice(start, ipcHandlersSource.indexOf("safeHandle('show-overlay'", start));

  assert.match(
    body,
    /appState\.getIsMeetingActive\(\)[\s\S]{0,160}windowHelper\.getCurrentWindowMode\(\) === 'overlay'/,
    'hide-window should guard active overlay meetings before hiding the BrowserWindow',
  );
  assert.match(
    body,
    /hide-window ignored while meeting overlay is active/,
    'ignored renderer hide attempts should leave an audit trail in logs',
  );
});
