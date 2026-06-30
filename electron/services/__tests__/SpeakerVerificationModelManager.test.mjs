import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

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

test('SpeakerEmbeddingExtractor resolves its default ONNX file through LocalModelManager', () => {
  const source = read('electron/services/speaker/SpeakerEmbeddingExtractor.ts');
  assert.match(source, /resolveLocalModelFile/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_ID/);
  assert.match(source, /SPEAKER_EMBEDDING_MODEL_RELATIVE_PATH/);
  assert.doesNotMatch(source, /speakerModelManager/);
  assert.doesNotMatch(source, /speakerModelDownloader/);
});
