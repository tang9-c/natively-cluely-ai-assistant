import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const css = fs.readFileSync(path.join(repoRoot, 'src/index.css'), 'utf8');
const nativelyInterface = fs.readFileSync(
  path.join(repoRoot, 'src/components/NativelyInterface.tsx'),
  'utf8',
);

function extractBlock(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} must exist`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') depth--;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`Could not extract block for ${selector}`);
}

test('light liquid glass uses dark overlay text instead of forced white text', () => {
  const block = extractBlock(`[data-theme='light'] [data-interface-theme="liquid-glass"]`);

  assert.match(block, /--overlay-text-primary:\s+rgba\(17,\s*24,\s*39,\s*0\.96\)/);
  assert.match(block, /--overlay-text-strong:\s+#111827/);
  assert.doesNotMatch(block, /--overlay-text-primary:\s+rgba\(255,\s*255,\s*255/);
});

test('liquid glass substrate tokens are opacity-aware and used by the shell', () => {
  assert.match(css, /--glass-shell-base:[^;]+var\(--overlay-opacity\)/);
  assert.match(css, /--glass-surface-base:[^;]+var\(--overlay-opacity\)/);
  assert.match(css, /--glass-transcript-bg:[^;]+var\(--overlay-opacity\)/);
  assert.match(
    css,
    /\[data-interface-theme="liquid-glass"\]\s+\.overlay-shell-surface\s*\{[\s\S]*var\(--glass-shell-base\)\s*!important;/,
  );
});

test('meeting status pills use overlay semantic tokens instead of fixed tailwind colors', () => {
  assert.match(nativelyInterface, /return 'overlay-status-error';/);
  assert.match(nativelyInterface, /return 'overlay-status-warn';/);
  assert.match(nativelyInterface, /return 'overlay-status-ok';/);
  assert.doesNotMatch(nativelyInterface, /return 'text-rose-600/);
  assert.doesNotMatch(nativelyInterface, /return 'text-emerald-600/);
});
