import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const modulePath = path.resolve(
  __dirname, '../../../dist-electron/electron/llm/IntentClassifierModelArtifact.js',
);

function loadModule() {
  return cjsRequire(modulePath);
}

function writeFile(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(bytes, 1));
}

function writeSparseFile(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, 'w');
  try {
    fs.ftruncateSync(fd, bytes);
  } finally {
    fs.closeSync(fd);
  }
}

describe('IntentClassifier model artifact strategy', () => {
  test('pins zero-shot loading to int8 model_int8.onnx instead of fp32 model.onnx', () => {
    const { INTENT_CLASSIFIER_MODEL_ARTIFACT, buildIntentClassifierPipelineOptions } = loadModule();
    const options = buildIntentClassifierPipelineOptions();

    assert.equal(INTENT_CLASSIFIER_MODEL_ARTIFACT.modelId, 'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7');
    assert.equal(INTENT_CLASSIFIER_MODEL_ARTIFACT.dtype, 'int8');
    assert.equal(INTENT_CLASSIFIER_MODEL_ARTIFACT.modelFileName, 'model');
    assert.equal(INTENT_CLASSIFIER_MODEL_ARTIFACT.requiredRelativePath, 'onnx/model_int8.onnx');
    assert.equal(INTENT_CLASSIFIER_MODEL_ARTIFACT.forbiddenFp32RelativePath, 'onnx/model.onnx');
    assert.equal(options.dtype, 'int8');
    assert.equal(options.model_file_name, 'model');
    assert.equal(options.local_files_only, false);
  });

  test('validates downloaded quantized artifact and rejects fp32-only cache', () => {
    const { validateIntentClassifierModelArtifact } = loadModule();
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-artifact-'));

    writeFile(
      path.join(cacheDir, 'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7/onnx/model.onnx'),
      1024,
    );

    const fp32Only = validateIntentClassifierModelArtifact(cacheDir);
    assert.equal(fp32Only.ok, false);
    assert.match(fp32Only.error, /model_int8\.onnx/);

    writeFile(
      path.join(cacheDir, 'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7/onnx/model_int8.onnx'),
      1024,
    );

    const quantized = validateIntentClassifierModelArtifact(cacheDir);
    assert.equal(quantized.ok, true);
    assert.match(quantized.path, /model_int8\.onnx$/);
  });

  test('rejects suspiciously large quantized artifact before it can be treated as valid', () => {
    const { INTENT_CLASSIFIER_MODEL_ARTIFACT, validateIntentClassifierModelArtifact } = loadModule();
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-artifact-large-'));

    writeSparseFile(
      path.join(cacheDir, 'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7/onnx/model_int8.onnx'),
      INTENT_CLASSIFIER_MODEL_ARTIFACT.maxBytes + 1,
    );

    const result = validateIntentClassifierModelArtifact(cacheDir);
    assert.equal(result.ok, false);
    assert.match(result.error, /too large/i);
  });
});
