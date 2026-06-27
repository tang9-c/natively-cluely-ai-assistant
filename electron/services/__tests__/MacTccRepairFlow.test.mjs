import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('main and ScreenshotHelper share a dedicated mac permission health module', () => {
  const main = read('electron/main.ts');
  const screenshotHelper = read('electron/ScreenshotHelper.ts');

  assert.match(main, /resolveMacScreenPermissionHealth/);
  assert.match(screenshotHelper, /resolveMacScreenPermissionHealth/);
  assert.doesNotMatch(screenshotHelper, /const status = systemPreferences\.getMediaAccessStatus\('screen'\);/);
});

test('permissions IPC exposes health-aware check and repair endpoints', () => {
  const ipcHandlers = read('electron/ipcHandlers.ts');
  assert.match(ipcHandlers, /safeHandle\('permissions:check'/);
  assert.match(ipcHandlers, /screenHealth/);
  assert.match(ipcHandlers, /systemAudioHealth/);
  assert.match(ipcHandlers, /safeHandle\('permissions:repair-tcc'/);
  assert.match(ipcHandlers, /resolveMacBundleIdentifier/);
  assert.match(ipcHandlers, /tccutil/);
  assert.match(ipcHandlers, /ScreenCapture/);
  assert.match(ipcHandlers, /AudioCapture/);
  assert.match(ipcHandlers, /Microphone/);
});

test('development Electron plist patch declares system audio capture usage', () => {
  const patcher = read('scripts/patch-electron-plist.js');

  assert.match(patcher, /NSAudioCaptureUsageDescription/);
  assert.match(patcher, /Natively needs system audio access to transcribe meeting audio\./);
});

test('TCC repair resets AudioCapture together with ScreenCapture for system audio', () => {
  const permissions = read('electron/permissions/macPermissionHealth.ts');
  const ipcHandlers = read('electron/ipcHandlers.ts');

  assert.match(permissions, /AudioCapture/);
  assert.match(permissions, /scope === 'screen'[\s\S]*?ScreenCapture[\s\S]*?AudioCapture/);
  assert.match(permissions, /scope === 'both'[\s\S]*?ScreenCapture[\s\S]*?AudioCapture[\s\S]*?Microphone/);
  assert.match(ipcHandlers, /tccutil reset AudioCapture \$\{bundleId\}/);
});

test('TCC repair resolves a valid bundle identifier and never falls back to app name', () => {
  const permissions = read('electron/permissions/macPermissionHealth.ts');

  assert.match(permissions, /export function resolveMacBundleIdentifier/);
  assert.match(permissions, /build\?: \{ appId\?: unknown \}/);
  assert.match(permissions, /Ignoring invalid runtime bundle identifier/);
  assert.match(permissions, /Unable to resolve a valid macOS bundle identifier for TCC repair/);
  assert.doesNotMatch(permissions, /app\.getName\(\)/);
});

test('preload and renderer types expose repairTccPermission and health-rich permission payloads', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /repairTccPermission: \(/);
  assert.match(preload, /ipcRenderer\.invoke\('permissions:repair-tcc'/);
  assert.match(types, /repairTccPermission: \(scope: 'screen' \| 'microphone' \| 'both'\)/);
  assert.match(types, /screenHealth:/);
  assert.match(types, /systemAudioHealth:/);
  assert.match(types, /recommendedFix\?: 'open-settings' \| 'reset-tcc' \| 'restart-app' \| 'none'/);
  assert.match(types, /staleGrantSuspected\?: boolean/);
});

test('audio warning UI can branch to a repair-and-restart action for stale TCC grants', () => {
  const ui = read('src/components/NativelyInterface.tsx');

  assert.match(ui, /repair-and-restart/);
  assert.match(ui, /修复权限并重启/);
  assert.match(ui, /window\.electronAPI\?\.repairTccPermission\?/);
  assert.match(ui, /recommendedFix/);
  assert.match(ui, /staleGrantSuspected/);
});

test('permissions toaster uses effective screen health instead of only raw screen TCC status', () => {
  const toaster = read('src/components/onboarding/PermissionsToaster.tsx');

  assert.match(toaster, /screenHealth/);
  assert.match(toaster, /effectiveGranted/);
  assert.match(toaster, /recommendedFix/);
  assert.doesNotMatch(toaster, /setScrStatus\(p\.screen\s+as PermStatus\)/);
});

test('startup permissions toaster is skipped when effective permissions are already granted', () => {
  const app = read('src/App.tsx');
  const onboardingBlock = app.match(/\/\/ ── Onboarding[\s\S]*?\/\/ Listen for open-settings-tab/);

  assert.ok(onboardingBlock, 'App onboarding startup block should be present');
  assert.match(onboardingBlock[0], /checkPermissions\?\.\(\)/);
  assert.match(onboardingBlock[0], /screenHealth\?\.effectiveGranted/);
  assert.match(onboardingBlock[0], /systemAudioHealth\?\.effectiveGranted/);
  assert.match(onboardingBlock[0], /localStorage\.setItem\('natively_perms_shown_v1', '1'\)/);
  assert.doesNotMatch(
    onboardingBlock[0],
    /if \(!permsShown\)\s*{\s*\/\/ First ever launch[\s\S]*?setShowPermissionsToaster\(true\);[\s\S]*?}/,
    'missing localStorage marker must not unconditionally show the permissions toaster',
  );
});
