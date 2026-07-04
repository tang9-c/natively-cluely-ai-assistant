import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function sliceSafeHandleBlock(source, channel) {
  const start = source.indexOf(`safeHandle('${channel}'`);
  assert.ok(start >= 0, `${channel} handler should exist`);
  const next = source.indexOf("\n  safeHandle('", start + 20);
  return source.slice(start, next >= 0 ? next : undefined);
}

test('generate-code-hint gates screenshots scope before queue fallback and optimization', () => {
  const source = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const block = sliceSafeHandleBlock(source, 'generate-code-hint');

  const scopeCheck = block.indexOf('providerDataScopes');
  const queueFallback = block.indexOf('getScreenshotQueue');
  const optimize = block.indexOf('optimizeImagesForVision');

  assert.ok(scopeCheck >= 0, 'handler should read providerDataScopes');
  assert.ok(queueFallback >= 0, 'handler should still support screenshot queue fallback when allowed');
  assert.ok(optimize >= 0, 'handler should still optimize images when allowed');
  assert.ok(scopeCheck < queueFallback, 'scope check must happen before screenshot queue fallback');
  assert.ok(scopeCheck < optimize, 'scope check must happen before image optimization');
  assert.match(block, /screenshots\s*===\s*false|screenshots.*false/s);
  assert.match(block, /requestedDataScopes\s*:\s*\[\s*['"]screenshots['"]\s*\]/);
});
