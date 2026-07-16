import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { shouldShowHelpScrollHint } from '../settings/helpScrollHint.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsOverlaySource = fs.readFileSync(path.resolve(__dirname, '../SettingsOverlay.tsx'), 'utf8');
const helpSettingsSource = fs.readFileSync(path.resolve(__dirname, '../settings/HelpSettings.tsx'), 'utf8');

test('shows the help hint only while scrollable content remains below', () => {
  assert.equal(shouldShowHelpScrollHint({ scrollHeight: 1200, clientHeight: 600, scrollTop: 0 }), true);
  assert.equal(shouldShowHelpScrollHint({ scrollHeight: 1200, clientHeight: 600, scrollTop: 576 }), false);
  assert.equal(shouldShowHelpScrollHint({ scrollHeight: 1200, clientHeight: 600, scrollTop: 600 }), false);
  assert.equal(shouldShowHelpScrollHint({ scrollHeight: 600, clientHeight: 600, scrollTop: 0 }), false);
});

test('SettingsOverlay wires the hint to the help tab scroll container', () => {
  assert.match(settingsOverlaySource, /ref=\{settingsContentRef\}/);
  assert.match(settingsOverlaySource, /onScroll=\{syncHelpScrollHint\}/);
  assert.match(settingsOverlaySource, /new ResizeObserver\(syncHelpScrollHint\)/);
  assert.match(settingsOverlaySource, /activeTab === 'help' && showHelpScrollHint/);
  assert.match(settingsOverlaySource, /向下滚动查看更多/);
  assert.match(settingsOverlaySource, /pointer-events-none/);
  assert.match(settingsOverlaySource, /motion-reduce:animate-none/);
});

test('reconnects the observer when the dialog opens and watches growing help content', () => {
  assert.match(helpSettingsSource, /data-help-scroll-content/);
  assert.match(settingsOverlaySource, /querySelector\('\[data-help-scroll-content\]'\)/);
  assert.match(settingsOverlaySource, /observer\.observe\(helpContent\)/);
  assert.match(settingsOverlaySource, /!isOpen \|\| !container \|\| activeTab !== 'help'/);
  assert.match(settingsOverlaySource, /\[activeTab, isOpen, syncHelpScrollHint\]/);
});
