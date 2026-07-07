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
  assert.match(interfaceSource, /generationOptions\?: \{ source\?: 'overlay' \| 'launcher' \| 'dynamic_action'; persist\?: boolean; modeEvent\?: DynamicActionModeEvent; throwOnError\?: boolean \}/);
});

test('dynamic action payload and renderer types expose required productContract', () => {
  const action = read('electron/services/dynamic-actions/DynamicAction.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  assert.match(action, /productContract:\s*DynamicActionProductContract/);
  assert.match(rendererTypes, /productContract:\s*DynamicActionProductContract/);
});

test('dynamic action card localizes quote email action separately from detected intent', () => {
  const source = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(source, /['"]Draft quote email['"]:\s*'邮件草稿'/);
  assert.match(source, /displayLabel/);
  assert.doesNotMatch(source, /pricing_request:\s*'邮件草稿'/);
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

test('dynamic action accept path is result-aware and records completion or failure', () => {
  const bar = read('src/components/dynamic-actions/DynamicActionBar.tsx');
  const iface = read('src/components/NativelyInterface.tsx');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');
  const ipc = read('electron/ipcHandlers.ts');

  assert.match(bar, /onAcceptAction:\s*\(action: DynamicActionPayload, options: DynamicActionGenerationOptions\) => Promise<void>/);
  assert.match(bar, /triggerSource:\s*'manual' \| 'auto_countdown'/);
  assert.match(bar, /await onAcceptAction\(action,/);
  assert.match(bar, /completeDynamicAction/);
  assert.match(bar, /failDynamicActionGeneration/);
  assert.match(bar, /uiStatus:\s*'failed'/);
  assert.match(iface, /return handleWhatToSay\(action\.promptInstruction,/);
  assert.match(preload, /completeDynamicAction:/);
  assert.match(preload, /failDynamicActionGeneration:/);
  assert.match(types, /completeDynamicAction:/);
  assert.match(types, /failDynamicActionGeneration:/);
  assert.match(ipc, /dynamic-action:complete/);
  assert.match(ipc, /dynamic-action:generation-failed/);
});

test('main records dynamic action shown once before forwarding to multiple windows', () => {
  const source = read('electron/main.ts');
  const blockStart = source.indexOf('intelligence-dynamic-action');
  const block = source.slice(Math.max(0, blockStart - 900), blockStart + 900);

  assert.match(block, /markDynamicActionShown\(action\.id\)/);
  assert.match(block, /recordDynamicActionLifecycleEvent/);
  assert.match(block, /helper\.getLauncherWindow\(\)\?\.webContents\.send\('intelligence-dynamic-action'/);
  assert.match(block, /helper\.getOverlayWindow\(\)\?\.webContents\.send\('intelligence-dynamic-action'/);
});

test('generate-what-to-say IPC forwards promptInstruction option to IntelligenceManager', () => {
  const source = read('electron/ipcHandlers.ts');
  const handlerSource = sliceSafeHandleBlock(source, 'generate-what-to-say');
  assert.ok(findSafeHandle(source, 'generate-what-to-say') >= 0, 'generate-what-to-say handler should exist');

  assert.match(handlerSource, /sanitizeGenerateWhatToSayOptions\(options\)/);
  assert.match(handlerSource, /promptInstruction:\s*requestOptions\.promptInstruction/);
  assert.doesNotMatch(handlerSource, /options\?\.uploadedMaterialContext/);
  assert.match(handlerSource, /persist:\s*requestOptions\.persist === false \? false : undefined/);
  assert.match(handlerSource, /source:\s*requestOptions\.source/);
  assert.match(handlerSource, /modeEvent:\s*sanitizeModeEvent\(requestOptions\.modeEvent\)/);
});

test('preload and renderer type expose dynamic action generation options', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /generateWhatToSay:[\s\S]{0,350}options\?: \{ promptInstruction\?: string; persist\?: boolean; source\?:/);
  assert.doesNotMatch(preload, /generateWhatToSay:[\s\S]{0,350}uploadedMaterialContext/);
  assert.match(preload, /ipcRenderer\.invoke\(['"]generate-what-to-say['"], question, imagePaths, options\)/);
  assert.match(types, /export interface DynamicActionModeEvent/);
  assert.match(types, /generateWhatToSay:[\s\S]{0,350}options\?: \{ promptInstruction\?: string; persist\?: boolean; source\?:/);
  assert.doesNotMatch(types, /generateWhatToSay:[\s\S]{0,350}uploadedMaterialContext/);
});

test('dynamic action answerStyle supports email shape across main and renderer types', () => {
  const action = read('electron/services/dynamic-actions/DynamicAction.ts');
  const detector = read('electron/services/dynamic-actions/DynamicActionDetector.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  assert.match(action, /format:\s*'bullets' \| 'short_script' \| 'code' \| 'checklist' \| 'summary' \| 'email'/);
  assert.match(detector, /format:\s*'bullets' \| 'short_script' \| 'code' \| 'checklist' \| 'summary' \| 'email'/);
  assert.match(rendererTypes, /format:\s*'bullets' \| 'short_script' \| 'code' \| 'checklist' \| 'summary' \| 'email'/);
});

test('dynamic action payload mirrors semanticGate trace metadata', () => {
  const action = read('electron/services/dynamic-actions/DynamicAction.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(action, /semanticGate\?:/);
  assert.match(action, /SemanticGateTrace/);
  assert.match(types, /semanticGate\?:/);
  assert.match(types, /semanticProvider/);
  assert.match(types, /degradedReason/);
  assert.match(types, /usedCloudArbitration/);
  assert.match(types, /upgradedByRepeatedEvidence/);
});

test('dynamic action renderer payload exposes semantic gate metadata without evidence text expansion', () => {
  const types = read('src/types/electron.d.ts');
  const card = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(types, /semanticGate\?: DynamicActionSemanticGate/);
  assert.match(card, /semanticGate/);
  assert.match(card, /explainDynamicAction\(\{\s*type: action\.type,\s*semanticGate: action\.semanticGate/);
  assert.doesNotMatch(card, /semanticGate[\s\S]{0,200}evidenceRefs\?\.\[0\]\?\.text/);
  assert.doesNotMatch(card, /语义证据不足，已暂缓高风险动作|相似的低置信候选已被拦截/);
});

test('runWhatShouldISay can emit dynamic action answers without persistence', () => {
  const source = read('electron/IntelligenceEngine.ts');

  assert.match(source, /persist\?: boolean/);
  assert.match(source, /const shouldPersist = options\?\.persist !== false/);
  assert.match(source, /if \(shouldPersist\)[\s\S]{0,160}this\.session\.addAssistantMessage/);
  assert.match(source, /if \(shouldPersist\)[\s\S]{0,220}this\.session\.pushUsage/);
});
