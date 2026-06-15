import fs from 'fs';
import path from 'path';
import {
  SENSEVOICE_DEFAULT_MODEL_ID,
  type SenseVoiceModelId,
  type SenseVoiceModelInfo,
} from './types';

export { SENSEVOICE_DEFAULT_MODEL_ID } from './types';

const MODEL_CATALOG: SenseVoiceModelInfo[] = [
  {
    id: SENSEVOICE_DEFAULT_MODEL_ID,
    name: 'SenseVoice Small Chinese',
    sizeMb: 250,
    status: 'missing',
  },
];

export function getSenseVoiceModelsDir(): string {
  if (process.env.SENSEVOICE_MODELS_DIR) {
    return process.env.SENSEVOICE_MODELS_DIR;
  }
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'sensevoice-models');
}

export function getSenseVoiceModelDir(
  modelId: SenseVoiceModelId = SENSEVOICE_DEFAULT_MODEL_ID,
  modelsDir: string = getSenseVoiceModelsDir(),
): string {
  return path.join(modelsDir, modelId);
}

export function resolveSenseVoiceModelFiles(
  modelId: SenseVoiceModelId = SENSEVOICE_DEFAULT_MODEL_ID,
  modelsDir: string = getSenseVoiceModelsDir(),
): { modelDir: string; modelFile: string; tokensFile: string } {
  const modelDir = getSenseVoiceModelDir(modelId, modelsDir);
  const int8Model = path.join(modelDir, 'model.int8.onnx');
  const fp32Model = path.join(modelDir, 'model.onnx');
  return {
    modelDir,
    modelFile: fs.existsSync(int8Model) ? int8Model : fp32Model,
    tokensFile: path.join(modelDir, 'tokens.txt'),
  };
}

export function isSenseVoiceModelCached(
  modelId: SenseVoiceModelId = SENSEVOICE_DEFAULT_MODEL_ID,
  modelsDir: string = getSenseVoiceModelsDir(),
): boolean {
  const { modelFile, tokensFile } = resolveSenseVoiceModelFiles(modelId, modelsDir);
  return fs.existsSync(tokensFile) && fs.existsSync(modelFile);
}

export function getAvailableSenseVoiceModels(
  modelsDir: string = getSenseVoiceModelsDir(),
): SenseVoiceModelInfo[] {
  return MODEL_CATALOG.map(model => ({
    ...model,
    status: isSenseVoiceModelCached(model.id, modelsDir) ? 'available' : 'missing',
    source: isSenseVoiceModelCached(model.id, modelsDir) ? 'downloaded' : undefined,
  }));
}

export function deleteSenseVoiceModel(modelId: SenseVoiceModelId = SENSEVOICE_DEFAULT_MODEL_ID): void {
  const modelDir = getSenseVoiceModelDir(modelId);
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.log(`[SenseVoiceModelManager] Deleted model: ${modelId}`);
  }
}
