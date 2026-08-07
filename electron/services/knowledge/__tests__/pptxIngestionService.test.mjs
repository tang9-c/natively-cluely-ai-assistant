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

test('PptxSlideRenderer resolves its child script from the bundled Electron main directory', () => {
  const { resolvePptxRenderChildPath } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const bundledMainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-bundled-main-'));
  const nestedScriptPath = path.join(
    bundledMainDir,
    'services/knowledge/pptx/pptx-render-child.mjs',
  );
  fs.mkdirSync(path.dirname(nestedScriptPath), { recursive: true });
  fs.writeFileSync(nestedScriptPath, '');

  try {
    assert.equal(typeof resolvePptxRenderChildPath, 'function');
    assert.equal(resolvePptxRenderChildPath(bundledMainDir), nestedScriptPath);
  } finally {
    fs.rmSync(bundledMainDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer renderToTempImages cleans up temporary output directory when child render fails', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDirs = [];
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-fail-source-'));
  const sourcePath = path.join(sourceDir, 'input.pptx');
  fs.writeFileSync(sourcePath, 'fake');
  const renderer = new PptxSlideRenderer({
    createTempDir: async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-fail-test-'));
      tempDirs.push(tempDir);
      return tempDir;
    },
    runRenderChild: async () => {
      throw new Error('pptx_render_failed');
    },
  });

  try {
    await assert.rejects(() => renderer.renderToTempImages(sourcePath), /pptx_render_failed/);
    assert.equal(tempDirs.length, 2);
    assert.equal(tempDirs.every((tempDir) => !fs.existsSync(tempDir)), true);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer retries one transient child failure with a fresh temporary directory', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDirs = [];
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-retry-source-'));
  const sourcePath = path.join(sourceDir, 'input.pptx');
  fs.writeFileSync(sourcePath, 'fake');
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

  try {
    const deck = await renderer.renderToTempImages(sourcePath);
    assert.equal(attempts, 2);
    assert.equal(tempDirs.length, 2);
    assert.equal(fs.existsSync(tempDirs[0]), false);
    assert.equal(deck.tempDir, tempDirs[1]);
    await deck.cleanup();
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer stages the selected PPTX before starting the render child', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-selected-source-'));
  const sourcePath = path.join(sourceDir, 'customer-selected.pptx');
  fs.writeFileSync(sourcePath, 'selected-pptx-bytes');
  let childInputPath = null;
  const renderer = new PptxSlideRenderer({
    runRenderChild: async (_scriptPath, inputPath, outputDir) => {
      childInputPath = inputPath;
      assert.notEqual(inputPath, sourcePath);
      assert.equal(path.dirname(inputPath), outputDir);
      assert.equal(fs.readFileSync(inputPath, 'utf8'), 'selected-pptx-bytes');
      fs.writeFileSync(path.join(outputDir, 'slide-001.jpg'), 'ok');
    },
  });

  try {
    const deck = await renderer.renderToTempImages(sourcePath);
    assert.ok(childInputPath);
    await deck.cleanup();
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer classifies selected-file staging failures before starting a child', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  let childStarted = false;
  const renderer = new PptxSlideRenderer({
    runRenderChild: async () => {
      childStarted = true;
    },
  });

  await assert.rejects(
    () => renderer.renderToTempImages('/tmp/cueup-definitely-missing-selected.pptx'),
    (error) => {
      assert.equal(error.code, 'pptx_input_access_failed');
      assert.equal(error.stage, 'input_staging');
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(childStarted, false);
});

test('PptxSlideRenderer does not retry deterministic invalid-file failures', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-invalid-source-'));
  const sourcePath = path.join(sourceDir, 'input.pptx');
  fs.writeFileSync(sourcePath, 'fake');
  let attempts = 0;
  const renderer = new PptxSlideRenderer({
    runRenderChild: async () => {
      attempts += 1;
      const error = new Error('pptx_invalid_file');
      error.code = 'pptx_invalid_file';
      throw error;
    },
  });

  try {
    await assert.rejects(() => renderer.renderToTempImages(sourcePath), /pptx_invalid_file/);
    assert.equal(attempts, 1);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer renderToTempImages cleans up temporary output directory when child render hangs', async () => {
  const { PptxSlideRenderer } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDirs = [];
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-timeout-source-'));
  const sourcePath = path.join(sourceDir, 'input.pptx');
  fs.writeFileSync(sourcePath, 'fake');
  const renderer = new PptxSlideRenderer({
    createTempDir: async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-timeout-cleanup-test-'));
      tempDirs.push(tempDir);
      return tempDir;
    },
    renderTimeoutMs: 20,
    runRenderChild: async () => new Promise(() => {}),
  });

  try {
    await assert.rejects(() => renderer.renderToTempImages(sourcePath), /pptx_render_timeout/);
    assert.equal(tempDirs.length, 2);
    assert.equal(tempDirs.every((tempDir) => !fs.existsSync(tempDir)), true);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
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

test('PptxSlideRenderer runRenderChild classifies input read failures without exposing paths', async () => {
  const { runRenderChild } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-input-read-test-'));
  const scriptPath = path.join(tempDir, 'input-read-fail-child.mjs');
  fs.writeFileSync(scriptPath, "console.error(\"EACCES: permission denied, open '/private/customer/secret.pptx'\"); process.exit(1);");

  try {
    await assert.rejects(
      () => runRenderChild(scriptPath, '/tmp/staged-input.pptx', tempDir, 1000),
      (error) => {
        assert.equal(error.code, 'pptx_render_input_read_failed');
        assert.equal(error.stage, 'render_child_exit');
        assert.doesNotMatch(error.message, /private\/customer|secret\.pptx/);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer runRenderChild classifies missing renderer dependencies separately', async () => {
  const { runRenderChild } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-dependency-test-'));
  const scriptPath = path.join(tempDir, 'dependency-fail-child.mjs');
  fs.writeFileSync(scriptPath, "console.error(\"ERR_MODULE_NOT_FOUND Cannot find package 'sharp' imported from /private/app/file.mjs\"); process.exit(1);");

  try {
    await assert.rejects(
      () => runRenderChild(scriptPath, '/tmp/staged-input.pptx', tempDir, 1000),
      (error) => {
        assert.equal(error.code, 'pptx_renderer_dependency_missing');
        assert.equal(error.stage, 'render_child_start');
        assert.equal(error.retryable, false);
        assert.doesNotMatch(error.message, /sharp|private\/app/);
        return true;
      },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PptxSlideRenderer runRenderChild classifies a missing child entry script as a renderer asset failure', async () => {
  const { runRenderChild } = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxSlideRenderer.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-render-entry-test-'));

  try {
    await assert.rejects(
      () => runRenderChild(
        path.join(tempDir, 'pptx-render-child.mjs'),
        path.join(tempDir, 'input.pptx'),
        tempDir,
        1000,
      ),
      (error) => {
        assert.equal(error.code, 'pptx_renderer_asset_missing');
        assert.equal(error.stage, 'render_child_start');
        assert.equal(error.retryable, false);
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
