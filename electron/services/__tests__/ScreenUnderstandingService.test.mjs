// ScreenUnderstandingService migration guards.
//
// Detailed executable coverage lives in VisionFirstScreenUnderstanding.test.mjs.
// These tests keep the legacy filename active without carrying skipped OCR
// assertions that no longer match the runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, '../../..');
const servicePath = path.join(root, 'electron/services/screen/ScreenUnderstandingService.ts');
const replacementPath = path.join(root, 'electron/services/__tests__/VisionFirstScreenUnderstanding.test.mjs');

test('vision-first replacement suite exists for ScreenUnderstandingService behavior', async () => {
  const stat = await fs.stat(replacementPath);
  assert.equal(stat.isFile(), true);
});

test('ScreenUnderstandingService runtime does not import the removed OCR pipeline', async () => {
  const source = await fs.readFile(servicePath, 'utf8');

  assert.match(source, /VISION-FIRST screen understanding pipeline/);
  assert.doesNotMatch(source, /from ['"].*Ocr/i);
  assert.doesNotMatch(source, /screenContextService\.captureScreenFromPath/);
  assert.match(source, /source_kind\?: 'vision' \| 'ocr_legacy'/);
});
