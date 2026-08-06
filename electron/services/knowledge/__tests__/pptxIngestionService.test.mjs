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

test('PptxSlideRenderer retries one transient child failure with a fresh temporary directory', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDirs = [];
  let attempts = 0;
  const renderer = new PptxSlideRenderer({
    createTempDir: async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-retry-test-'));
      tempDirs.push(tempDir);
      return tempDir;
    },
    runRenderChild: async (_scriptPath, _filePath, outputDir) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('pptx_render_process_crashed');
        error.code = 'pptx_render_process_crashed';
        throw error;
      }
      fs.writeFileSync(path.join(outputDir, 'slide-001.jpg'), 'ok');
    },
  });

  const deck = await renderer.renderToTempImages('/tmp/fake-input.pptx');
  assert.equal(attempts, 2);
  assert.equal(tempDirs.length, 2);
  assert.equal(fs.existsSync(tempDirs[0]), false);
  assert.equal(deck.tempDir, tempDirs[1]);
  await deck.cleanup();
});

test('PptxSlideRenderer does not retry deterministic invalid-file failures', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  let attempts = 0;
  const renderer = new PptxSlideRenderer({
    runRenderChild: async () => {
      attempts += 1;
      const error = new Error('pptx_invalid_file');
      error.code = 'pptx_invalid_file';
      throw error;
    },
  });

  await assert.rejects(() => renderer.renderToTempImages('/tmp/fake-input.pptx'), /pptx_invalid_file/);
  assert.equal(attempts, 1);
});

test('PptxSlideRenderer renderToTempImages cleans up temporary output directory when child render hangs', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-timeout-cleanup-test-'));
  const renderer = new PptxSlideRenderer({
    createTempDir: async () => tempDir,
    renderTimeoutMs: 20,
    runRenderChild: async () => new Promise(() => {}),
  });

  await assert.rejects(() => renderer.renderToTempImages('/tmp/fake-input.pptx'), /pptx_render_timeout/);
  assert.equal(fs.existsSync(tempDir), false);
});

test('PptxSlideRenderer runRenderChild rejects when child process hangs', async () => {
  const { runRenderChild } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-timeout-test-'));
  const scriptPath = path.join(tempDir, 'hang-child.mjs');
  fs.writeFileSync(scriptPath, 'setInterval(() => {}, 1000);');

  try {
    await assert.rejects(
      () => runRenderChild(scriptPath, '/tmp/fake-input.pptx', tempDir, 20),
      /pptx_render_timeout/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer runRenderChild returns privacy-safe stage and code without child stderr', async () => {
  const { runRenderChild } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-stderr-test-'));
  const scriptPath = path.join(tempDir, 'fail-child.mjs');
  fs.writeFileSync(scriptPath, "console.error('sensitive customer path /private/customer/deck.pptx'); process.exit(1);");

  try {
    await assert.rejects(
      () => runRenderChild(scriptPath, '/tmp/fake-input.pptx', tempDir, 1000),
      (error) => {
        assert.equal(error.code, 'pptx_render_child_failed');
        assert.equal(error.stage, 'render_child_exit');
        assert.equal(error.retryable, true);
        assert.doesNotMatch(error.message, /sensitive customer path|private\/customer/);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer runRenderChild classifies signal exits as transient crashes', async () => {
  const { runRenderChild } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-crash-test-'));
  const scriptPath = path.join(tempDir, 'crash-child.mjs');
  fs.writeFileSync(scriptPath, "process.kill(process.pid, 'SIGKILL');");

  try {
    await assert.rejects(
      () => runRenderChild(scriptPath, '/tmp/fake-input.pptx', tempDir, 1000),
      (error) => {
        assert.equal(error.code, 'pptx_render_process_crashed');
        assert.equal(error.stage, 'render_child_exit');
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('KnowledgeMaterialService classifies missing PPTX renderer assets separately from invalid decks', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'electron/services/knowledge/KnowledgeMaterialService.ts'),
    'utf8',
  );

  assert.match(source, /pptx_renderer_asset_missing/);
  assert.match(source, /createPptxFontMapping\.js/);
  assert.match(source, /PPTX 渲染组件缺失/);
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
