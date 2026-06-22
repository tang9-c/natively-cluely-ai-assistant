// Static structural assertions for the CoreML EP fallback on Apple Silicon.
//
// Why static-only:
//   - whisperWorker runs as a Node worker_thread that dynamically imports
//     @huggingface/transformers and creates ONNX Runtime sessions; exercising
//     it under node:test would require a real Apple Silicon host + a populated
//     model cache, which isn't portable across CI. The actual risk here is
//     structural — someone removes the fallback in a refactor, or removes the
//     `triedCpuFallback` flag and lets it loop forever, or removes the
//     LocalWhisperSTT CoreML-aware hint. All of those are detectable from
//     source.
//
// Pattern follows LocalWhisperLanguageMapping.test.mjs: read source, assert
// that the wiring is intact.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Test file lives at electron/audio/whisper/__tests__/ — go up 4 levels to reach project root.
const root = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('whisperWorker CoreML EP fallback', () => {
  test('declares a per-init retry gate to prevent infinite CoreML retry loops', () => {
    const source = read('electron/audio/whisper/whisperWorker.ts');

    // Module-level flag exists.
    assert.match(source, /let\s+triedCpuFallback\s*=\s*false/);

    // Flag is reset at the top of every init handler invocation — a model
    // swap must get a fresh CoreML chance, otherwise a runtime upgrade that
    // fixes CoreML would still be blocked by stale state.
    const initBlockMatch = source.match(/if\s*\(msg\.type\s*===\s*['"]init['"]\)\s*\{([\s\S]*?)try\s*\{/);
    assert.ok(initBlockMatch, 'init handler should have a try block');
    assert.match(initBlockMatch[1], /triedCpuFallback\s*=\s*false/);
  });

  test('catch block retries once with cpu-only when CoreML is in the requested providers', () => {
    const source = read('electron/audio/whisper/whisperWorker.ts');

    // The retry must be gated on BOTH coremlRequested AND !triedCpuFallback
    // so we never loop. Either condition alone would let it spin.
    const catchBlockMatch = source.match(/}\s*catch\s*\(e:\s*any\)\s*\{([\s\S]*?)}\s*else\s+if\s*\(\s*msg\.type\s*===\s*['"]setPrompt['"]/);
    assert.ok(catchBlockMatch, 'catch block must precede the setPrompt branch');
    const catchBody = catchBlockMatch[1];

    assert.match(catchBody, /coremlRequested/);
    assert.match(catchBody, /!triedCpuFallback/);
    assert.match(catchBody, /retryEnv\.backends\.onnx\.executionProviders\s*=\s*\[\s*['"]cpu['"]\s*\]/);

    // The retry path must actually call pipeline() again with the same model
    // and post { type: 'ready' } on success so the host unblocks.
    assert.match(catchBody, /retryPipeline\(\s*['"]automatic-speech-recognition['"]\s*,\s*msg\.modelId/);
    assert.match(catchBody, /parentPort!\.postMessage\(\s*\{\s*type:\s*['"]ready['"]\s*\}\s*\)/);

    // Failure path: if the cpu retry also throws, the combined error message
    // must mention CoreML so LocalWhisperSTT can produce an accurate hint.
    assert.match(catchBody, /CoreML EP failed/);
    assert.match(catchBody, /cpu fallback also failed/);
  });

  test('non-CoreML provider failures still surface the original error path', () => {
    // Regression guard: we must not silently retry cpu when the user
    // requested dml/cuda/etc. — that would corrupt the Windows / Linux paths.
    const source = read('electron/audio/whisper/whisperWorker.ts');

    const catchBlockMatch = source.match(/}\s*catch\s*\(e:\s*any\)\s*\{([\s\S]*?)}\s*else\s+if\s*\(\s*msg\.type\s*===\s*['"]setPrompt['"]/);
    const catchBody = catchBlockMatch[1];

    // The retry gate must explicitly check for coreml, not just "any failed
    // provider list". If someone refactors to retry-on-any-failure, Windows
    // DML would suddenly silently downgrade to CPU too.
    assert.match(catchBody, /coreml/i);
    // The original `Failed to load model: ${e.message}` branch must still
    // exist for the non-CoreML path.
    assert.match(catchBody, /Failed to load model: \$\{e\.message\}/);
  });
});

describe('LocalWhisperSTT CoreML-aware error hint', () => {
  test('distinguishes CoreML EP failure from plain model-not-found', () => {
    const source = read('electron/audio/LocalWhisperSTT.ts');

    // Must still gate on 'Failed to load model' so unrelated messages don't
    // get re-routed.
    assert.match(source, /msg\.message\.includes\(['"]Failed to load model['"]\)/);

    // Must inspect message body for CoreML/coreml keyword to branch the hint.
    assert.match(source, /coreml/i);

    // The CoreML-branch hint must mention CoreML / CPU fallback so the user
    // can recognize the actual cause (rather than chasing a phantom missing
    // model).
    const coremlBranchMatch = source.match(/isCoreMlFailure\s*\?\s*([\s\S]*?):\s*['"]Local Whisper model not found/);
    assert.ok(coremlBranchMatch, 'CoreML branch should exist alongside the model-not-found branch');
    assert.match(coremlBranchMatch[1], /CoreML/i);
    assert.match(coremlBranchMatch[1], /CPU fallback/i);
  });
});

describe('inferenceConfig Apple Silicon decision', () => {
  test('keeps CoreML as the requested provider on Apple Silicon so the worker fallback path is exercised', () => {
    // Sanity check: if someone changes resolveInferenceConfig to skip
    // CoreML entirely, this fallback becomes dead code. Guard the wiring.
    const source = read('electron/audio/whisper/inferenceConfig.ts');

    const appleSiliconMatch = source.match(/platform\s*===\s*['"]darwin['"]\s*&&\s*arch\s*===\s*['"]arm64['"][\s\S]*?return\s*\{[^}]*\}/);
    assert.ok(appleSiliconMatch, 'Apple Silicon branch should exist');
    assert.match(appleSiliconMatch[0], /coreml/);
  });
});
