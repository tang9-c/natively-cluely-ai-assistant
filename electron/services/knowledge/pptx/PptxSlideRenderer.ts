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
  runRenderChild?: (scriptPath: string, filePath: string, outputDir: string) => Promise<void>;
}

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
  ) => Promise<void>;

  constructor(deps: PptxSlideRendererDeps = {}) {
    this.createTempDir =
      deps.createTempDir ??
      (() => fs.promises.mkdtemp(path.join(os.tmpdir(), 'natively-pptx-')));
    this.runRenderChildImpl = deps.runRenderChild ?? runRenderChild;
  }

  async renderToTempImages(filePath: string): Promise<PptxRenderedDeck> {
    const tempDir = await this.createTempDir();
    const scriptPath = path.join(__dirname, 'pptx-render-child.mjs');

    try {
      await this.runRenderChildImpl(scriptPath, filePath, tempDir);
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

function runRenderChild(scriptPath: string, filePath: string, outputDir: string): Promise<void> {
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

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const message = stderr || `pptx_render_child_exit_${code}`;

      if (message.includes('pptx_too_many_slides')) {
        reject(new Error('pptx_too_many_slides'));
        return;
      }

      if (message.includes('invalid zip')) {
        reject(new Error('pptx_invalid_file'));
        return;
      }

      reject(new Error('pptx_render_failed'));
    });
  });
}
