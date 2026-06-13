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

test('LocalEmbeddingProvider prefers downloaded userData models before bundled fallback', () => {
  const src = read('electron/rag/providers/LocalEmbeddingProvider.ts');

  assert.match(src, /app\.getPath\('userData'\), 'models'/);
  assert.match(src, /process\.resourcesPath/);
  assert.match(src, /fs\.existsSync/);
  assert.match(src, /env\.localModelPath\s*=\s*this\.modelPath/);
});
