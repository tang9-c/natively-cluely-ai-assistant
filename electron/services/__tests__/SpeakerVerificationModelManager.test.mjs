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

test('SpeakerEmbeddingExtractor disables sherpa external buffers for Electron enrollment', () => {
  const source = read('electron/services/speaker/SpeakerEmbeddingExtractor.ts');
  assert.match(source, /this\.extractor\.compute\(stream,\s*false\)/);
  assert.match(source, /return new Float32Array\(embedding\)/);
  assert.doesNotMatch(source, /return this\.extractor\.compute\(stream\)/);
});

test('shared speaker embedding extractor reuses the same model instance until model path changes', async () => {
  const extractorPath = path.resolve('dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const moduleUrl = `${pathToFileURL(extractorPath).href}?shared-${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-shared-'));
  const modelA = path.join(dir, 'model-a.onnx');
  const modelB = path.join(dir, 'model-b.onnx');
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  const originalLoad = Module._load;
  let constructorCalls = 0;

  fs.writeFileSync(modelA, 'a');
  fs.writeFileSync(modelB, 'b');
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelA;
  Module._load = function(request, parent, isMain) {
    if (request === 'sherpa-onnx-node') {
      return {
        SpeakerEmbeddingExtractor: class {
          dim = 256;
          constructor() {
            constructorCalls += 1;
          }
          createStream() {
            return {
              acceptWaveform() {},
              inputFinished() {},
            };
          }
          isReady() {
            return true;
          }
          compute() {
            return new Float32Array(256);
          }
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const {
      getSharedSpeakerEmbeddingExtractor,
      resetSharedSpeakerEmbeddingExtractor,
    } = await import(moduleUrl);

    const first = getSharedSpeakerEmbeddingExtractor();
    const second = getSharedSpeakerEmbeddingExtractor();
    assert.equal(first, second);
    assert.equal(constructorCalls, 1);

    process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelB;
    const third = getSharedSpeakerEmbeddingExtractor();
    assert.notEqual(third, first);
    assert.equal(constructorCalls, 2);

    resetSharedSpeakerEmbeddingExtractor();
    const fourth = getSharedSpeakerEmbeddingExtractor();
    assert.notEqual(fourth, third);
    assert.equal(constructorCalls, 3);
  } finally {
    Module._load = originalLoad;
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
