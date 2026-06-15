import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
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
