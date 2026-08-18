import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Overlay reports deduplicated automatic hit state on Windows mouse movement', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /platform\s*!==\s*['"]win32['"]/);
  assert.match(source, /setOverlayAutomaticInteractive/);
  assert.match(source, /lastReported/);
  assert.match(source, /lastReported\s*===\s*interactive/);
  assert.match(source, /addEventListener\(['"]mousemove['"]/);
  assert.match(source, /elementFromPoint/);
  assert.doesNotMatch(source, /focusLocked/);
});

test('only visible CueUp surfaces are marked interactive', () => {
  const interfaceSource = read('src/components/NativelyInterface.tsx');
  const pillSource = read('src/components/ui/TopPill.tsx');

  assert.match(interfaceSource, /ref=\{shellRef\}[\s\S]{0,200}data-overlay-interactive/);
  assert.match(
    pillSource,
    /<div className="flex justify-center mt-2 select-none z-50">\s*<div\s*data-overlay-interactive="true"/,
  );

  const rootElement = interfaceSource.slice(
    interfaceSource.indexOf('ref={contentRef}'),
    interfaceSource.indexOf('<AnimatePresence>', interfaceSource.indexOf('ref={contentRef}')),
  );
  assert.doesNotMatch(rootElement, /data-overlay-interactive/);
});

test('pointer lock is released on mouseup, blur, and cleanup', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /pointerLocked\s*=\s*true/);
  assert.match(source, /pointerLocked\s*=\s*false/);
  assert.match(source, /addEventListener\(['"]mouseup['"]/);
  assert.match(source, /addEventListener\(['"]blur['"]/);
  assert.match(source, /removeEventListener\(['"]mousemove['"]/);
  assert.match(source, /report\(false\)/);
});

test('collapsing the active meeting overlay enables passthrough before hide is attempted', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const visibilityEffect = source.slice(
    source.indexOf('// Sync Window Visibility with Expanded State'),
    source.indexOf('// Keyboard shortcut to toggle expanded state'),
  );

  assert.match(
    visibilityEffect,
    /else\s*\{[\s\S]*setOverlayAutomaticInteractive\?\.\(false\)[\s\S]*setTimeout\(\(\)\s*=>\s*window\.electronAPI\.hideWindow\(\),\s*400\)/,
  );
  assert.ok(
    visibilityEffect.indexOf('setOverlayAutomaticInteractive?.(false)')
      < visibilityEffect.indexOf('setTimeout'),
    'passthrough must be enabled immediately, before the delayed hide request',
  );
});
