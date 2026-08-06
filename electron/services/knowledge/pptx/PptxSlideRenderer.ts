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
const MAX_RENDER_ATTEMPTS = 2;

type PptxRenderStage = 'input_staging' | 'render_child_start' | 'render_child_exit' | 'render_child_timeout';

type PptxRenderError = Error & {
  code: string;
  stage: PptxRenderStage;
  retryable: boolean;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

const RETRYABLE_RENDER_CODES = new Set([
  'pptx_render_timeout',
  'pptx_render_process_start_failed',
  'pptx_render_process_crashed',
  'pptx_render_child_failed',
  'pptx_render_input_read_failed',
  'pptx_render_failed',
]);

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
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt += 1) {
      try {
        return await this.renderOnce(filePath);
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_RENDER_ATTEMPTS || !isRetryableRenderError(error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private async renderOnce(filePath: string): Promise<PptxRenderedDeck> {
    const tempDir = await this.createTempDir();
    const scriptPath = path.join(__dirname, 'pptx-render-child.mjs');
    const stagedInputPath = path.join(tempDir, 'input.pptx');

    try {
      try {
        await fs.promises.copyFile(filePath, stagedInputPath);
      } catch {
        throw createPptxRenderError('pptx_input_access_failed', 'input_staging', false);
      }
      await withRenderTimeout(
        this.runRenderChildImpl(scriptPath, stagedInputPath, tempDir, this.renderTimeoutMs),
        this.renderTimeoutMs,
      );
      const files = (await fs.promises.readdir(tempDir))
        .filter((name) => /^slide-\d+\.jpg$/.test(name))
        .sort();

      if (files.length === 0) {
        throw createPptxRenderError('pptx_no_slides', 'render_child_exit', false);
      }

      if (files.length > 200) {
        throw createPptxRenderError('pptx_too_many_slides', 'render_child_exit', false);
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
      reject(createPptxRenderError('pptx_render_timeout', 'render_child_timeout', true));
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
      finish(createPptxRenderError('pptx_render_timeout', 'render_child_timeout', true));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-MAX_CHILD_ERROR_DETAIL_CHARS);
    });
    child.on('error', () => finish(
      createPptxRenderError('pptx_render_process_start_failed', 'render_child_start', true),
    ));
    child.on('exit', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }

      if (signal) {
        finish(createPptxRenderError(
          'pptx_render_process_crashed',
          'render_child_exit',
          true,
          { exitCode: code, signal },
        ));
        return;
      }

      const message = stderr || `pptx_render_child_exit_${code}`;

      if (message.includes('pptx_too_many_slides')) {
        finish(createPptxRenderError('pptx_too_many_slides', 'render_child_exit', false, { exitCode: code }));
        return;
      }

      if (message.includes('invalid zip')) {
        finish(createPptxRenderError('pptx_invalid_file', 'render_child_exit', false, { exitCode: code }));
        return;
      }

      if (isMissingRendererAssetError(message)) {
        finish(createPptxRenderError('pptx_renderer_asset_missing', 'render_child_start', false, { exitCode: code }));
        return;
      }

      if (isMissingRendererDependencyError(message)) {
        finish(createPptxRenderError('pptx_renderer_dependency_missing', 'render_child_start', false, { exitCode: code }));
        return;
      }

      if (isInputReadError(message)) {
        finish(createPptxRenderError('pptx_render_input_read_failed', 'render_child_exit', true, { exitCode: code }));
        return;
      }

      finish(createPptxRenderError('pptx_render_child_failed', 'render_child_exit', true, { exitCode: code }));
    });
  });
}

function createPptxRenderError(
  code: string,
  stage: PptxRenderStage,
  retryable: boolean,
  metadata: { exitCode?: number | null; signal?: NodeJS.Signals | null } = {},
): PptxRenderError {
  const error = new Error(code) as PptxRenderError;
  error.code = code;
  error.stage = stage;
  error.retryable = retryable;
  error.exitCode = metadata.exitCode;
  error.signal = metadata.signal;
  return error;
}

function isRetryableRenderError(error: unknown): boolean {
  const candidate = error as Partial<PptxRenderError> | undefined;
  if (candidate?.retryable === true) return true;
  const code = candidate?.code || candidate?.message;
  return typeof code === 'string' && RETRYABLE_RENDER_CODES.has(code);
}

function isMissingRendererAssetError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('err_module_not_found') && normalized.includes('createpptxfontmapping.js');
}

function isMissingRendererDependencyError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('err_module_not_found')
    || normalized.includes('cannot find module')
    || normalized.includes('cannot find package');
}

function isInputReadError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('eacces')
    || normalized.includes('eperm')
    || normalized.includes('enoent')
    || normalized.includes('permission denied')
    || normalized.includes('no such file or directory');
}
