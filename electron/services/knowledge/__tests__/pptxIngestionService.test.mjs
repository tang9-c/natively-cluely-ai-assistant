import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('PptxSlideRenderer cleanup removes temporary output directory', async () => {
  const { createRenderedDeckForTest } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-test-'));
  fs.writeFileSync(path.join(tempDir, 'slide-001.jpg'), 'x');
  const deck = createRenderedDeckForTest(tempDir, [
    { slideIndex: 1, imagePath: path.join(tempDir, 'slide-001.jpg') },
  ]);
  assert.equal(fs.existsSync(tempDir), true);
  await deck.cleanup();
  assert.equal(fs.existsSync(tempDir), false);
});
