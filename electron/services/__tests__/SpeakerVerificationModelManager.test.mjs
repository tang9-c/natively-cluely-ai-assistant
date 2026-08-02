import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('LocalModelManager registers the speaker embedding model as an optional local model', () => {
  const source = read('electron/services/LocalModelManager.ts');
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_ID\s*=\s*'csukuangfj\/speaker-embedding-models'/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_FILENAME\s*=\s*'3dspeaker_speech_campplus_sv_zh-cn_16k-common\.onnx'/);
  assert.match(source, /name:\s*'本地声纹模型'/);
  assert.match(source, /description:\s*'用于在会议中识别你的发言为 ME'/);
  assert.match(source, /category:\s*'optional-enhancement'/);
  assert.match(source, /requiresExplicitEnable:\s*true/);
  assert.match(source, /requiredFiles:\s*\[SPEAKER_EMBEDDING_MODEL_RELATIVE_PATH\]/);
});

test('LocalModelManager exposes availability and file resolution helpers for speaker verification', () => {
  const source = read('electron/services/LocalModelManager.ts');
  assert.match(source, /export function isLocalSpeakerEmbeddingModelAvailable\(\): boolean/);
  assert.match(source, /export function resolveLocalModelFile\(modelId: string, relativePath: string\): string \| null/);
  assert.match(source, /hasModelFiles\(getModelsDir\(\), def\)/);
  assert.match(source, /hasModelFiles\(getBundledModelsDir\(\), def\)/);
});

