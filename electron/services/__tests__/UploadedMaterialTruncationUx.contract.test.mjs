import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('generate-what-to-say uses uploaded material formatter and keeps citations from all hits', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(source, /UploadedMaterialContextFormatter/);
  assert.match(handler, /formatUploadedMaterialContext\(materialHits\)/);
  assert.match(handler, /buildUploadedMaterialCitation/);
  assert.doesNotMatch(handler, /sourceType:\s*hit\.sourceType,[\s\S]{0,120}title:\s*hit\.title/);
  assert.doesNotMatch(handler, /hit\.parentText\}\s*`\)/);
});

test('generate-what-to-say exposes formatter truncation as a degraded reason', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /const\s+formattedMaterialContext\s*=\s*formatUploadedMaterialContext\(materialHits\)/);
  assert.match(handler, /uploadedMaterialContext\s*=\s*formatInjectedContext\(realtimeContextPlan\)/);
  assert.match(handler, /formattedMaterialContext\.truncated/);
  assert.match(handler, /degradedReasons\.push\('uploaded_material_context_truncated'\)/);
});

test('context pill maps uploaded material truncation reasons to user-facing labels', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /formatDegradedReasonForDisplay/);
  assert.match(source, /uploaded_material_context_truncated:\s*'上传资料已节选'/);
  assert.match(source, /uploaded_material_rag_failed:\s*'上传资料检索失败，本次答案未使用上传资料'/);
  assert.match(source, /no_relevant_uploaded_material:\s*'没有找到相关上传资料，本次答案仅使用会议上下文'/);
  assert.match(source, /上下文降级：\$\{item\}/);
  assert.doesNotMatch(source, /降级：\{latestDegradedReason\}/);
});
