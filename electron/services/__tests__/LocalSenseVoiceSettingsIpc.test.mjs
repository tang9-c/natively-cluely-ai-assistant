import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Local SenseVoice term settings are exposed through SettingsManager and types', () => {
  const settings = read('electron/services/SettingsManager.ts');
  const types = read('electron/audio/sensevoice/types.ts');

  assert.match(types, /export interface SenseVoiceTermEntry/);
  assert.match(settings, /localSenseVoiceTerms\?: SenseVoiceTermEntry\[\]/);
  assert.match(settings, /localSenseVoiceCorrectionEnabled\?: boolean/);
  assert.match(settings, /getLocalSenseVoiceTermCorrectionConfig/);
  assert.match(settings, /sanitizeSenseVoiceTerms/);
});

test('Local SenseVoice term APIs are registered and exposed to renderer', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  for (const channel of [
    'local-sensevoice-get-terms',
    'local-sensevoice-set-terms',
  ]) {
    assert.match(ipc, new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`), channel);
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\s*['"]${channel}['"]`), channel);
  }

  for (const api of [
    'localSenseVoiceGetTerms',
    'localSenseVoiceSetTerms',
  ]) {
    assert.match(preload, new RegExp(`${api}:`), api);
    assert.match(rendererTypes, new RegExp(`${api}:`), api);
  }

  assert.doesNotMatch(preload, /localSenseVoiceSuggestTerms/);
  assert.doesNotMatch(rendererTypes, /localSenseVoiceSuggestTerms/);
});

test('Local SenseVoice term settings do not expose VAD or homophone controls', () => {
  const settings = read('electron/services/SettingsManager.ts');
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');

  for (const source of [settings, preload, rendererTypes]) {
    assert.doesNotMatch(source, /localSenseVoiceVadProfile/);
    assert.doesNotMatch(source, /localSenseVoiceHomophone/);
    assert.doesNotMatch(source, /homophoneReplacerEnabled/);
  }
});

test('term pairs merge atomically, stay user-only and reject stale settings and invalid rules', async t => {
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {SettingsManager}=require('../../../dist-electron/electron/services/SettingsManager.js');
 const dir=fs.mkdtempSync(path.join((await import('node:os')).tmpdir(),'t5-terms-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sm=Object.create(SettingsManager.prototype);sm.settings={};sm.settingsPath=path.join(dir,'settings.json');
 const start=sm.getLocalSenseVoiceTermSettings();
 const first=sm.addLocalSenseVoiceTermPair('星州','星舟');assert.equal(first.success,true);
 assert.equal(sm.get('localSenseVoiceTerms').length,1);
 assert.equal(sm.addLocalSenseVoiceTermPair('星州','星舟').success,true);assert.equal(sm.get('localSenseVoiceTerms').length,1);
 assert.equal(sm.addLocalSenseVoiceTermPair('星州','别处').success,false);
 assert.equal(sm.addLocalSenseVoiceTermPair('AI','人工智能').success,false);
 assert.equal(sm.addLocalSenseVoiceTermPair('测试词','长'.repeat(81)).success,false);
 assert.equal(sm.setLocalSenseVoiceTerms({terms:start.terms,revision:start.revision,correctionEnabled:true}).success,false);
 const next=sm.getLocalSenseVoiceTermSettings();assert.equal(sm.setLocalSenseVoiceTerms({...next,correctionEnabled:false}).success,true);
 assert.equal(sm.addLocalSenseVoiceTermPair('新词','专名').enabled,false);
 assert.equal(JSON.parse(fs.readFileSync(sm.settingsPath)).localSenseVoiceTerms.length,2);
 const reopened=Object.create(SettingsManager.prototype);reopened.settings=JSON.parse(fs.readFileSync(sm.settingsPath));
 assert.equal(reopened.getLocalSenseVoiceTermCorrectionConfig().enabled,false);
});

test('registered IPC callbacks execute the atomic term contract and retain stale-form conflict', async t => {
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);const ts=require('typescript');const vm=require('node:vm');
 const {SettingsManager}=require('../../../dist-electron/electron/services/SettingsManager.js');
 const dir=fs.mkdtempSync(path.join((await import('node:os')).tmpdir(),'t5-ipc-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sm=Object.create(SettingsManager.prototype);sm.settings={};sm.settingsPath=path.join(dir,'settings.json');
 const source=ts.createSourceFile('ipcHandlers.ts',read('electron/ipcHandlers.ts'),ts.ScriptTarget.Latest,true);const handlers=new Map();
 const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='safeHandle'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith('local-sensevoice-')){
  const channel=node.arguments[0].text;if(['local-sensevoice-get-terms','local-sensevoice-set-terms','local-sensevoice-add-term-pair'].includes(channel)){
   const js=ts.transpile(`(${node.arguments[1].getText(source)})`);handlers.set(channel,vm.runInNewContext(js,{SettingsManager:{getInstance:()=>sm}}));
  }}ts.forEachChild(node,visit);};visit(source);
 const get=handlers.get('local-sensevoice-get-terms');const stale=await get();
 assert.equal((await handlers.get('local-sensevoice-add-term-pair')({}, {variant:'星州',canonical:'星舟'})).success,true);
 assert.equal((await handlers.get('local-sensevoice-set-terms')({},stale)).success,false);
 assert.equal((await handlers.get('local-sensevoice-add-term-pair')({}, {variant:'星州',canonical:'错误目标'})).success,false);
 assert.equal((await get()).terms.filter(term=>term.canonical==='星舟').length,1);
});

test('failed atomic term persistence rolls back config and revision for a later retry',async t=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);const {SettingsManager}=require('../../../dist-electron/electron/services/SettingsManager.js');
 const dir=fs.mkdtempSync(path.join((await import('node:os')).tmpdir(),'t5-term-fail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sm=Object.create(SettingsManager.prototype);sm.settings={};sm.settingsPath=path.join(dir,'missing','settings.json');
 assert.equal(sm.addLocalSenseVoiceTermPair('星州','星舟').success,false);assert.equal(sm.getLocalSenseVoiceTermSettings().revision,0);assert.equal(sm.get('localSenseVoiceTerms'),undefined);
 sm.settingsPath=path.join(dir,'settings.json');assert.equal(sm.addLocalSenseVoiceTermPair('星州','星舟').success,true);assert.equal(sm.get('localSenseVoiceTerms').length,1);
});
