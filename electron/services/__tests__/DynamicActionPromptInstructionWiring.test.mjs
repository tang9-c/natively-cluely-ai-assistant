import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('dynamic action accept uses promptInstruction instead of display label/manual submit', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const mountStart = source.indexOf('<DynamicActionBar');
  assert.ok(mountStart >= 0, 'DynamicActionBar should be mounted');
  const mountSource = source.slice(mountStart, source.indexOf('/>', mountStart) + 2);

  assert.match(mountSource, /handleWhatToSay\(action\.promptInstruction,\s*\{/);
  assert.match(mountSource, /source:\s*'dynamic_action'/);
  assert.match(mountSource, /persist:\s*true/);
  assert.match(mountSource, /modeEvent:\s*options\.modeEvent/);
  assert.doesNotMatch(mountSource, /setInputValue\(action\.label\)/);
  assert.doesNotMatch(mountSource, /handleManualSubmitRef\.current/);
});

test('dynamic action accepted answers are persisted into meeting usage', () => {
  const bar = read('src/components/dynamic-actions/DynamicActionBar.tsx');

  assert.match(bar, /type DynamicActionGenerationOptions[\s\S]{0,120}persist:\s*true/);
  assert.match(bar, /onAcceptAction\(action,\s*\{[\s\S]{0,100}persist:\s*true/);
  assert.doesNotMatch(bar, /persist:\s*false/);
});

test('dynamic action accept forwards modeEvent retrieval metadata', () => {
  const bar = read('src/components/dynamic-actions/DynamicActionBar.tsx');
  const interfaceSource = read('src/components/NativelyInterface.tsx');

  assert.match(bar, /type DynamicActionModeEvent/);
  assert.match(bar, /modeTemplateType:\s*action\.modeTemplateType/);
  assert.match(bar, /intent:\s*action\.sourceIntent\s*\|\|\s*action\.type/);
  assert.match(bar, /confidence:\s*action\.confidence/);
  assert.match(bar, /latestTurn:\s*action\.latestTurn/);
  assert.match(bar, /keyEntities:\s*action\.keyEntities/);
  assert.match(bar, /retrievalQuery:\s*action\.retrievalQuery/);
  assert.match(bar, /autoSurfacePolicy:\s*action\.autoSurfacePolicy/);
  assert.match(bar, /promptInstruction:\s*action\.promptInstruction/);
  assert.match(bar, /answerShape:\s*action\.answerStyle\?\.format/);
  assert.match(bar, /modeEvent:\s*buildDynamicActionModeEvent\(action\)/);
  assert.match(interfaceSource, /generationOptions\?: \{ source\?: string; persist\?: boolean; modeEvent\?: DynamicActionModeEvent \}/);
});

test('dynamic action card presents detected intent and confidence to the user', () => {
  const source = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(source, /检测到/);
  assert.match(source, /confidencePct/);
  assert.match(source, /pricing_objection:\s*'价格异议'/);
  assert.match(source, /pricing_request:\s*'邮件草稿'/);
  assert.match(source, /buying_signal:\s*'推进信号'/);
  assert.match(source, /action\.sourceIntent\s*\?\?\s*action\.type/);
});

test('dynamic action card exposes visible generation and cancel controls', () => {
  const source = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(source, /生成回答|立即生成/);
  assert.match(source, /取消|忽略/);
  assert.match(source, /Tab 生成/);
  assert.match(source, /秒后自动生成/);
  assert.match(source, /正在生成/);
  assert.doesNotMatch(source, /opacity-0\s+group-hover:opacity-100/);
  assert.doesNotMatch(source, /text-white\/(?:30|40)/);
  assert.doesNotMatch(source, /bg-white\/8/);
});

test('dynamic action bar owns semi-auto countdown and dedupes generation', () => {
  const source = read('src/components/dynamic-actions/DynamicActionBar.tsx');

  assert.match(source, /AUTO_TRIGGER_DELAY_MS\s*=\s*5000/);
  assert.match(source, /AUTO_TRIGGER_MIN_CONFIDENCE\s*=\s*0\.9/);
  assert.match(source, /autoTriggerEligible\s*===\s*true/);
  assert.match(source, /autoSurfacePolicy\s*===\s*'auto'/);
  assert.match(source, /confidence[\s\S]{0,80}>=\s*AUTO_TRIGGER_MIN_CONFIDENCE/);
  assert.match(source, /setTimeout/);
  assert.match(source, /clearTimeout/);
  assert.match(source, /triggeringIdsRef/);
  assert.match(source, /dismissDynamicAction/);
});

test('generate-what-to-say IPC forwards promptInstruction option to IntelligenceManager', () => {
  const source = read('electron/ipcHandlers.ts');
  const handlerSource = sliceSafeHandleBlock(source, 'generate-what-to-say');
  assert.ok(findSafeHandle(source, 'generate-what-to-say') >= 0, 'generate-what-to-say handler should exist');

  assert.match(handlerSource, /options\?: \{ promptInstruction\?: string; uploadedMaterialContext\?: string; persist\?: boolean; source\?: string; modeEvent\?: ModeEventContext \}/);
  assert.match(handlerSource, /promptInstruction:[\s\S]{0,120}typeof options\?\.promptInstruction === 'string'[\s\S]{0,80}options\.promptInstruction[\s\S]{0,40}: undefined/);
  assert.match(handlerSource, /uploadedMaterialContext/);
  assert.match(handlerSource, /persist:[\s\S]{0,120}options\?\.persist === false[\s\S]{0,40}\? false[\s\S]{0,40}: undefined/);
  assert.match(handlerSource, /source:[\s\S]{0,120}typeof options\?\.source === 'string'[\s\S]{0,80}options\.source[\s\S]{0,40}: undefined/);
  assert.match(handlerSource, /modeEvent:[\s\S]{0,120}sanitizeModeEvent\(options\?\.modeEvent\)/);
});

test('preload and renderer type expose dynamic action generation options', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /generateWhatToSay:[\s\S]{0,350}options\?: \{ promptInstruction\?: string; uploadedMaterialContext\?: string; persist\?: boolean; source\?: string; modeEvent\?: ModeEventContext \}/);
  assert.match(preload, /ipcRenderer\.invoke\(['"]generate-what-to-say['"], question, imagePaths, options\)/);
  assert.match(types, /export interface DynamicActionModeEvent/);
  assert.match(types, /generateWhatToSay:[\s\S]{0,350}options\?: \{ promptInstruction\?: string; uploadedMaterialContext\?: string; persist\?: boolean; source\?: string; modeEvent\?: DynamicActionModeEvent \}/);
});

test('runWhatShouldISay can emit dynamic action answers without persistence', () => {
  const source = read('electron/IntelligenceEngine.ts');

  assert.match(source, /persist\?: boolean/);
  assert.match(source, /const shouldPersist = options\?\.persist !== false/);
  assert.match(source, /if \(shouldPersist\)[\s\S]{0,160}this\.session\.addAssistantMessage/);
  assert.match(source, /if \(shouldPersist\)[\s\S]{0,220}this\.session\.pushUsage/);
});
