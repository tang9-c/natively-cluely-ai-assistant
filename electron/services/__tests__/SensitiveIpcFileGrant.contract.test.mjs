import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');

function handler(channel) {
  const start = ipc.indexOf(`'${channel}'`);
  assert.ok(start >= 0, `${channel} handler should exist`);
  const next = ipc.indexOf('safeHandle(', start + channel.length + 2);
  return ipc.slice(start, next >= 0 ? next : ipc.length);
}

test('profile upload handlers consume a main-process file grant instead of renderer paths', () => {
  for (const channel of ['profile:upload-resume', 'profile:upload-document', 'profile:upload-jd']) {
    const block = handler(channel);
    assert.match(block, /consume\(/);
    assert.match(block, /profile-document/);
    assert.doesNotMatch(block, /async \(_, filePath: string\)/);
    assert.doesNotMatch(block, /console\.(log|warn|error)\([^\n]*filePath/);
    assert.doesNotMatch(block, /redactForLog\(\[error\]\)/);
  }
  assert.match(handler('profile:select-file'), /issue\(/);
  assert.match(preload, /profileUploadResume: \(fileToken: string\)/);
});

test('streaming chat resolves one-time image grants and never accepts renderer file paths', () => {
  const block = handler('gemini-chat-stream');
  assert.match(block, /imageTokens/);
  assert.match(block, /streamChatWithFileGrants/);
  assert.doesNotMatch(block, /imagePaths\?: string\[\]/);
  assert.match(preload, /imageTokens\?: string\[\]/);
});

test('all renderer-exposed LLM image handlers consume chat image grants', () => {
  for (const channel of [
    'analyze-image-file',
    'gemini-chat',
    'generate-what-to-say',
    'generate-code-hint',
    'generate-brainstorm',
  ]) {
    const block = handler(channel);
    assert.match(block, /consumeChatImageGrants/);
    assert.doesNotMatch(block, /imagePaths\?: string\[\]/);
  }
  assert.doesNotMatch(preload, /analyzeImageFile: \(path: string\)/);
  assert.doesNotMatch(preload, /generateWhatToSay:[\s\S]{0,120}imagePaths\?: string\[\]/);
});

test('OpenAI STT save and test paths use the shared network target policy', () => {
  assert.match(handler('set-openai-stt-base-url'), /assertSafeHttpsUrl/);
  assert.match(ipc, /createSsrfSafeHttpsAgent/);
  assert.match(ipc, /proxy: false/);
});
