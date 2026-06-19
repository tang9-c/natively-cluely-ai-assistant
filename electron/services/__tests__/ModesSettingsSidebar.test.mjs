import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersSource = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
const modesSettingsSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/components/settings/ModesSettingsBase.tsx'),
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

test('ModesSettingsBase shows visible sidebar fallbacks instead of a blank mode list', () => {
  assert.match(modesSettingsSource, /setLoadError/);
  assert.match(modesSettingsSource, /模式列表加载失败/);
  assert.match(modesSettingsSource, /暂无模式/);
  assert.match(modesSettingsSource, /onClick=\{loadModes\}/);
});
