import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

test('gemini-chat resolves active skill for requestType chat', () => {
  const idx = source.indexOf("'gemini-chat'");
  assert.ok(idx >= 0, 'gemini-chat handler must exist');
  const block = source.slice(idx, source.indexOf("'gemini-chat-stream'", idx));
  assert.match(block, /resolveChatPromptOptions\(message,\s*options\?\.skipSystemPrompt\)/);
  assert.match(source, /requestType:\s*['"]chat['"]/);
  assert.match(source, /latestText:\s*message/);
  assert.match(block, /chatPromptOptions/);
  assert.match(block, /chatWithGemini\(/);
});

test('gemini-chat-stream resolves active skill and passes public skill shape only', () => {
  const idx = source.indexOf("'gemini-chat-stream'");
  assert.ok(idx >= 0, 'gemini-chat-stream handler must exist');
  const block = source.slice(idx, source.indexOf("safeHandle('quit-app'", idx));
  assert.match(block, /resolveChatPromptOptions\(message,\s*options\?\.skipSystemPrompt\)/);
  assert.match(source, /activeSkill:\s*resolvedSkill\s*\?/);
  assert.match(source, /id:\s*resolvedSkill\.id/);
  assert.match(source, /name:\s*resolvedSkill\.name/);
  assert.match(source, /promptBlock:\s*resolvedSkill\.promptBlock/);
  assert.doesNotMatch(block, /SKILL\.md/);
});