test('speaker embedding download supports mirror fallback sources', () => {
  const source = read('electron/services/LocalModelManager.ts');
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_DEFAULT_ENDPOINTS\s*=\s*\['https:\/\/huggingface\.co', 'https:\/\/hf-mirror\.com'\]/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_DEFAULT_FILE_URLS/);
  assert.match(source, /https:\/\/feigenbaum\.cdn\.bcebos\.com\/onnx\/3dspeaker_speech_campplus_sv_zh-cn_16k-common\.onnx/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_FILE_URLS/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_ENDPOINTS/);
  assert.match(source, /speakerEmbeddingDownloadUrls\(\)/);
  assert.match(source, /downloadSingleFileModelWithFallback/);
  assert.match(source, /Tried \$\{sourceUrls\.length\} source\(s\)/);
  assert.match(source, /\.\.\.SPEAKER_EMBEDDING_MODEL_DEFAULT_FILE_URLS/);
  assert.doesNotMatch(
    source,
    /downloadSingleFileModel\(\s*def,\s*SPEAKER_EMBEDDING_MODEL_FILENAME,\s*`https:\/\/huggingface\.co\/\$\{SPEAKER_EMBEDDING_MODEL_ID\}/,
  );
});

test('LocalModelManager keeps sanitized speaker model download errors for diagnostics', () => {
  const source = read('electron/services/LocalModelManager.ts');
  assert.match(source, /errorMessage\?: string/);
  assert.match(source, /const downloadErrors = new Map<string, string>\(\)/);
  assert.match(source, /function sanitizeDownloadErrorMessage\(message: string\): string/);
  assert.match(source, /url\.search = ''/);
  assert.match(source, /downloadErrors\.set\(modelId, msg\)/);
  assert.match(source, /onError\?\.\(modelId, msg\)/);
  assert.match(source, /status:\s*'error' as const,\s*errorMessage/);
  assert.doesNotMatch(source, /onError\?\(modelId, e\?\.message/);
  assert.doesNotMatch(source, /return \{ success: false, error: e\?\.message/);
});

test('SpeakerEmbeddingExtractor resolves its default ONNX file through LocalModelManager', () => {
  const source = read('electron/services/speaker/SpeakerEmbeddingExtractor.ts');
  assert.match(source, /resolveLocalModelFile/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_ID/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_RELATIVE_PATH/);
  assert.doesNotMatch(source, /speakerModelManager/);
  assert.doesNotMatch(source, /speakerModelDownloader/);
});

test('speaker embedding worker resolver supports bundled Electron main layout', async () => {
  const resolverPath = path.resolve('dist-electron/electron/services/speaker/speakerEmbeddingWorkerPathResolver.js');
  const { resolveSpeakerEmbeddingWorkerPath } = await import(`${pathToFileURL(resolverPath).href}?worker-path-${Date.now()}`);
  const baseDir = path.join(os.tmpdir(), 'dist-electron', 'electron');
  const bundledWorker = path.join(baseDir, 'services', 'speaker', 'SpeakerEmbeddingExtractorWorker.js');
  const resolved = resolveSpeakerEmbeddingWorkerPath(baseDir, candidate => candidate === bundledWorker);

  assert.equal(resolved, bundledWorker);
});

test('speaker embedding model health supports lightweight checks and smoke-test diagnostics', () => {
  const source = read('electron/services/speaker/SpeakerEmbeddingExtractor.ts');
  const types = read('electron/services/speaker/speakerVerificationTypes.ts');
  assert.match(source, /getSpeakerEmbeddingModelHealth\(\s*options: SpeakerEmbeddingModelHealthOptions = \{\}/);
  assert.match(source, /smokeTest\?: boolean/);
  assert.match(source, /if \(!options\.smokeTest\)/);
  assert.match(source, /getSharedSpeakerEmbeddingExtractor\(\)/);
  assert.match(source, /await extractor\.extract\(speakerEmbeddingSmokeSamples\(\)\)/);
  assert.match(source, /modelDim: extractor\.dim/);
  assert.doesNotMatch(source, /SPEAKER_EMBEDDING_MODEL_DIM = 256/);
  assert.match(source, /loadLatencyMs: Math\.max\(0, Date\.now\(\) - startedAt\)/);
  assert.match(source, /message: '模型正常'/);
  assert.match(source, /message: '模型缺失'/);
  assert.match(source, /message: '模型加载失败'/);
  assert.match(types, /modelInstalled\?: boolean/);
  assert.match(types, /modelFile\?: string/);
  assert.match(types, /modelDim\?: number/);
  assert.match(types, /loadLatencyMs\?: number/);
  assert.match(types, /error\?: string/);
});

test('speaker embedding model health reports a missing configured model file', async () => {
  const extractorPath = path.resolve('dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const moduleUrl = `${pathToFileURL(extractorPath).href}?health-missing-${Date.now()}`;
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = path.join(os.tmpdir(), `missing-speaker-${Date.now()}.onnx`);

  try {
    const { getSpeakerEmbeddingModelHealth } = await import(moduleUrl);
    const health = getSpeakerEmbeddingModelHealth();
    assert.equal(health.state, 'model_missing');
    assert.equal(health.modelInstalled, false);
    assert.equal(typeof health.loadLatencyMs, 'number');
  } finally {
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
  }
});

test('speaker embedding model health smoke test reports ready with fake extractor dim', async () => {
  const extractorPath = path.resolve('dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const moduleUrl = `${pathToFileURL(extractorPath).href}?health-ready-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-health-'));
  const modelFile = path.join(dir, 'model.onnx');
  const workerFile = path.join(dir, 'fake-speaker-worker.cjs');
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  const originalWorkerFile = process.env.SPEAKER_EMBEDDING_WORKER_FILE;
  const originalLoad = Module._load;

  fs.writeFileSync(modelFile, 'model');
  fs.writeFileSync(workerFile, `
    process.on('message', (message) => {
      process.send({ requestId: message.requestId, embedding: Array.from({ length: 192 }, () => 0) });
    });
  `);
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelFile;
  process.env.SPEAKER_EMBEDDING_WORKER_FILE = workerFile;
  Module._load = function(request, parent, isMain) {
    if (request === 'sherpa-onnx-node') {
      throw new Error('parent process must not load sherpa for speaker health smoke');
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { getSpeakerEmbeddingModelHealth } = await import(moduleUrl);
    const health = await getSpeakerEmbeddingModelHealth({ smokeTest: true });
    assert.equal(health.state, 'ready');
    assert.equal(health.modelInstalled, true);
    assert.equal(health.modelDim, 192);
    assert.equal(typeof health.loadLatencyMs, 'number');
  } finally {
    Module._load = originalLoad;
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
    if (originalWorkerFile === undefined) delete process.env.SPEAKER_EMBEDDING_WORKER_FILE;
    else process.env.SPEAKER_EMBEDDING_WORKER_FILE = originalWorkerFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('speaker embedding model health smoke test fails fast when the worker exits cleanly without replying', async () => {
  const extractorPath = path.resolve('dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const moduleUrl = `${pathToFileURL(extractorPath).href}?health-clean-exit-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-health-clean-exit-'));
  const modelFile = path.join(dir, 'model.onnx');
  const workerFile = path.join(dir, 'fake-speaker-worker-clean-exit.cjs');
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  const originalWorkerFile = process.env.SPEAKER_EMBEDDING_WORKER_FILE;

  fs.writeFileSync(modelFile, 'model');
  fs.writeFileSync(workerFile, `
    process.on('message', () => {
      process.exit(0);
    });
  `);
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelFile;
  process.env.SPEAKER_EMBEDDING_WORKER_FILE = workerFile;

  try {
    const { getSpeakerEmbeddingModelHealth } = await import(moduleUrl);
    const result = await Promise.race([
      getSpeakerEmbeddingModelHealth({ smokeTest: true }),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 500)),
    ]);
    assert.notEqual(result, 'timeout');
    assert.equal(result.state, 'model_error');
  } finally {
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
    if (originalWorkerFile === undefined) delete process.env.SPEAKER_EMBEDDING_WORKER_FILE;
    else process.env.SPEAKER_EMBEDDING_WORKER_FILE = originalWorkerFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('speaker embedding model health rejects empty worker embeddings', async () => {
  const extractorPath = path.resolve('dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const moduleUrl = `${pathToFileURL(extractorPath).href}?health-empty-embedding-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-health-empty-'));
  const modelFile = path.join(dir, 'model.onnx');
  const workerFile = path.join(dir, 'fake-speaker-worker-empty.cjs');
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  const originalWorkerFile = process.env.SPEAKER_EMBEDDING_WORKER_FILE;

  fs.writeFileSync(modelFile, 'model');
  fs.writeFileSync(workerFile, `
    process.on('message', (message) => {
      process.send({ requestId: message.requestId, embedding: [] });
    });
  `);
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelFile;
  process.env.SPEAKER_EMBEDDING_WORKER_FILE = workerFile;

  try {
    const { getSpeakerEmbeddingModelHealth } = await import(moduleUrl);
    const health = await getSpeakerEmbeddingModelHealth({ smokeTest: true });
    assert.equal(health.state, 'model_error');
    assert.equal('modelDim' in health, false);
  } finally {
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
    if (originalWorkerFile === undefined) delete process.env.SPEAKER_EMBEDDING_WORKER_FILE;
    else process.env.SPEAKER_EMBEDDING_WORKER_FILE = originalWorkerFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('speaker embedding model health preserves initialization failures for later lightweight checks', async () => {
  const extractorPath = path.resolve('dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const moduleUrl = `${pathToFileURL(extractorPath).href}?health-failure-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-health-fail-'));
  const modelFile = path.join(dir, 'model.onnx');
  const workerFile = path.join(dir, 'fake-speaker-worker-fail.cjs');
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  const originalWorkerFile = process.env.SPEAKER_EMBEDDING_WORKER_FILE;

  fs.writeFileSync(modelFile, 'model');
  fs.writeFileSync(workerFile, `
    process.on('message', (message) => {
      process.send({ requestId: message.requestId, error: 'speaker_embedding_worker_failed' });
    });
  `);
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelFile;
  process.env.SPEAKER_EMBEDDING_WORKER_FILE = workerFile;

  try {
    const { getSpeakerEmbeddingModelHealth } = await import(moduleUrl);
    const smokeHealth = await getSpeakerEmbeddingModelHealth({ smokeTest: true });
    const lightweightHealth = getSpeakerEmbeddingModelHealth();
    assert.equal(smokeHealth.state, 'model_error');
    assert.equal(lightweightHealth.state, 'model_error');
  } finally {
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
    if (originalWorkerFile === undefined) delete process.env.SPEAKER_EMBEDDING_WORKER_FILE;
    else process.env.SPEAKER_EMBEDDING_WORKER_FILE = originalWorkerFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SpeakerEmbeddingExtractor disables sherpa external buffers for Electron enrollment', () => {
  const source = read('electron/services/speaker/SpeakerEmbeddingExtractorWorker.ts');
  assert.match(source, /return new Float32Array\(speakerExtractor\.compute\(stream,\s*false\)\)/);
  assert.doesNotMatch(source, /return speakerExtractor\.compute\(stream\)/);
});

test('shared speaker embedding extractor reuses the same model instance until model path changes', async () => {
  const extractorPath = path.resolve('dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const moduleUrl = `${pathToFileURL(extractorPath).href}?shared-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-shared-'));
  const modelA = path.join(dir, 'model-a.onnx');
  const modelB = path.join(dir, 'model-b.onnx');
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;

  fs.writeFileSync(modelA, 'a');
  fs.writeFileSync(modelB, 'b');
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelA;

  try {
    const {
      getSharedSpeakerEmbeddingExtractor,
      resetSharedSpeakerEmbeddingExtractor,
    } = await import(moduleUrl);

    const first = getSharedSpeakerEmbeddingExtractor();
    const second = getSharedSpeakerEmbeddingExtractor();
    assert.equal(first, second);
    assert.equal(first.modelId, 'model-a.onnx');
    assert.equal(first.dim, 0);

    process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelB;
    const third = getSharedSpeakerEmbeddingExtractor();
    assert.notEqual(third, first);
    assert.equal(third.modelId, 'model-b.onnx');

    resetSharedSpeakerEmbeddingExtractor();
    const fourth = getSharedSpeakerEmbeddingExtractor();
    assert.notEqual(fourth, third);
    assert.equal(fourth.modelId, 'model-b.onnx');
  } finally {
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
