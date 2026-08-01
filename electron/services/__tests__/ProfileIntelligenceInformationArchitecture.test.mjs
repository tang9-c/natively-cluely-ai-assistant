import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('profile intelligence keeps the product name while using clear global context sections', () => {
  const source = read('src/components/ProfileIntelligenceSettings.tsx');

  assert.match(source, />档案智能</);
  [
    '管理 AI 在所有会议中可使用的身份、背景、场景资料和回答偏好',
    '启用状态',
    '基础身份',
    '资料来源',
    '回答偏好',
    '当前可用线索',
    '在会议中使用档案智能',
  ].forEach((text) => assert.match(source, new RegExp(text)));

  [
    '身份节点未激活',
    '角色引擎',
    '初始化知识库',
    'Profile 智能未激活',
  ].forEach((text) => assert.doesNotMatch(source, new RegExp(text)));
});

test('profile intelligence keeps job-specific tools in a secondary job enhancement area', () => {
  const source = read('src/components/ProfileIntelligenceSettings.tsx');

  assert.match(source, /求职增强/);
  assert.match(source, /公司情报/);
  assert.doesNotMatch(source, /<h3[^>]*>谈判脚本<\/h3>/);
  assert.doesNotMatch(source, /生成脚本/);
  assert.match(source, /profileData\?\.hasActiveJD/);
});

test('profile intelligence inline company research refresh bypasses cache', () => {
  const source = read('src/components/ProfileIntelligenceSettings.tsx');
  assert.match(
    source,
    /profileResearchCompany\?\.\(\s*profileData\.activeJD\.company,\s*\{\s*forceRefresh:\s*Boolean\(companyDossier\)\s*\}/s,
  );
});

test('profile intelligence avoids English-only unavailable negotiation copy', () => {
  const source = read('src/components/ProfileIntelligenceSettings.tsx');
  assert.doesNotMatch(source, /Generate a personalized opening, justification &amp; counter-offer/);
  assert.doesNotMatch(source, /AI 薪资谈判指导/);
});

test('profile visualizer uses dossier clue copy instead of Profile mixed-language copy', () => {
  const source = read('src/components/profile/ProfileVisualizer.tsx');

  assert.match(source, /档案线索/);
  assert.match(source, /这里会显示 AI 当前能引用的身份、经验、技能、目标资料/);
  assert.doesNotMatch(source, /Profile 智能/);
});

test('profile intelligence does not display the dead project metric', () => {
  const settingsSource = read('src/components/ProfileIntelligenceSettings.tsx');
  const visualizerSource = read('src/components/profile/ProfileVisualizer.tsx');

  assert.doesNotMatch(settingsSource, /profileData\?\.projectCount/);
  assert.doesNotMatch(visualizerSource, /normalized\.projectCount/);
  assert.doesNotMatch(visualizerSource, />项目<\/p>/);
});
