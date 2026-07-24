import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ALWAYS_CHINESE = /ALWAYS answer in Simplified Chinese, regardless of the language of the user's question/;

test('会议和全局 RAG 对中文、英文和纯缩写问题都注入中文回答规则', async () => {
  const moduleUrl = pathToFileURL(path.resolve('dist-electron/electron/rag/prompts.js')).href;
  const { buildRAGPrompt } = await import(moduleUrl);
  for (const scope of ['meeting', 'global']) {
    for (const query of ['700万是多少？', 'KPI', 'What decisions were made?']) {
      const prompt = buildRAGPrompt(query, '采购流程讨论', scope, 'open_question');
      assert.match(prompt, ALWAYS_CHINESE);
      assert.ok(prompt.includes(query));
    }
  }
});

test('会议搜索不再进入普通聊天降级，全局普通聊天仍使用中文系统提示词', () => {
  const meeting = fs.readFileSync('src/components/MeetingChatOverlay.tsx', 'utf8');
  const global = fs.readFileSync('src/components/GlobalChatOverlay.tsx', 'utf8');
  assert.match(global, ALWAYS_CHINESE);
  assert.doesNotMatch(meeting, /buildMeetingFallbackSystemPrompt/);
  assert.doesNotMatch(meeting, /streamGeminiChat/);
  assert.match(global, /streamGeminiChat\(\s*question,\s*undefined,\s*globalFallbackSystemPrompt,\s*\{\s*skipSystemPrompt:\s*true/);
});
