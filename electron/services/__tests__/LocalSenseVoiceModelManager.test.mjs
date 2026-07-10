import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/modelManager.js');

async function loadModelManager() {
  return import(pathToFileURL(modulePath).href);
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sensevoice-models-'));
}

test('SenseVoice model manager reports missing when required files are absent', async () => {
  const { SENSEVOICE_DEFAULT_MODEL_ID, getAvailableSenseVoiceModels, isSenseVoiceModelCached } = await loadModelManager();
  const modelsDir = makeTempDir();

  assert.equal(isSenseVoiceModelCached(SENSEVOICE_DEFAULT_MODEL_ID, modelsDir), false);

  const models = getAvailableSenseVoiceModels(modelsDir);
  assert.equal(models.length, 1);
  assert.equal(models[0].id, SENSEVOICE_DEFAULT_MODEL_ID);
  assert.equal(models[0].status, 'missing');
});

test('SenseVoice model manager reports available when tokens and an ONNX model exist', async () => {
  const { SENSEVOICE_DEFAULT_MODEL_ID, getAvailableSenseVoiceModels, isSenseVoiceModelCached } = await loadModelManager();
  const modelsDir = makeTempDir();
  const modelDir = path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID);
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'token');
  fs.writeFileSync(path.join(modelDir, 'model.int8.onnx'), 'onnx');

  assert.equal(isSenseVoiceModelCached(SENSEVOICE_DEFAULT_MODEL_ID, modelsDir), true);

  const [model] = getAvailableSenseVoiceModels(modelsDir);
  assert.equal(model.status, 'available');
  assert.equal(model.source, 'downloaded');
});

describe('SenseVoice model manager — path resolution', () => {
  const savedEnv = process.env.SENSEVOICE_MODELS_DIR;

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.SENSEVOICE_MODELS_DIR;
    } else {
      process.env.SENSEVOICE_MODELS_DIR = savedEnv;
    }
  });

  test('getSenseVoiceModelsDir honours SENSEVOICE_MODELS_DIR env override', async () => {
    const { getSenseVoiceModelsDir } = await loadModelManager();
    process.env.SENSEVOICE_MODELS_DIR = '/tmp/custom-sensevoice-models';
    assert.equal(getSenseVoiceModelsDir(), '/tmp/custom-sensevoice-models');
  });

  test('getSenseVoiceModelDir joins <modelsDir>/<modelId>', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, getSenseVoiceModelDir } = await loadModelManager();
    const dir = getSenseVoiceModelDir(SENSEVOICE_DEFAULT_MODEL_ID, '/tmp/x');
    assert.equal(dir, path.join('/tmp/x', SENSEVOICE_DEFAULT_MODEL_ID));
  });

  test('getSenseVoiceModelDir defaults to the default model id when omitted', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, getSenseVoiceModelDir } = await loadModelManager();
    const dir = getSenseVoiceModelDir(undefined, '/tmp/x');
    assert.equal(dir, path.join('/tmp/x', SENSEVOICE_DEFAULT_MODEL_ID));
  });

  test('resolveSenseVoiceModelFiles prefers int8 over fp32', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, resolveSenseVoiceModelFiles } = await loadModelManager();
    const modelsDir = makeTempDir();
    const modelDir = path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID);
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'model.int8.onnx'), 'int8');
    fs.writeFileSync(path.join(modelDir, 'model.onnx'), 'fp32');
    fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'tokens');

    const { modelFile, tokensFile, modelDir: returnedDir } = resolveSenseVoiceModelFiles(
      SENSEVOICE_DEFAULT_MODEL_ID,
      modelsDir,
    );
    assert.equal(modelFile, path.join(modelDir, 'model.int8.onnx'));
    assert.equal(tokensFile, path.join(modelDir, 'tokens.txt'));
    assert.equal(returnedDir, modelDir);
  });

  test('resolveSenseVoiceModelFiles falls back to fp32 when int8 is absent', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, resolveSenseVoiceModelFiles } = await loadModelManager();
    const modelsDir = makeTempDir();
    const modelDir = path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID);
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'model.onnx'), 'fp32');

    const { modelFile } = resolveSenseVoiceModelFiles(SENSEVOICE_DEFAULT_MODEL_ID, modelsDir);
    assert.equal(modelFile, path.join(modelDir, 'model.onnx'));
  });

  test('resolveSenseVoiceModelFiles returns fp32 path even when neither model file exists', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, resolveSenseVoiceModelFiles } = await loadModelManager();
    const modelsDir = makeTempDir();
    const { modelFile, tokensFile } = resolveSenseVoiceModelFiles(SENSEVOICE_DEFAULT_MODEL_ID, modelsDir);
    assert.equal(modelFile, path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID, 'model.onnx'));
    assert.equal(tokensFile, path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID, 'tokens.txt'));
  });
});

