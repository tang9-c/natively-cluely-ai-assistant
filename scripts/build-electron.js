#!/usr/bin/env node
/**
 * Fast electron build using esbuild (transpile-only, no type checking).
 * ~10-50x faster than `tsc` for dev builds.
 * Run `npm run typecheck:electron` separately for type safety.
 */

const { build } = require('esbuild');
const path = require('path');
const fs = require('fs');
const { getElectronEntryPoints, prepareElectronOutDir } = require('./electron-build-entrypoints');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'dist-electron');

const buildMode = process.env.NATIVELY_ELECTRON_BUILD_MODE || 'development';
const entryPoints = getElectronEntryPoints(rootDir, buildMode);
prepareElectronOutDir(outDir, buildMode);

const start = Date.now();

build({
  entryPoints,
  bundle: true,           // resolve all static + dynamic imports so postProcessor
                         // is inlined and the path rewrite works (vs bundle:false
                         // which copies files as-is and leaves unresolved relative paths)
  outdir: outDir,
  outbase: rootDir,       // preserve directory structure (electron/main.ts → dist-electron/electron/main.js)
  platform: 'node',
  target: 'node20',
  format: 'cjs',          // Electron loads package.json main as CommonJS in this repo
                          // (package.json has no "type": "module").
  external: ['electron', 'better-sqlite3', 'keytar', 'sqlite-vec', 'sherpa-onnx-node'],
  sourcemap: process.env.NATIVELY_ELECTRON_SOURCEMAP === '1',
  jsx: 'automatic',
  loader: {
    '.ts': 'ts',
    '.js': 'js',
  },
  logLevel: 'warning',
}).then(() => {
  // pdf-parse (via pdfjs-dist) loads its worker from a relative "./pdf.worker.mjs"
  // path at runtime. Bundle the worker next to the packed electron output so the
  // production app can parse PDFs without "Cannot find module 'pdf.worker.mjs'".
  const pdfWorkerSource = path.resolve(
    rootDir,
    'node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
  );
  const pdfWorkerDest = path.resolve(outDir, 'electron/pdf.worker.mjs');
  if (fs.existsSync(pdfWorkerSource)) {
    fs.mkdirSync(path.dirname(pdfWorkerDest), { recursive: true });
    fs.copyFileSync(pdfWorkerSource, pdfWorkerDest);
    console.log('[build-electron] Copied pdf.worker.mjs');
  } else {
    console.warn('[build-electron] pdf.worker.mjs not found; PDF parsing may fail in production');
  }

  const pptxRenderChildSource = path.resolve(
    rootDir,
    'electron/services/knowledge/pptx/pptx-render-child.mjs',
  );
  const pptxRenderChildDest = path.resolve(
    outDir,
    'electron/services/knowledge/pptx/pptx-render-child.mjs',
  );
  if (fs.existsSync(pptxRenderChildSource)) {
    fs.mkdirSync(path.dirname(pptxRenderChildDest), { recursive: true });
    fs.copyFileSync(pptxRenderChildSource, pptxRenderChildDest);
    console.log('[build-electron] Copied pptx-render-child.mjs');
  }

  console.log(`[build-electron] Done in ${Date.now() - start}ms (${buildMode}, ${entryPoints.length} entries)`);
}).catch((err) => {
  console.error('[build-electron] Build failed:', err.message);
  process.exit(1);
});
