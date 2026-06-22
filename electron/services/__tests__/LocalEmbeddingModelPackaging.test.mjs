// Regression: packaged builds must load the bundled local embedding model from
// resources/models, not from @huggingface/transformers' default /models path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('LocalEmbeddingProvider points Transformers local model path at bundled models', () => {
  const src = read('electron/rag/providers/LocalEmbeddingProvider.ts');

  assert.match(src, /env\.localModelPath\s*=\s*this\.modelPath/);
  assert.match(src, /env\.allowLocalModels\s*=\s*true/);
  assert.match(src, /local_files_only:\s*true/);
});

test('electron-builder packages bundled local models as extra resources', () => {
  const pkg = JSON.parse(read('package.json'));
  const extraResources = pkg.build?.extraResources ?? [];

  assert.ok(
    extraResources.some(entry => entry?.from === 'resources/models' && entry?.to === 'models'),
    'package.json build.extraResources must copy resources/models to Resources/models'
  );
});

test('LocalModelManager treats bundled resources models as installed', () => {
  const src = read('electron/services/LocalModelManager.ts');

  assert.match(src, /process\.resourcesPath/);
  assert.match(src, /path\.join\(app\.getAppPath\(\), 'resources'\)/);
  assert.match(src, /\.\.\.getModelStatus\(def\)/);
});

test('LocalModelManager requires the intent classifier int8 artifact, not fp32 model.onnx', () => {
  const src = read('electron/services/LocalModelManager.ts');

  assert.match(src, /INTENT_CLASSIFIER_MODEL_ARTIFACT\.requiredRelativePath/);
  assert.match(src, /buildIntentClassifierPipelineOptions\(\)/);
  assert.match(src, /validateIntentClassifierModelArtifact\(rootDir\)/);
  assert.match(src, /optional-enhancement/);
  assert.match(src, /本地多语言意图增强（可选）/);
  assert.doesNotMatch(src, /requiredFiles:\s*\['onnx\/model\.onnx'\]/);
});

test('LocalEmbeddingProvider prefers downloaded userData models before bundled fallback', () => {
  const src = read('electron/rag/providers/LocalEmbeddingProvider.ts');

  assert.match(src, /app\.getPath\('userData'\), 'models'/);
  assert.match(src, /process\.resourcesPath/);
  assert.match(src, /fs\.existsSync/);
  assert.match(src, /env\.localModelPath\s*=\s*this\.modelPath/);
});

test('download-models does not install optional multilingual intent classifier by default', () => {
  const src = read('scripts/download-models.js');

  assert.doesNotMatch(src, /mdeberta-v3-base-xnli-multilingual-nli-2mil7/);
  assert.doesNotMatch(src, /onnx\/model_int8\.onnx/);
  assert.doesNotMatch(src, /Downloading Xenova\/mobilebert-uncased-mnli/);
});

test('LocalModelsPanel labels optional intent model separately from base models', () => {
  const src = read('src/components/LocalModelsPanel.tsx');

  assert.match(src, /基础本地模型/);
  assert.match(src, /可选增强包/);
  assert.match(src, /未开启时不会影响默认中文意图识别/);
  assert.match(src, /getLocalIntentEnhancementEnabled/);
  assert.match(src, /setLocalIntentEnhancementEnabled/);
});

test('local intent enhancement setting is exposed through SettingsManager, IPC, and preload', () => {
  const settings = read('electron/services/SettingsManager.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(settings, /localIntentEnhancementEnabled\?: boolean/);
  assert.match(settings, /getLocalIntentEnhancementEnabled\(\): boolean/);
  assert.match(ipc, /get-local-intent-enhancement-enabled/);
  assert.match(ipc, /set-local-intent-enhancement-enabled/);
  assert.match(preload, /getLocalIntentEnhancementEnabled/);
  assert.match(preload, /setLocalIntentEnhancementEnabled/);
  assert.match(types, /getLocalIntentEnhancementEnabled/);
  assert.match(types, /setLocalIntentEnhancementEnabled/);
});
