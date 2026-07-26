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

describe('IntentClassifier process isolation', () => {
  test('Electron main classifier does not load transformers or Electron app paths directly', () => {
    const source = read('electron/llm/IntentClassifier.ts');

    assert.doesNotMatch(source, /@huggingface\/transformers/);
    assert.doesNotMatch(source, /from ['"]electron['"]/);
    assert.doesNotMatch(source, /app\.getPath\(/);
    assert.doesNotMatch(source, /\bpipeline\(/);
    assert.match(source, /getIntentClassifierProcessHost\(\)\.classify/);
    assert.match(source, /getIntentClassifierProcessHost\(\)\.warmup/);
  });

  test('native zero-shot model loading is confined to the isolated worker process', () => {
    const host = read('electron/llm/IntentClassifierProcessHost.ts');
    const worker = read('electron/llm/intentClassifierWorkerProcess.ts');

    assert.match(host, /fork\(this\.workerPath/);
    assert.match(host, /ELECTRON_RUN_AS_NODE/);
    assert.doesNotMatch(host, /@huggingface\/transformers/);

    assert.match(worker, /@huggingface\/transformers/);
    assert.match(worker, /INTENT_CLASSIFIER_MODEL_ARTIFACT\.task/);
    assert.match(worker, /buildIntentClassifierPipelineOptions\(\)/);
    assert.match(worker, /assertIntentClassifierModelArtifact\(cacheDir\)/);
    assert.doesNotMatch(worker, /from ['"]electron['"]/);
    assert.doesNotMatch(worker, /app\.getPath\(/);
  });

  test('isolated worker preflights onnxruntime-node before importing Transformers.js', () => {
    const worker = read('electron/llm/intentClassifierWorkerProcess.ts');
    const preflightIndex = worker.indexOf('preflightOnnxRuntimeNode()');
    const importIndex = worker.indexOf('import(\'@huggingface/transformers\')');

    assert.ok(preflightIndex >= 0, 'worker should define and call onnxruntime-node preflight');
    assert.ok(importIndex >= 0, 'worker should dynamically import Transformers.js');
    assert.ok(preflightIndex < importIndex, 'preflight must run before Transformers.js import');
    assert.doesNotMatch(worker, /new Function\('specifier', 'return require\(specifier\)'\)/);
    assert.match(worker, /createRequire\(__filename\)/);
    assert.match(worker, /runtimeRequire\('onnxruntime-node'\)/);
    assert.match(worker, /runtimeRequire\('onnxruntime-node\/package\.json'\)/);
    assert.match(worker, /InferenceSession\?\.create/);
    assert.match(worker, /TRANSFORMERS_EXPECTED_ONNXRUNTIME_NODE/);
  });

  test('shared classifier metadata stays free of Electron and native model imports', () => {
    const shared = read('electron/llm/IntentClassifierShared.ts');

    assert.doesNotMatch(shared, /@huggingface\/transformers/);
    assert.doesNotMatch(shared, /from ['"]electron['"]/);
    assert.doesNotMatch(shared, /app\.getPath\(/);
  });
});
