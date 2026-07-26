import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.resolve('dist-electron/electron/rag/providers/LocalEmbeddingModelValidator.js'),
).href;

function writeCompleteModel(root) {
  const dir = path.join(root, 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  fs.mkdirSync(path.join(dir, 'onnx'), { recursive: true });
  for (const file of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
    fs.writeFileSync(path.join(dir, file), '{}');
  }
  fs.writeFileSync(path.join(dir, 'onnx/model_int8.onnx'), 'fixture');
}

function output(dimensions = 384, value = 0.25) {
  return { data: Float32Array.from({ length: dimensions }, () => value) };
}

test('完整的用户模型通过真实推理验证并保持优先级', async () => {
  const { loadFirstValidatedEmbeddingModel } = await import(moduleUrl);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-embedding-user-'));
  const bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-embedding-bundled-'));
  writeCompleteModel(root);
  writeCompleteModel(bundled);
  const attempts = [];

  const result = await loadFirstValidatedEmbeddingModel({
    candidates: [
      { source: 'downloaded', rootPath: root },
      { source: 'bundled', rootPath: bundled },
    ],
    dimensions: 384,
    createPipeline: async (rootPath) => {
      attempts.push(rootPath);
      return async () => output();
    },
  });

  assert.equal(result.source, 'downloaded');
  assert.deepEqual(attempts, [root]);
});

test('不完整的用户目录保持不变并回退到内置模型', async () => {
  const { loadFirstValidatedEmbeddingModel } = await import(moduleUrl);
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-embedding-user-'));
  const bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-embedding-bundled-'));
  fs.mkdirSync(path.join(user, 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'), { recursive: true });
  writeCompleteModel(bundled);
  const events = [];

  const result = await loadFirstValidatedEmbeddingModel({
    candidates: [
      { source: 'downloaded', rootPath: user },
      { source: 'bundled', rootPath: bundled },
    ],
    dimensions: 384,
    createPipeline: async () => async () => output(),
    onValidation: (event) => events.push(event),
  });

  assert.equal(result.source, 'bundled');
  assert.equal(fs.existsSync(user), true);
  assert.equal(events[0].code, 'missing_files');
  assert.equal(JSON.stringify(events).includes(user), false);
});

test('用户模型加载或推理失败时验证内置模型', async () => {
  const { loadFirstValidatedEmbeddingModel } = await import(moduleUrl);
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-embedding-user-'));
  const bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-embedding-bundled-'));
  writeCompleteModel(user);
  writeCompleteModel(bundled);

  const result = await loadFirstValidatedEmbeddingModel({
    candidates: [
      { source: 'downloaded', rootPath: user },
      { source: 'bundled', rootPath: bundled },
    ],
    dimensions: 384,
    createPipeline: async (rootPath) => {
      if (rootPath === user) throw new Error('fixture load failure');
      return async () => output();
    },
  });

  assert.equal(result.source, 'bundled');
});

test('错误维度和非有限数均不可通过验证', async () => {
  const { loadFirstValidatedEmbeddingModel } = await import(moduleUrl);
  for (const [badOutput, expectedCode] of [
    [output(383), 'invalid_dimensions'],
    [{ data: Float32Array.from({ length: 384 }, (_, index) => index === 5 ? Number.NaN : 0.1) }, 'non_finite_values'],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-embedding-invalid-'));
    writeCompleteModel(root);
    const events = [];
    await assert.rejects(() => loadFirstValidatedEmbeddingModel({
      candidates: [{ source: 'downloaded', rootPath: root }],
      dimensions: 384,
      createPipeline: async () => async () => badOutput,
      onValidation: (event) => events.push(event),
    }), /No validated local embedding model is available \(checked sources: downloaded\)/);
    assert.equal(events.at(-1).code, expectedCode);
  }
});

test('LocalEmbeddingProvider 接入顺序回退并只记录安全诊断字段', () => {
  const provider = fs.readFileSync('electron/rag/providers/LocalEmbeddingProvider.ts', 'utf8');
  const resolver = fs.readFileSync('electron/rag/EmbeddingProviderResolver.ts', 'utf8');
  const embeddingPipeline = fs.readFileSync('electron/rag/EmbeddingPipeline.ts', 'utf8');
  const telemetry = fs.readFileSync('electron/services/telemetry/TelemetryService.ts', 'utf8');
  assert.match(provider, /loadFirstValidatedEmbeddingModel/);
  assert.match(provider, /source:\s*'downloaded'/);
  assert.match(provider, /source:\s*'bundled'/);
  assert.match(provider, /name:\s*'rag_embedding_model_validation'/);
  assert.doesNotMatch(provider, /properties:\s*\{[^}]*rootPath/s);
  assert.match(resolver, /validatedLocalProvider\s*\?\?\s*factories\.local\(\)/);
  assert.match(embeddingPipeline, /EmbeddingProviderResolver\.resolve\(config, this\.fallbackProvider \?\? undefined\)/);
  assert.match(telemetry, /'rag_embedding_model_validation'/);
});
