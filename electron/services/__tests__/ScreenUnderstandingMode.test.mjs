// Screen understanding mode contract.
//
// The legacy OCR-first modes were intentionally retired in the vision-first
// pivot. Keep this file active so test:all catches accidental reintroduction of
// skipped OCR suites or stale UI contracts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, '../../..');

async function readRepoFile(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('screen understanding settings expose only vision-first runtime modes', async () => {
  const settings = await readRepoFile('electron/services/SettingsManager.ts');

  assert.match(settings, /VALID_SCREEN_UNDERSTANDING_MODES\s*=\s*\[\s*'vision_first'\s*,\s*'vision_only'\s*,\s*'private_vision'\s*\]/);
  assert.match(settings, /auto:\s*'vision_first'/);
  assert.match(settings, /ocr_only:\s*'vision_first'/);
  assert.match(settings, /private:\s*'private_vision'/);
});

test('settings UI no longer offers OCR-only or legacy auto/private modes', async () => {
  const ui = await readRepoFile('src/components/settings/AIProvidersSettings.tsx');

  assert.match(ui, /value:\s*'vision_first'\s+as const/);
  assert.match(ui, /value:\s*'vision_only'\s+as const/);
  assert.match(ui, /value:\s*'private_vision'\s+as const/);
  assert.doesNotMatch(ui, /value:\s*'ocr_only'\s+as const/);
  assert.doesNotMatch(ui, /value:\s*'auto'\s+as const/);
  assert.doesNotMatch(ui, /value:\s*'private'\s+as const/);
});

test('preload and renderer types use the same vision mode union', async () => {
  const preload = await readRepoFile('electron/preload.ts');
  const rendererTypes = await readRepoFile('src/types/electron.d.ts');

  for (const source of [preload, rendererTypes]) {
    assert.match(source, /'vision_first'\s*\|\s*'vision_only'\s*\|\s*'private_vision'/);
    assert.doesNotMatch(source, /'ocr_only'\s*\|/);
  }
});
