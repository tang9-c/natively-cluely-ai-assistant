import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('HelpSettings matches current CueUp speech and model setup paths', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /帮助与设置指南/);
  assert.match(source, /Local SenseVoice/);
  assert.match(source, /QCLOUD API/);
  assert.match(source, /Doubao AUC/);
  assert.match(source, /默认聊天模型是 Doubao/);
  assert.match(source, /Doubao Seed 2\.0 Lite/);
  assert.match(source, /屏幕截图只会发送给具备视觉能力且数据范围允许的提供商/);

  assert.doesNotMatch(source, /CueUp supports over 8 different Audio engines/);
  assert.doesNotMatch(source, /Gemini 3\.1 Flash/);
  assert.doesNotMatch(source, /OpenRouter 密钥/);
  assert.doesNotMatch(source, /实时转录和向量模型不使用 QCLOUD/);
});

test('QCLOUD settings guide states STT is optional and embeddings stay local-first', () => {
  const source = read('src/components/settings/NativelyApiSettings.tsx');

  assert.match(source, /可在“语音”标签选择 QCLOUD API/);
  assert.match(source, /向量模型继续保持本地优先/);
  assert.doesNotMatch(source, /实时转录和向量模型不使用 QCLOUD/);
});

test('HelpSettings documents preset skills and transcript Markdown export', () => {
  const source = read('src/components/settings/HelpSettings.tsx');

  assert.match(source, /9\. 技能/);
  assert.match(source, /客户谈判复盘/);
  assert.match(source, /周例会\/月度经营会/);
  assert.match(source, /招聘面试评估/);
  assert.match(source, /文本去 AI 味/);
  assert.match(source, /会议详情.*转录.*用技能处理/s);
  assert.match(source, /生成 Markdown 文件后.*打开文件.*打开文件夹/s);
});
