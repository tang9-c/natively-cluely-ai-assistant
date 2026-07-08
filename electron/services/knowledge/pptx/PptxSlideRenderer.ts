import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface PptxRenderedSlide {
  slideIndex: number;
  imagePath: string;
}

export interface PptxRenderedDeck {
  tempDir: string;
  slides: PptxRenderedSlide[];
  cleanup(): Promise<void>;
}

interface PptxSlideRendererDeps {
  createTempDir?: () => Promise<string>;
  runRenderChild?: (scriptPath: string, filePath: string, outputDir: string, timeoutMs: number) => Promise<void>;
  renderTimeoutMs?: number;
}

const DEFAULT_RENDER_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_CHILD_ERROR_DETAIL_CHARS = 4000;

export function createRenderedDeckForTest(
  tempDir: string,
  slides: PptxRenderedSlide[],
): PptxRenderedDeck {
  return {
    tempDir,
    slides,
    async cleanup() {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
  };
}

export class PptxSlideRenderer {
  private readonly createTempDir: () => Promise<string>;
  private readonly runRenderChildImpl: (
    scriptPath: string,
    filePath: string,
    outputDir: string,
    timeoutMs: number,
  ) => Promise<void>;
  private readonly renderTimeoutMs: number;

  constructor(deps: PptxSlideRendererDeps = {}) {
    this.createTempDir =
      deps.createTempDir ??
      (() => fs.promises.mkdtemp(path.join(os.tmpdir(), 'natively-pptx-')));
    this.runRenderChildImpl = deps.runRenderChild ?? runRenderChild;
    this.renderTimeoutMs = deps.renderTimeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  }

  async renderToTempImages(filePath: string): Promise<PptxRenderedDeck> {
    const tempDir = await this.createTempDir();
    const scriptPath = path.join(__dirname, 'pptx-render-child.mjs');

    try {
      await withRenderTimeout(
        this.runRenderChildImpl(scriptPath, filePath, tempDir, this.renderTimeoutMs),
        this.renderTimeoutMs,
      );
      const files = (await fs.promises.readdir(tempDir))
        .filter((name) => /^slide-\d+\.jpg$/.test(name))
        .sort();

      if (files.length === 0) {
        throw new Error('pptx_no_slides');
      }

      if (files.length > 200) {
        throw new Error('pptx_too_many_slides');
      }

      return createRenderedDeckForTest(
        tempDir,
        files.map((file, index) => ({
          slideIndex: index + 1,
          imagePath: path.join(tempDir, file),
        })),
      );
    } catch (error) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }
}

function withRenderTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('pptx_render_timeout'));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function runRenderChild(
  scriptPath: string,
  filePath: string,
  outputDir: string,
  timeoutMs: number = DEFAULT_RENDER_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, filePath, outputDir], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--max-old-space-size=4096',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const timeout = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
      finish(new Error('pptx_render_timeout'));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      if (code === 0) {
        finish();
        return;
      }

      const message = stderr || `pptx_render_child_exit_${code}`;

      if (message.includes('pptx_too_many_slides')) {
        finish(new Error('pptx_too_many_slides'));
        return;
      }

      if (message.includes('invalid zip')) {
        finish(new Error('pptx_invalid_file'));
        return;
      }

      if (isMissingRendererAssetError(message)) {
        finish(createPptxRenderError('pptx_renderer_asset_missing', message));
        return;
      }

      finish(createPptxRenderError('pptx_render_failed', message));
    });
  });
}

function createPptxRenderError(code: string, detail: string): Error & { code?: string } {
  const normalizedDetail = detail.trim().slice(0, MAX_CHILD_ERROR_DETAIL_CHARS);
  const error = new Error(normalizedDetail ? `${code}: ${normalizedDetail}` : code) as Error & { code?: string };
  error.code = code;
  return error;
}

function isMissingRendererAssetError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('err_module_not_found') && normalized.includes('createpptxfontmapping.js');
}
