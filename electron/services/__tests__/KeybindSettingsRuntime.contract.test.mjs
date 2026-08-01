import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const displayedShortcuts = [
  ['toggleVisibility', 'general:toggle-visibility'],
  ['toggleMousePassthrough', 'general:toggle-mouse-passthrough'],
  ['processScreenshots', 'general:process-screenshots'],
  ['captureAndProcess', 'general:capture-and-process'],
  ['resetCancel', 'general:reset-cancel'],
  ['takeScreenshot', 'general:take-screenshot'],
  ['selectiveScreenshot', 'general:selective-screenshot'],
  ['whatToAnswer', 'chat:whatToAnswer'],
  ['clarify', 'chat:clarify'],
  ['dynamicAction4', 'chat:dynamicAction4'],
  ['answer', 'chat:answer'],
  ['codeHint', 'chat:codeHint'],
  ['brainstorm', 'chat:brainstorm'],
  ['scrollUp', 'chat:scrollUp'],
  ['scrollDown', 'chat:scrollDown'],
  ['scrollLeft', 'chat:scrollLeft'],
  ['scrollRight', 'chat:scrollRight'],
  ['focusInput', 'chat:focusInput'],
  ['moveWindowUp', 'window:move-up'],
  ['moveWindowDown', 'window:move-down'],
  ['moveWindowLeft', 'window:move-left'],
  ['moveWindowRight', 'window:move-right'],
];

test('settings keybinds listed in the UI have frontend/backend mappings and defaults', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  const hook = read('src/hooks/useShortcuts.ts');
  const manager = read('electron/services/KeybindManager.ts');

  for (const [frontendId, backendId] of displayedShortcuts) {
    assert.match(
      settings,
      new RegExp(`shortcuts\\.${frontendId}|id:\\s*['"]${frontendId}['"]`),
      `${frontendId} must be listed in settings UI`,
    );
    assert.match(
      hook,
      new RegExp(`kb\\.id === ['"]${backendId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
      `${frontendId} must map backend -> frontend`,
    );
    assert.match(
      hook,
      new RegExp(`case ['"]${frontendId}['"]:\\s*backendId = ['"]${backendId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
      `${frontendId} must map frontend -> backend`,
    );
    assert.match(
      manager,
      new RegExp(`id:\\s*['"]${backendId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
      `${backendId} must have a default KeybindManager entry`,
    );
  }
});

test('focusInput global shortcut is consumed by the renderer and focuses the text input', () => {
  const renderer = read('src/components/NativelyInterface.tsx');

  assert.match(renderer, /action === ['"]focusInput['"]/);
  assert.match(renderer, /textInputRef\.current\?\.focus\(\)/);
});

test('dynamicAction4 shortcut reads the latest action button mode instead of a stale closure', () => {
  const renderer = read('src/components/NativelyInterface.tsx');

  assert.match(renderer, /actionButtonModeRef/);
  assert.match(renderer, /actionButtonModeRef\.current = actionButtonMode/);
  assert.match(renderer, /actionButtonModeRef\.current === ['"]brainstorm['"]/);
});

test('settings clarify that chat shortcuts are global in overlay mode', () => {
  const settings = read('src/components/SettingsOverlay.tsx');

  assert.match(settings, /聊天类快捷键在会议悬浮窗模式下全局生效/);
});
