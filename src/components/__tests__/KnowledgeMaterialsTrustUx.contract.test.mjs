import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('knowledge material settings uses trust view model and honest failed-material action', () => {
  const source = read('src/components/settings/KnowledgeMaterialsSettings.tsx');
  const types = read('src/types/electron.d.ts');

  assert.match(source, /explainMaterialStatus/);
  assert.match(source, /重新上传新文件/);
  assert.match(source, /onClick=\{uploadMaterials\}/);
  assert.match(source, /canReindex/);
  assert.match(source, /primaryActionLabel/);
  assert.match(source, /embeddingStatus === 'failed'/);
  assert.match(source, /语义检索暂不可用/);
  assert.match(source, /embeddingStatus === 'initializing'/);
  assert.match(source, /语义检索正在初始化/);
  assert.match(source, /window\.setInterval/);
  assert.match(source, /window\.clearInterval/);
  assert.match(source, /result\.embeddingStatus \?\? \(result\.embeddingReady \? 'ready' : 'idle'\)/);
  assert.doesNotMatch(source, /embeddingReady === false/);
  assert.match(source, /语义索引失败/);
  assert.doesNotMatch(source, /title=\{canReindex \? '重新索引' : '仅已完成资料可重新索引'\}/);

  assert.match(types, /error_code\?: string \| null/);
  assert.match(types, /errorCode\?: string \| null/);
});

test('knowledge material settings presents PPTX as content extraction without image concepts', () => {
  const source = read('src/components/settings/KnowledgeMaterialsSettings.tsx');

  assert.match(source, /PPTX 需要先配置并选择 QCLOUD API/);
  assert.match(source, /旧版 \.ppt 不支持/);
  assert.doesNotMatch(source, /缩略图|截图|渲染|base64|vision|slide assets/i);
});

test('knowledge material settings keeps polling long enough for sequential PPTX analysis', () => {
  const source = read('src/components/settings/KnowledgeMaterialsSettings.tsx');

  assert.match(source, /const MATERIAL_POLL_INTERVAL_MS = 2_000/);
  assert.match(source, /const MATERIAL_POLL_MAX_ATTEMPTS = 300/);
  assert.match(source, /attempts >= MATERIAL_POLL_MAX_ATTEMPTS/);
});

test('background material polling does not keep foreground upload controls busy', () => {
  const source = read('src/components/settings/KnowledgeMaterialsSettings.tsx');
  const pollingStart = source.indexOf('  const startUploadPolling');
  const uploadStart = source.indexOf('  const uploadMaterials', pollingStart);
  const deleteStart = source.indexOf('  const deleteMaterial', uploadStart);
  const pollingBlock = source.slice(pollingStart, uploadStart);
  const uploadBlock = source.slice(uploadStart, deleteStart);

  assert.ok(pollingStart >= 0 && uploadStart > pollingStart && deleteStart > uploadStart);
  assert.doesNotMatch(pollingBlock, /setBusy\(/);
  assert.match(uploadBlock, /finally\s*\{\s*setBusy\(false\);\s*\}/);
  assert.doesNotMatch(uploadBlock, /if\s*\(!pollingRef\.current\)/);
  assert.match(source, /onClick=\{uploadMaterials\}[\s\S]{0,120}disabled=\{busy\}/);
});
