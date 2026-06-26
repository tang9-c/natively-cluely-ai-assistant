import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const source = fs.readFileSync(path.join(repoRoot, 'electron/WindowHelper.ts'), 'utf8');

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
