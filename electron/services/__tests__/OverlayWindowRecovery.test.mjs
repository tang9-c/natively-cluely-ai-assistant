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
const helpSettingsSource = fs.readFileSync(
  path.join(repoRoot, 'src/components/settings/HelpSettings.tsx'),
  'utf8',
);

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
    /applyNativeStealthIfEnabled\(this\.overlayWindow,\s*\{[\s\S]{0,180}skipOnAppleSilicon:\s*true/,
    'WindowHelper should gate native overlay stealth through the shared helper',
  );
  assert.match(
    source,
    /isAppleSiliconMac:\s*\(\)\s*=>\s*this\.isAppleSiliconMac\(\)/,
    'native overlay stealth should be disabled on Apple Silicon until the native path is fixed',
  );
  assert.match(
    source,
    /sysctl\.proc_translated/,
    'Apple Silicon detection should include Intel builds running under Rosetta',
  );
  assert.match(
    source,
    /hw\.optional\.arm64/,
    'Apple Silicon detection should fall back to the hardware capability sysctl',
  );
  assert.match(
    source,
    /overlay-ready-to-show-native-stealth-skipped/,
    'skipping native overlay stealth should be visible in logs',
  );
});

test('meeting overlay enables public content protection before platform-specific stealth setup', () => {
  const creation = source.indexOf('this.overlayWindow = new BrowserWindow(overlaySettings);');
  const protection = source.indexOf('this.overlayWindow.setContentProtection(true);', creation);
  const macSetup = source.indexOf("if (process.platform === 'darwin')", creation);

  assert.ok(creation >= 0, 'meeting overlay BrowserWindow creation must exist');
  assert.ok(protection > creation, 'meeting overlay must enable public content protection after creation');
  assert.ok(
    protection < macSetup,
    'public content protection must run before the macOS native stealth gate, including on Apple Silicon',
  );
});

test('public content protection is restored only for the meeting overlay', () => {
  const otherWindowHelpers = [
    'electron/SettingsWindowHelper.ts',
    'electron/ModelSelectorWindowHelper.ts',
    'electron/CropperWindowHelper.ts',
  ];

  assert.equal(
    source.match(/\.setContentProtection\(true\)/g)?.length,
    1,
    'WindowHelper should protect only the meeting overlay, not the launcher',
  );
  for (const relativePath of otherWindowHelpers) {
    const helperSource = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(
      helperSource,
      /\.setContentProtection\(/,
      `${relativePath} must not restore the removed global hidden mode`,
    );
  }
});

test('help describes the supported screen-sharing boundary without claiming complete invisibility', () => {
  assert.match(helpSettingsSource, /Windows 11/);
  assert.match(helpSettingsSource, /腾讯会议、飞书会议/);
  assert.match(helpSettingsSource, /单个窗口共享/);
  assert.match(helpSettingsSource, /macOS 15\+/);
  assert.match(helpSettingsSource, /整屏共享可能包含 CueUp/);
  assert.doesNotMatch(helpSettingsSource, /完全隐身/);
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

test('overlay renderer-ready deferral has timeout reload recovery', () => {
  assert.match(source, /private overlayReadyRecoveryTimer: NodeJS\.Timeout \| null = null/);
  assert.match(source, /private reloadOverlayRenderer\(reason: string, inactive: boolean\): void/);
  assert.match(source, /private scheduleOverlayReadyRecovery\(inactive: boolean\): void/);
  assert.match(source, /loadURL\(`\$\{startUrl\}\?window=overlay`\)/);
});

test('switchToOverlay defers without marking the overlay visible when renderer is not ready', () => {
  const start = source.indexOf('public switchToOverlay(inactive?: boolean): void');
  const end = source.indexOf('public switchToLauncher', start);
  const body = source.slice(start, end);
  const deferStart = body.indexOf('!this.overlayRendererReady');
  const deferEnd = body.indexOf('return;', deferStart);
  const deferBranch = body.slice(deferStart, deferEnd);

  assert.match(deferBranch, /this\.pendingOverlayShowInactive = !!inactive/);
  assert.match(deferBranch, /this\.scheduleOverlayReadyRecovery\(\!\!inactive\)/);
  assert.doesNotMatch(deferBranch, /this\.isWindowVisible = true/);
  assert.doesNotMatch(deferBranch, /this\.launcherWindow\.hide\(\)/);
});

test('overlay show path verifies and repairs invisible overlay state', () => {
  assert.match(source, /private verifyOverlayVisibleAfterShow\(reason: string\): void/);
  assert.match(source, /this\.overlayWindow\.getOpacity\(\)/);
  assert.match(source, /WindowHelper\.OVERLAY_MIN_HEIGHT/);
  assert.match(source, /WindowHelper\.OVERLAY_DEFAULT_WIDTH/);
  assert.match(source, /this\.logOverlayState\(`switchToOverlay-recovered-\$\{reason\}`\)/);
});
