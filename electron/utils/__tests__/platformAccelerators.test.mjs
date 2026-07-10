// electron/utils/__tests__/platformAccelerators.test.mjs
//
// Behavioral coverage for platformAccelerators.ts:
//   - formatAcceleratorForPlatform: macOS uses Cmd, non-macOS uses Ctrl
//   - formatAcceleratorForPlatform: CommandOrControl is platform-aware
//   - formatAcceleratorForPlatform: bare "Command" / "Control" still work
//   - quitAcceleratorForPlatform: macOS = Command+Q, non-macOS = Ctrl+Q

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/utils/platformAccelerators.js');
const { formatAcceleratorForPlatform, quitAcceleratorForPlatform } = await import(pathToFileURL(modulePath).href);

test('formatAcceleratorForPlatform: CommandOrControl → Cmd on darwin', () => {
  assert.equal(formatAcceleratorForPlatform('CommandOrControl+Shift+P', 'darwin'), 'Cmd+Shift+P');
});

test('formatAcceleratorForPlatform: CommandOrControl → Ctrl on win32', () => {
  assert.equal(formatAcceleratorForPlatform('CommandOrControl+Shift+P', 'win32'), 'Ctrl+Shift+P');
});

test('formatAcceleratorForPlatform: CommandOrControl → Ctrl on linux', () => {
  assert.equal(formatAcceleratorForPlatform('CommandOrControl+Shift+P', 'linux'), 'Ctrl+Shift+P');
});

test('formatAcceleratorForPlatform: bare "Command" is normalized to "Cmd"', () => {
  assert.equal(formatAcceleratorForPlatform('Command+Q', 'darwin'), 'Cmd+Q');
  assert.equal(formatAcceleratorForPlatform('Command+Q', 'win32'), 'Cmd+Q');
});

test('formatAcceleratorForPlatform: bare "Control" is normalized to "Ctrl"', () => {
  assert.equal(formatAcceleratorForPlatform('Control+Shift+P', 'darwin'), 'Ctrl+Shift+P');
  assert.equal(formatAcceleratorForPlatform('Control+Shift+P', 'win32'), 'Ctrl+Shift+P');
});

test('formatAcceleratorForPlatform: no CommandOrControl token, no replacement', () => {
  assert.equal(formatAcceleratorForPlatform('Shift+P', 'darwin'), 'Shift+P');
  assert.equal(formatAcceleratorForPlatform('Shift+P', 'win32'), 'Shift+P');
});

test('formatAcceleratorForPlatform: multiple tokens in one accelerator', () => {
  assert.equal(formatAcceleratorForPlatform('CommandOrControl+CommandOrControl+P', 'darwin'), 'Cmd+Cmd+P');
  assert.equal(formatAcceleratorForPlatform('CommandOrControl+CommandOrControl+P', 'win32'), 'Ctrl+Ctrl+P');
});

test('quitAcceleratorForPlatform: darwin = Command+Q', () => {
  assert.equal(quitAcceleratorForPlatform('darwin'), 'Command+Q');
});

test('quitAcceleratorForPlatform: win32 = Ctrl+Q', () => {
  assert.equal(quitAcceleratorForPlatform('win32'), 'Ctrl+Q');
});

test('quitAcceleratorForPlatform: linux = Ctrl+Q', () => {
  assert.equal(quitAcceleratorForPlatform('linux'), 'Ctrl+Q');
});
