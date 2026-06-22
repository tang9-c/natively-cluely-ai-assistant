// Static structural assertions for the LocalEmbeddingProvider WASM fallback fix.
//
// Why static-only:
//   - transformers.js pulls in a native WASM loader that requires an Electron
//     runtime + a populated model cache; running the actual ensureLoaded()
//     path under node:test would require fully booting Electron and would be
//     non-deterministic. The risk we are guarding against is the *absence* of
//     the env.backends.onnx.wasm.proxy flag and the absence of a loadFailed
//     gate — both are detectable by reading the source.
//   - This mirrors the IntentClassifierProcessIsolation.test.mjs pattern,
//     which has been the project's convention for guarding boot-time wiring
//     against accidental removal.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('LocalEmbeddingProvider WASM fallback', () => {
  test('routes ONNX WASM through the worker proxy to avoid main-thread origin blocks', () => {
    const source = read('electron/rag/providers/LocalEmbeddingProvider.ts');

    assert.match(source, /env\.backends\.onnx\.wasm\.proxy\s*=\s*true/);
    // Guard the proxy assignment so it's a no-op on transformers.js builds
    // that don't expose the wasm backend (older versions). This keeps the
    // fix from breaking the build matrix.
    assert.match(source, /if\s*\(\s*env\.backends\?\.onnx\?\.wasm\s*\)/);
  });

  test('gates repeat loads with a loadFailed flag so embed() fails fast after a failed boot', () => {
    const source = read('electron/rag/providers/LocalEmbeddingProvider.ts');

    assert.match(source, /private\s+loadFailed\s*=\s*false/);

    // ensureLoaded must throw synchronously when loadFailed is already set,
    // BEFORE awaiting any loadingPromise — otherwise we still pay the WASM
    // boot cost on the retry.
    const loadFailedCheckIndex = source.indexOf('if (this.loadFailed)');
    const loadingPromiseCheckIndex = source.indexOf('if (this.loadingPromise)');
    assert.ok(loadFailedCheckIndex >= 0, 'ensureLoaded should short-circuit when loadFailed is set');
    assert.ok(loadingPromiseCheckIndex >= 0, 'ensureLoaded should still serialize concurrent loads');
    assert.ok(loadFailedCheckIndex < loadingPromiseCheckIndex, 'loadFailed gate must run before loadingPromise await');

    // The catch block must set loadFailed=true so the gate trips on subsequent
    // embed() calls. Resetting loadingPromise alone would let the next call
    // kick off another full WASM boot — the original regression.
    assert.match(source, /this\.loadFailed\s*=\s*true/);
  });

  test('embed and embedBatch still route through ensureLoaded so the gate protects them', () => {
    const source = read('electron/rag/providers/LocalEmbeddingProvider.ts');

    const embedIndex = source.indexOf('async embed(text: string)');
    const embedBatchIndex = source.indexOf('async embedBatch(texts: string[])');
    assert.ok(embedIndex >= 0, 'embed method should exist');
    assert.ok(embedBatchIndex >= 0, 'embedBatch method should exist');

    // Both methods must call ensureLoaded() (the gate) before touching this.pipe,
    // otherwise they would null-deref after a failed boot.
    const embedRegion = source.slice(embedIndex, embedIndex + 200);
    const embedBatchRegion = source.slice(embedBatchIndex, embedBatchIndex + 200);
    assert.match(embedRegion, /await this\.ensureLoaded\(\)/);
    assert.match(embedBatchRegion, /await this\.ensureLoaded\(\)/);
  });

  test('download-models.js still includes the local embedding model by default', () => {
    // Sanity check: the bug only matters because the embedding model is
    // downloaded unconditionally. If this assertion ever fires it means
    // someone changed the default, and the whole P1-2 premise needs
    // re-evaluation before removing the fallback.
    const source = read('scripts/download-models.js');
    assert.match(source, /paraphrase-multilingual-MiniLM-L12-v2/);
  });
});
