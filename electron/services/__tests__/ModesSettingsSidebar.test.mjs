import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const ipcHandlersSource = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
const modesSettingsEntrySource = fs.readFileSync(
  path.join(repoRoot, 'src/components/settings/ModesSettings.tsx'),
  'utf8',
);
const modesSettingsSource = fs.readFileSync(
  path.join(repoRoot, 'src/components/settings/ModesSettingsBase.tsx'),
  'utf8',
);
const modesManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../ModesManager.ts'),
  'utf8',
);
const electronTsconfigSource = fs.readFileSync(
  path.resolve(__dirname, '../../tsconfig.json'),
  'utf8',
);
const buildElectronSource = fs.readFileSync(
  path.join(repoRoot, 'scripts/build-electron.js'),
  'utf8',
);
const nativelyInterfaceSource = fs.readFileSync(
  path.join(repoRoot, 'src/components/NativelyInterface.tsx'),
  'utf8',
);
const profileSettingsSource = fs.readFileSync(
  path.join(repoRoot, 'src/components/ProfileIntelligenceSettings.tsx'),
  'utf8',
);

test('modes:get-all seeds default modes before reading the list', () => {
  const block = sliceSafeHandleBlock(ipcHandlersSource, 'modes:get-all');
  const seedIndex = block.indexOf('ensureSeeded');
  const getModesIndex = block.indexOf('getModes');

  assert.notEqual(seedIndex, -1);
  assert.notEqual(getModesIndex, -1);
  assert.ok(seedIndex < getModesIndex);
});

test('ModesSettings entrypoint uses the official local implementation directly', () => {
  assert.match(modesSettingsEntrySource, /ModesSettingsBase as default/);
  assert.doesNotMatch(modesSettingsEntrySource, /\.\.\/\.\.\/premium/);
  assert.doesNotMatch(modesSettingsEntrySource, new RegExp('Null' + 'Component'));
});

test('business components no longer load through the premium runtime loader', () => {
  const deletedPremiumLoader = path.join(repoRoot, 'src/premium/index.tsx');
  assert.equal(fs.existsSync(deletedPremiumLoader), false);

  assert.match(nativelyInterfaceSource, /from ['"]\.\/NegotiationCoachingCard['"]/);
  assert.doesNotMatch(nativelyInterfaceSource, /from ['"]\.\.\/premium['"]/);

  assert.match(profileSettingsSource, /from ['"]\.\/profile\/ProfileVisualizer['"]/);
  assert.doesNotMatch(profileSettingsSource, /from ['"]\.\.\/premium['"]/);
});

test('electron build no longer scans root premium electron sources', () => {
  assert.doesNotMatch(electronTsconfigSource, /\.\.\/premium\/electron/);
  assert.doesNotMatch(buildElectronSource, /premium\/electron/);
});

test('ModesSettingsBase exposes the full official mode settings surface', () => {
  [
    '模式设置',
    '创建新模式',
    '设为活跃',
    '当前活跃',
    '模式名称',
    '自定义上下文',
    '笔记分区',
    '添加分区',
    '删除',
    '保存',
  ].forEach((text) => assert.match(modesSettingsSource, new RegExp(text)));

  [
    'modesGetAll',
    'modesCreate',
    'modesUpdate',
    'modesDelete',
    'modesSetActive',
    'modesGetNoteSections',
    'modesAddNoteSection',
    'modesUpdateNoteSection',
    'modesDeleteNoteSection',
  ].forEach((api) => assert.match(modesSettingsSource, new RegExp(api)));
});

test('ModesSettingsBase shows visible sidebar fallbacks instead of a blank mode list', () => {
  assert.match(modesSettingsSource, /setLoadError/);
  assert.match(modesSettingsSource, /模式列表加载失败/);
  assert.match(modesSettingsSource, /暂无模式/);
  assert.match(modesSettingsSource, /onClick=\{loadModes\}/);
  assert.match(modesSettingsSource, /重试/);
  assert.match(modesSettingsSource, /刷新/);
});

test('General mode defaults keep the original summary note sections', () => {
  assert.match(modesManagerSource, /TEMPLATE_NOTE_SECTIONS/);
  assert.match(modesManagerSource, /general:\s*\[/);
  assert.match(modesManagerSource, /title:\s*'Summary'/);
  assert.match(modesManagerSource, /title:\s*'Action items'/);
  assert.match(modesManagerSource, /title:\s*'Key points'/);

  const createModeIndex = modesManagerSource.indexOf('public createMode');
  const templateSectionsIndex = modesManagerSource.indexOf('TEMPLATE_NOTE_SECTIONS[params.templateType]', createModeIndex);
  const addSectionIndex = modesManagerSource.indexOf('addNoteSection', templateSectionsIndex);

  assert.ok(createModeIndex >= 0);
  assert.ok(templateSectionsIndex > createModeIndex);
  assert.ok(addSectionIndex > templateSectionsIndex);
});