describe('SenseVoice model manager — caching & listing', () => {
  test('isSenseVoiceModelCached is true only when BOTH tokens.txt and an ONNX file exist', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, isSenseVoiceModelCached } = await loadModelManager();
    const modelsDir = makeTempDir();
    const modelDir = path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID);

    // Tokens only → false
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'tokens');
    assert.equal(isSenseVoiceModelCached(SENSEVOICE_DEFAULT_MODEL_ID, modelsDir), false);

    // Tokens + fp32 → true
    fs.writeFileSync(path.join(modelDir, 'model.onnx'), 'fp32');
    assert.equal(isSenseVoiceModelCached(SENSEVOICE_DEFAULT_MODEL_ID, modelsDir), true);
  });

  test('isSenseVoiceModelCached defaults to the default model id when omitted', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, isSenseVoiceModelCached } = await loadModelManager();
    const modelsDir = makeTempDir();
    const modelDir = path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID);
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'tokens');
    fs.writeFileSync(path.join(modelDir, 'model.int8.onnx'), 'int8');

    // No modelId arg → uses default
    assert.equal(isSenseVoiceModelCached(undefined, modelsDir), true);
    // Default id is the canonical sherpa-onnx SenseVoice release slug.
    assert.ok(SENSEVOICE_DEFAULT_MODEL_ID.startsWith('csukuangfj/'));
  });

  test('getAvailableSenseVoiceModels preserves catalog order and applies per-model status', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, getAvailableSenseVoiceModels } = await loadModelManager();
    const modelsDir = makeTempDir();
    const modelDir = path.join(modelsDir, SENSEVOICE_DEFAULT_MODEL_ID);
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'tokens');
    fs.writeFileSync(path.join(modelDir, 'model.int8.onnx'), 'int8');

    const models = getAvailableSenseVoiceModels(modelsDir);
    assert.equal(models.length, 1);
    assert.equal(models[0].id, SENSEVOICE_DEFAULT_MODEL_ID);
    assert.equal(models[0].status, 'available');
    assert.equal(models[0].source, 'downloaded');
    // Default model must still report a sensible sizeMb / name even when present.
    assert.equal(models[0].sizeMb, 250);
    assert.equal(models[0].name, 'SenseVoice Small Chinese');
  });

  test('getAvailableSenseVoiceModels omits source when model is missing', async () => {
    const { getAvailableSenseVoiceModels } = await loadModelManager();
    const modelsDir = makeTempDir();
    const models = getAvailableSenseVoiceModels(modelsDir);
    assert.equal(models[0].status, 'missing');
    assert.equal(models[0].source, undefined);
  });
});

describe('SenseVoice model manager — deleteSenseVoiceModel', () => {
  let originalLog;
  let originalEnv;

  beforeEach(() => {
    originalLog = console.log;
    console.log = () => {};
    originalEnv = process.env.SENSEVOICE_MODELS_DIR;
  });

  afterEach(() => {
    console.log = originalLog;
    if (originalEnv === undefined) {
      delete process.env.SENSEVOICE_MODELS_DIR;
    } else {
      process.env.SENSEVOICE_MODELS_DIR = originalEnv;
    }
  });

  test('deleteSenseVoiceModel removes the model directory if it exists', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, deleteSenseVoiceModel, getSenseVoiceModelDir } = await loadModelManager();
    // deleteSenseVoiceModel reads SENSEVOICE_MODELS_DIR at call time, so we
    // point it at our temp dir for isolation.
    const modelsDir = makeTempDir();
    process.env.SENSEVOICE_MODELS_DIR = modelsDir;
    const modelDir = getSenseVoiceModelDir(SENSEVOICE_DEFAULT_MODEL_ID);
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'tokens');

    deleteSenseVoiceModel(SENSEVOICE_DEFAULT_MODEL_ID);
    assert.equal(fs.existsSync(modelDir), false);
  });

  test('deleteSenseVoiceModel is a no-op when the model directory does not exist', async () => {
    const { SENSEVOICE_DEFAULT_MODEL_ID, deleteSenseVoiceModel } = await loadModelManager();
    const modelsDir = makeTempDir();
    process.env.SENSEVOICE_MODELS_DIR = modelsDir;
    // No throw when target dir is missing.
    deleteSenseVoiceModel(SENSEVOICE_DEFAULT_MODEL_ID);
    assert.equal(fs.existsSync(modelsDir), true);
  });
});
