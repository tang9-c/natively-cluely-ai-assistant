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
  const contextPrep = read('electron/services/context/WhatToSayContextPreparation.ts');
  const helper = read('electron/services/knowledge/UploadedMaterialContextContributionService.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(source, /UploadedMaterialContextContributionService/);
  assert.match(helper, /UploadedMaterialContextFormatter/);
  assert.match(helper, /formatUploadedMaterialContext\(selectedHits\)/);
  assert.match(helper, /buildUploadedMaterialCitation/);
  assert.match(handler, /prepareWhatToSayContext/);
  assert.match(contextPrep, /buildUploadedMaterialContextContribution\(/);
  assert.match(contextPrep, /input\.citations\.push\(\.\.\.contribution\.citations\)/);
  assert.match(contextPrep, /input\.contextCandidates\.push\(\.\.\.contribution\.contextCandidates\)/);
  assert.match(contextPrep, /deferContextPlan:\s*true/);
  assert.match(contextPrep, /formatInjectedContext\(realtimeContextPlan\)/);
  assert.doesNotMatch(handler, /sourceType:\s*hit\.sourceType,[\s\S]{0,120}title:\s*hit\.title/);
  assert.doesNotMatch(handler, /hit\.parentText\}\s*`\)/);
});

test('generate-what-to-say exposes formatter truncation as a degraded reason', () => {
  const source = read('electron/ipcHandlers.ts');
  const contextPrep = read('electron/services/context/WhatToSayContextPreparation.ts');
  const helper = read('electron/services/knowledge/UploadedMaterialContextContributionService.ts');

  assert.match(helper, /const\s+formatted\s*=\s*formatUploadedMaterialContext\(selectedHits\)/);
  assert.match(helper, /formatted\.truncated/);
  assert.match(helper, /allReasons\.push\('uploaded_material_context_truncated'\)/);
  assert.match(source, /prepareWhatToSayContext/);
  assert.match(contextPrep, /formatInjectedContext\(realtimeContextPlan\)/);
  assert.match(contextPrep, /contextBudgetDegradedReasons/);
});

test('manual overlay chat injects uploaded material context before calling the LLM', () => {
  const source = read('electron/ipcHandlers.ts');
  const chatHandler = sliceSafeHandleBlock(source, 'gemini-chat');
  const streamHandler = sliceSafeHandleBlock(source, 'gemini-chat-stream');
  const helper = read('electron/services/knowledge/UploadedMaterialContextContributionService.ts');

  assert.match(source, /UploadedMaterialContextContributionService/);
  assert.match(source, /buildUploadedMaterialContextContribution\(/);
  assert.match(chatHandler, /resolveUploadedMaterialChatContext\(event\.sender,\s*message,\s*context\)/);
  assert.match(streamHandler, /resolveUploadedMaterialChatContext\(event\.sender,\s*message,\s*context,\s*\{\s*allowTimeout:\s*true\s*\}\)/);
  assert.doesNotMatch(chatHandler, /providerScopes\.reference_files\s*===\s*false/);
  assert.doesNotMatch(streamHandler, /providerScopes\.reference_files\s*===\s*false/);
  assert.match(helper, /getDeniedDataScopes/);
});

test('manual overlay chat publishes context status to renderer', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');
  const ui = read('src/components/NativelyInterface.tsx');

  assert.match(ipc, /chat-context-status/);
  assert.match(preload, /onChatContextStatus/);
  assert.match(types, /onChatContextStatus/);
  assert.match(ui, /onChatContextStatus/);
  assert.match(ui, /setLatestDegradedReason/);
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
