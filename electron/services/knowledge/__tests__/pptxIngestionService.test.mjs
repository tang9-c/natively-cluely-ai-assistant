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

test('PptxSlideRenderer renderToTempImages cleans up temporary output directory when child render fails', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-fail-test-'));
  const renderer = new PptxSlideRenderer({
    createTempDir: async () => tempDir,
    runRenderChild: async () => {
      throw new Error('pptx_render_failed');
    },
  });

  await assert.rejects(() => renderer.renderToTempImages('/tmp/fake-input.pptx'), /pptx_render_failed/);
  assert.equal(fs.existsSync(tempDir), false);
});

test('PptxIngestionService writes one chunk per slide and cleans temp files', async () => {
  const { PptxIngestionService } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxIngestionService.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-ingest-test-'));
  const image1 = path.join(tempDir, 'slide-001.jpg');
  const image2 = path.join(tempDir, 'slide-002.jpg');
  fs.writeFileSync(image1, 'one');
  fs.writeFileSync(image2, 'two');
  const chunks = [];
  const renderer = {
    renderToTempImages: async () => ({
      tempDir,
      slides: [{ slideIndex: 1, imagePath: image1 }, { slideIndex: 2, imagePath: image2 }],
      cleanup: async () => fs.rmSync(tempDir, { recursive: true, force: true }),
    }),
  };
  const descriptor = {
    describeSlide: async (_imagePath, slideIndex) => `# 标题\nSlide ${slideIndex}`,
    enhanceMarkdown: async () => ({
      summary: '摘要',
      hypotheticalQuestions: ['问1', '问2', '问3', '问4', '问5'],
    }),
  };
  const service = new PptxIngestionService(renderer, descriptor, async (_materialId, nextChunks) => {
    chunks.push(...nextChunks);
  });
  await service.ingest('mat_1', '/tmp/deck.pptx');
  assert.equal(chunks.length, 2);
  assert.match(chunks[0].cleanedText, /## 本页摘要/);
  assert.match(chunks[0].cleanedText, /问5/);
  assert.equal(chunks[0].metadata.source_format, 'pptx');
  assert.equal(chunks[0].metadata.slide_index, 1);
  assert.equal(fs.existsSync(tempDir), false);
});
