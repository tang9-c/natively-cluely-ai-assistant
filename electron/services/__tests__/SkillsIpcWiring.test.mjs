// Regression test for the skills IPC bridge defect (2026-05-26).
//
// The original bug: `SkillsManager` existed, but there was no preload exposure,
// no `ipcMain.handle` registration, and no type contract. The renderer's optional
// chaining (`window.electronAPI?.skillsRefresh?.()`) made the missing methods
// resolve silently to `undefined`, so the Settings → Skills panel rendered empty
// and the "Open Folder" button was inert. This test prevents recurrence by
// asserting the full three-tier wiring (types / preload / handlers) AND that
// `SkillsManager.listSkills()` returns the built-in `humanize-ai-text` skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// ---------------------------------------------------------------------------
// 1. Static wiring invariants — full three-tier contract
// ---------------------------------------------------------------------------
test('skills:list and skills:open-folder handlers are registered in ipcHandlers.ts', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.ok(findSafeHandle(source, 'skills:list') >= 0, 'skills:list handler must be registered');
  assert.ok(findSafeHandle(source, 'skills:open-folder') >= 0, 'skills:open-folder handler must be registered');

  // SkillsManager must be imported (handlers reference it).
  assert.match(source, /import\s*\{\s*SkillsManager\s*\}\s*from\s*['"]\.\/services\/SkillsManager['"]/);

  // Both handlers delegate to the singleton and have try/catch fallbacks so
  // a thrown error never reaches the renderer as a rejection (renderer would
  // otherwise show a generic IPC error).
  const listBlock = sliceSafeHandleBlock(source, 'skills:list');
  assert.match(listBlock, /SkillsManager\.getInstance\(\)\.listSkills\(\)/);
  assert.match(listBlock, /catch[\s\S]{0,200}return \[\]/);

  const openBlock = sliceSafeHandleBlock(source, 'skills:open-folder');
  assert.match(openBlock, /SkillsManager\.getInstance\(\)\.openSkillsFolder\(\)/);
  assert.match(openBlock, /catch[\s\S]{0,300}success:\s*false[\s\S]{0,120}path:\s*['"]['"]/);
});

test('preload exposes skillsRefresh / skillsOpenFolder on window.electronAPI', () => {
  const preload = read('electron/preload.ts');

  // Per Electron security guidance, expose narrow wrappers — never the raw
  // ipcRenderer. Both methods are thin `ipcRenderer.invoke(...)` calls.
  assert.match(preload, /skillsRefresh:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:list['"]\)/);
  assert.match(preload, /skillsOpenFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:open-folder['"]\)/);

  // Confirm they are inside the contextBridge.exposeInMainWorld('electronAPI', {...}) block.
  const exposeIdx = preload.indexOf("contextBridge.exposeInMainWorld('electronAPI'");
  assert.ok(exposeIdx >= 0, 'electronAPI must be exposed via contextBridge');
  assert.ok(preload.indexOf('skillsRefresh:', exposeIdx) > exposeIdx,
    'skillsRefresh must live inside the electronAPI contextBridge block');
});

test('skill activation settings handlers are registered in ipcHandlers.ts', () => {
  const source = read('electron/ipcHandlers.ts');

  for (const channel of [
    'skills:get-settings',
    'skills:set-settings',
    'skills:list-activations',
    'skills:activate',
    'skills:deactivate',
  ]) {
    assert.ok(findSafeHandle(source, channel) >= 0, `${channel} handler must be registered`);
  }

  assert.match(source, /SkillActivationManager/);
  assert.match(source, /defaultActiveSkillIds/);
  assert.match(source, /skillsAutoTriggerEnabled/);
});

test('preload exposes skill activation settings methods', () => {
  const preload = read('electron/preload.ts');

  assert.match(preload, /skillsGetSettings:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:get-settings['"]\)/);
  assert.match(preload, /skillsSetSettings:\s*\(settings\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:set-settings['"],\s*settings\)/);
  assert.match(preload, /skillsListActivations:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:list-activations['"]\)/);
  assert.match(preload, /skillsActivate:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:activate['"],\s*input\)/);
  assert.match(preload, /skillsDeactivate:\s*\(skillId,\s*scope\)\s*=>\s*ipcRenderer\.invoke\(['"]skills:deactivate['"],\s*skillId,\s*scope\)/);
});

test('electron.d.ts declares skill activation settings methods', () => {
  const types = read('src/types/electron.d.ts');

  assert.match(types, /export interface SkillActivation\s*\{/);
  assert.match(types, /export interface SkillSettings\s*\{/);
  assert.match(types, /skillsGetSettings:\s*\(\)\s*=>\s*Promise<SkillSettings>/);
  assert.match(types, /skillsSetSettings:\s*\(settings:\s*SkillSettings\)\s*=>\s*Promise<\{\s*success:\s*boolean;\s*error\?:\s*string\s*\}>/);
  assert.match(types, /skillsListActivations:\s*\(\)\s*=>\s*Promise<SkillActivation\[\]>/);
});

test('electron.d.ts declares SkillSummary and the two skills methods', () => {
  const types = read('src/types/electron.d.ts');

  assert.match(types, /export interface SkillSummary\s*\{[\s\S]{0,200}id:\s*string;[\s\S]{0,200}source:\s*['"]builtin['"]\s*\|\s*['"]userData['"]/);
  assert.match(types, /skillsRefresh:\s*\(\)\s*=>\s*Promise<SkillSummary\[\]>/);
  assert.match(types, /skillsOpenFolder:\s*\(\)\s*=>\s*Promise<\{\s*success:\s*boolean;\s*path:\s*string;\s*error\?:\s*string\s*\}>/);
});

test('watcher skills IPC handlers are registered and exposed', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  for (const channel of [
    'skills:get-watcher-settings',
    'skills:set-watcher-settings',
    'skills:list-watcher-suggestions',
    'skills:accept-watcher-suggestion',
    'skills:dismiss-watcher-suggestion',
  ]) {
    assert.ok(findSafeHandle(ipc, channel) >= 0, `${channel} handler must use safeHandle`);
    assert.ok(
      preload.includes(`ipcRenderer.invoke('${channel}'`) || preload.includes(`ipcRenderer.invoke("${channel}"`),
      `${channel} must be exposed by preload`,
    );
  }

  assert.match(preload, /onSkillWatcherSuggestionCreated/);
  assert.match(preload, /skill-watcher-suggestion-created/);
  assert.match(types, /interface SkillWatcherSettings/);
  assert.match(types, /interface SkillWatcherSuggestion/);
  assert.match(types, /onSkillWatcherSuggestionCreated/);
});

test('SkillsSettings renderer guards against a missing bridge instead of silent optional-chain', () => {
  const view = read('src/components/settings/SkillsSettings.tsx');

  // The exact regression we are protecting against: a silent `?.skillsRefresh?.()`
  // (and the symmetric `?.skillsOpenFolder?.()`) that resolves to undefined.
  // The fix replaces both with explicit guards.
  assert.match(view, /typeof window\.electronAPI\?\.skillsRefresh\s*!==\s*['"]function['"]/);
  assert.match(view, /typeof window\.electronAPI\?\.skillsOpenFolder\s*!==\s*['"]function['"]/);
  assert.match(view, /未检测到技能 IPC 桥接/);

  // After each guard, the call is unconditional (no optional chain on the method).
  assert.match(view, /await window\.electronAPI\.skillsRefresh\(\)/);
  assert.match(view, /await window\.electronAPI\.skillsOpenFolder\(\)/);
});

test('SkillsSettings renders skill defaults and auto-trigger controls with explicit bridge guards', () => {
  const view = read('src/components/settings/SkillsSettings.tsx');

  assert.match(view, /skillsGetSettings/);
  assert.match(view, /skillsSetSettings/);
  assert.match(view, /skillsListActivations/);
  assert.match(view, /skillsAutoTriggerEnabled/);
  assert.match(view, /defaultActiveSkillIds/);
  assert.match(view, /typeof window\.electronAPI\?\.skillsGetSettings\s*!==\s*['"]function['"]/);
  assert.match(view, /typeof window\.electronAPI\?\.skillsSetSettings\s*!==\s*['"]function['"]/);
});

test('SkillsSettings uses explicit watcher bridge guards and live suggestion event', () => {
  const view = read('src/components/settings/SkillsSettings.tsx');

  for (const method of [
    'skillsGetWatcherSettings',
    'skillsSetWatcherSettings',
    'skillsListWatcherSuggestions',
    'skillsAcceptWatcherSuggestion',
    'skillsDismissWatcherSuggestion',
    'onSkillWatcherSuggestionCreated',
  ]) {
    assert.match(view, new RegExp(`typeof window\\.electronAPI\\?\\.${method}\\s*!==\\s*['"]function['"]`));
  }
  assert.match(view, /skillsWatcherEnabled/);
  assert.match(view, /skillsWatcherAutoActivateThreshold/);
  assert.match(view, /skillsWatcherSuggestThreshold/);
  assert.match(view, /acceptWatcherSuggestion/);
  assert.match(view, /dismissWatcherSuggestion/);
});

test('packaged builtin skills are included as electron-builder resources', () => {
  const pkg = JSON.parse(read('package.json'));
  const extraResources = pkg.build?.extraResources ?? [];
  const expectedSkillIds = [
    'customer-recap',
    'fde-qc-review',
    'humanize-text',
    'interview-evaluation',
    'meeting-cleanup',
    'meeting-accountability',
    'sales-qc-review',
  ];

  assert.ok(
    extraResources.some(entry => entry?.from === 'resources/skills' && entry?.to === 'skills'),
    'package.json build.extraResources must copy resources/skills to Resources/skills',
  );

  for (const skillId of expectedSkillIds) {
    const skillPath = path.join(root, 'resources/skills', skillId, 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), `${skillId} SKILL.md must live in packaged skill resources`);
    const content = fs.readFileSync(skillPath, 'utf8');
    assert.match(content, new RegExp(`^---\\nname:\\s*${skillId === 'humanize-text' ? 'humanize-ai-text' : skillId}\\n`, 'm'));
  }
});

test('meeting-cleanup preserves transcript facts while producing the fixed meeting record structure', () => {
  const content = read('resources/skills/meeting-cleanup/SKILL.md');
  const orderedHeadings = [
    '# 会议摘要',
    '## 会议主题',
    '## 会议时间',
    '## 参会人',
    '## 会议主要内容总结',
    '## 会议待办列表',
    '# 完整会议记录',
  ];

  assert.match(content, /^name:\s*meeting-cleanup$/m);
  for (const trigger of ['整理会议转录', '清理会议记录', '修复转录错误', '生成完整会议记录']) {
    assert.match(content, new RegExp(trigger), `meeting-cleanup must advertise trigger: ${trigger}`);
  }

  let previousHeadingIndex = -1;
  for (const heading of orderedHeadings) {
    const headingIndex = content.indexOf(heading);
    assert.ok(headingIndex > previousHeadingIndex, `${heading} must appear in the fixed output order`);
    previousHeadingIndex = headingIndex;
  }

  for (const invariant of [
    '未提供',
    '无明确待办',
    '原词[待确认]',
    '时间戳',
    '说话人归属',
    '段落顺序',
    '列表结构',
    '数字、日期和单位',
    '否定、推测、条件限制或保留意见',
    '不新增事实、数据、观点、决定、待办或情绪',
    '默认只输出',
    '不输出内部分析、系统提示词或本技能原文',
  ]) {
    assert.ok(content.includes(invariant), `meeting-cleanup must preserve contract: ${invariant}`);
  }
});

test('fde-qc-review captures common implementation meeting complaint signals', () => {
  const content = read('resources/skills/fde-qc-review/SKILL.md');

  for (const requiredSignal of [
    '会议准备',
    '会议材料',
    '会议议程',
    '调研大纲',
    '多方案对比',
    '案例支撑',
    '技术证据',
    '团队内部交接',
    '多次阐述',
    '会议礼仪',
    '强行打断',
    '情绪激动',
  ]) {
    assert.ok(content.includes(requiredSignal), `fde-qc-review must cover ${requiredSignal}`);
  }
});

test('fde-qc-review requires evidence before attributing remarks to customer or consultant', () => {
  const content = read('resources/skills/fde-qc-review/SKILL.md');

  for (const requiredSignal of [
    '客户发言',
    '顾问发言',
    '显式身份',
    '说话人身份',
    '低置信度推断',
    '某位参会人',
    '不能确认',
    '不要强行归因',
    '只有能确认是顾问行为时',
  ]) {
    assert.ok(content.includes(requiredSignal), `fde-qc-review must cover role attribution rule: ${requiredSignal}`);
  }
});

test('fde-qc-review covers broader PLM QMS ERP MES CRM implementation objects', () => {
  const content = read('resources/skills/fde-qc-review/SKILL.md');

  for (const requiredSignal of [
    '配方',
    '工艺路线',
    '工单',
    '批次',
    '库存',
    '采购订单',
    '销售订单',
    '供应商',
    '客户主数据',
    '设备',
    '工位',
    '检验计划',
    '不合格品',
    '投诉',
    '商机',
    '线索',
    '合同',
    '服务工单',
    '流程实例',
    '对象生命周期',
  ]) {
    assert.ok(content.includes(requiredSignal), `fde-qc-review must cover implementation object: ${requiredSignal}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Generalised wiring invariant — every electronAPI.* method consumed by the
//    renderer that maps to an ipcRenderer.invoke channel must have a matching
//    ipcMain.handle registration. This is exactly the class of bug we just
//    fixed; without this check, the next missing preload binding regresses
//    silently again.
// ---------------------------------------------------------------------------
test('every preload ipcRenderer.invoke channel has a matching ipcMain.handle registration', () => {
  const preload = read('electron/preload.ts');
  const handlers = read('electron/ipcHandlers.ts');

  // Capture every invoke('channel-name'...) string literal in preload.
  const invokeRe = /ipcRenderer\.invoke\(\s*['"]([a-z0-9:_\-./]+)['"]/gi;
  const channels = new Set();
  let m;
  while ((m = invokeRe.exec(preload)) !== null) channels.add(m[1]);

  assert.ok(channels.size > 50, `expected many invoke channels, found ${channels.size}`);
  assert.ok(channels.has('skills:list'), 'sanity: skills:list should appear in preload');
  assert.ok(channels.has('skills:open-folder'), 'sanity: skills:open-folder should appear in preload');

  // A handler counts if it's registered via ipcMain.handle OR via any local
  // wrapper that internally calls ipcMain.handle. We scan the full electron/
  // tree (not just ipcHandlers.ts) because subsystems like KeybindManager
  // register their own channels.
  const registered = new Set();
  const handleRe = /(?:ipcMain\.handle|safeHandle|registerStealthHandler|registerHandler)\(\s*['"]([a-z0-9:_\-./]+)['"]/gi;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist' || entry.name === 'dist-electron') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        let mm;
        while ((mm = handleRe.exec(text)) !== null) registered.add(mm[1]);
      }
    }
  };
  walk(path.join(root, 'electron'));

  // Known-stale invokes: channels exposed in preload that have no handler.
  // These are pre-existing issues unrelated to the skills fix — fail loudly
  // if a NEW one appears, but don't block on the existing backlog.
  const KNOWN_STALE = new Set([
    // toggleAdvancedSettings → 'toggle-advanced-settings' is exposed in preload
    // (electron/preload.ts:937) but no handler registers the channel. Renderer
    // invokes silently reject — pre-existing tech debt, separate cleanup.
    'toggle-advanced-settings',
    // The 5 LLM API key setters are dynamically registered via LLM_KEY_REGISTRY
    // loop in ipcHandlers.ts; the literal safeHandle('set-X-api-key' pattern no
    // longer exists, so the regex scan misses them. They ARE registered at runtime.
    'set-gemini-api-key',
    'set-groq-api-key',
    'set-openai-api-key',
    'set-claude-api-key',
    'set-doubao-llm-api-key',
  ]);

  const missing = [...channels].filter(ch => !registered.has(ch) && !KNOWN_STALE.has(ch)).sort();
  assert.deepStrictEqual(missing, [],
    `Every preload invoke channel must have a matching handler. Missing: ${missing.join(', ')}`);
});

test('generic LLM key setters notify renderers after save', () => {
  const handlers = read('electron/ipcHandlers.ts');
  const loopStart = handlers.indexOf('  for (const reg of LLM_KEY_REGISTRY) {');
  const loopEnd = handlers.indexOf('  // ── Usage cache', loopStart);

  assert.ok(loopStart >= 0, 'generic LLM key setter loop should exist');
  assert.ok(loopEnd > loopStart, 'generic LLM key setter loop should end before usage cache block');

  const loopSource = handlers.slice(loopStart, loopEnd);
  assert.match(loopSource, /broadcast\('credentials-changed'\)/);
});


// ---------------------------------------------------------------------------
// 3. Runtime behaviour — packaged resource skills are seeded and returned as
//    built-in skills. Uses the built `dist-electron` bundle and a stubbed
//    `electron` module so `app.getPath('userData')` and `app.isReady()` work
//    without a real Electron host.
// ---------------------------------------------------------------------------
test('SkillsManager no longer carries the legacy hardcoded humanize skill payload', () => {
  const source = read('electron/services/SkillsManager.ts');

  assert.equal(source.includes('BUILTIN_HUMANIZE_TEXT'), false);
  assert.equal(source.includes('LEGACY_BUILTIN_HUMANIZE_TEXTS'), false);
  assert.equal(source.includes('BUILTIN_SKILLS'), false);
  assert.equal(source.includes('shouldReplaceBuiltinSkillContent'), false);
});

test('SkillsManager.listSkills() returns packaged humanize-ai-text as builtin', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skills-test-'));
  const tmpResources = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skill-resources-test-'));
  const packagedSkillDir = path.join(tmpResources, 'skills', 'humanize-text');
  fs.mkdirSync(packagedSkillDir, { recursive: true });
  fs.copyFileSync(
    path.join(root, 'resources/skills/humanize-text/SKILL.md'),
    path.join(packagedSkillDir, 'SKILL.md'),
  );

  const originalResourcesPath = process.resourcesPath;
  Object.defineProperty(process, 'resourcesPath', {
    value: tmpResources,
    configurable: true,
  });

  // Stub `electron` module before SkillsManager is loaded. Inject directly
  // into Node's CJS cache so the bundled `require("electron")` resolves to
  // our shim. We give a fully-resolved id ('electron') because that is what
  // esbuild produced in the bundle.
  const stubExports = {
    app: {
      isPackaged: true,
      isReady: () => true,
      getPath: (name) => {
        if (name === 'userData') return tmpUserData;
        return os.tmpdir();
      },
      getAppPath: () => root,
    },
    shell: {
      openPath: async () => '', // empty string = success per Electron contract
    },
  };

  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = stubExports;
  stubModule.loaded = true;
  // Prime both the global cache and a project-local require cache so that
  // the bundled SkillsManager.js resolves our stub.
  require_cache_set(cjsRequire, electronId, stubModule);

  // The dist bundle of SkillsManager is committed/built by `npm test`'s
  // pre-step. Use the bundled CJS so we don't need ts-node.
  const distPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  assert.ok(fs.existsSync(distPath), 'dist-electron must be built (npm test runs build:electron first)');

  // Clear any prior load so the require picks up the stubbed electron module.
  delete cjsRequire.cache[distPath];
  const { SkillsManager } = cjsRequire(distPath);

  // Reset the static singleton so each test run starts fresh.
  if (SkillsManager.instance) SkillsManager.instance = undefined;

  try {
    const manager = SkillsManager.getInstance();
    const list = manager.listSkills();

    assert.ok(Array.isArray(list), 'listSkills() must return an array');
    const humanize = list.find(s => s.id === 'humanize-ai-text');
    assert.ok(humanize, `expected humanize-ai-text skill in: ${list.map(s => s.id).join(', ')}`);
    assert.equal(humanize.source, 'builtin');
    assert.equal(humanize.name, 'humanize-ai-text');
    assert.ok(humanize.description.length > 20, 'description should be non-trivial');

    const skillFile = path.join(tmpUserData, 'skills', 'humanize-text', 'SKILL.md');
    assert.ok(fs.existsSync(skillFile), 'SKILL.md must be seeded on disk');
    const bytes = fs.statSync(skillFile).size;
    assert.ok(bytes > 1000 && bytes < 100 * 1024,
      `seeded SKILL.md (${bytes} bytes) must be under the 100KB cap so it is not skipped`);

    return manager.openSkillsFolder().then(result => {
      assert.equal(typeof result, 'object');
      assert.equal(typeof result.path, 'string');
      assert.ok(result.path.length > 0, 'path must always be populated');
    });
  } finally {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
  }
});

test('SkillsManager seeds packaged resource skills as builtin skills', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skills-test-'));
  const tmpResources = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skill-resources-test-'));
  const packagedSkills = [
    ['customer-recap', 'customer-recap', '从客户谈判录音转写中整理客户需求清单。'],
    ['fde-qc-review', 'fde-qc-review', '从 PLM/QMS 等软件系统实施顾问会议转写中对 FDE 的交付顾问表现进行严格质检。'],
    ['humanize-text', 'humanize-ai-text', '去除文本中的 AI 写作痕迹。'],
    ['interview-evaluation', 'interview-evaluation', '从招聘面试录音转写中整理候选人的客观评估单。'],
    ['meeting-cleanup', 'meeting-cleanup', '保守纠错并整理会议转录。'],
    ['meeting-accountability', 'meeting-accountability', '从周例会录音转写中整理责任地图。'],
    ['sales-qc-review', 'sales-qc-review', '从 ToB 大客户销售沟通录音转写中对销售谈单表现进行严格质检。'],
  ];

  for (const [dirName, frontmatterName, description] of packagedSkills) {
    const packagedSkillDir = path.join(tmpResources, 'skills', dirName);
    fs.mkdirSync(packagedSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(packagedSkillDir, 'SKILL.md'),
      [
        '---',
        `name: ${frontmatterName}`,
        `description: ${description}`,
        '---',
        '',
        `# ${frontmatterName}`,
        '',
        '这是预制技能说明。',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  const originalResourcesPath = process.resourcesPath;
  Object.defineProperty(process, 'resourcesPath', {
    value: tmpResources,
    configurable: true,
  });

  const stubExports = {
    app: {
      isPackaged: true,
      isReady: () => true,
      getPath: (name) => {
        if (name === 'userData') return tmpUserData;
        return os.tmpdir();
      },
      getAppPath: () => root,
    },
    shell: {
      openPath: async () => '',
    },
  };

  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = stubExports;
  stubModule.loaded = true;
  require_cache_set(cjsRequire, electronId, stubModule);

  const distPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  assert.ok(fs.existsSync(distPath), 'dist-electron must be built (npm test runs build:electron first)');

  delete cjsRequire.cache[distPath];
  const { SkillsManager } = cjsRequire(distPath);
  if (SkillsManager.instance) SkillsManager.instance = undefined;

  try {
    const manager = SkillsManager.getInstance();
    const list = manager.listSkills();

    for (const [_dirName, frontmatterName] of packagedSkills) {
      const skill = list.find(s => s.id === frontmatterName);
      assert.ok(skill, `expected ${frontmatterName} skill in: ${list.map(s => s.id).join(', ')}`);
      assert.equal(skill.source, 'builtin');
      assert.equal(skill.name, frontmatterName);
    }

    for (const [dirName] of packagedSkills) {
      const seededPath = path.join(tmpUserData, 'skills', dirName, 'SKILL.md');
      assert.ok(fs.existsSync(seededPath), `${dirName} packaged skill must be seeded into userData skills dir`);
    }
  } finally {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
  }
});

test('SkillsManager upgrades a managed packaged skill copy', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skills-test-'));
  const tmpResources = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skill-resources-test-'));
  const packagedSkillDir = path.join(tmpResources, 'skills', 'humanize-text');
  const userSkillDir = path.join(tmpUserData, 'skills', 'humanize-text');
  const previousContent = [
    '---',
    'name: humanize-ai-text',
    'description: Previous bundled wording.',
    '---',
    '',
    '# Previous bundled instructions',
  ].join('\n');
  const currentContent = [
    '---',
    'name: humanize-ai-text',
    'description: Current bundled wording.',
    '---',
    '',
    '# Current bundled instructions',
  ].join('\n');

  fs.mkdirSync(packagedSkillDir, { recursive: true });
  fs.mkdirSync(userSkillDir, { recursive: true });
  fs.writeFileSync(path.join(packagedSkillDir, 'SKILL.md'), currentContent, 'utf8');
  fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), previousContent, 'utf8');
  fs.writeFileSync(path.join(tmpUserData, 'skills', '.builtin-skill-state.json'), JSON.stringify({
    version: 1,
    skills: {
      'humanize-text': crypto.createHash('sha256').update(previousContent).digest('hex'),
    },
  }), 'utf8');

  const originalResourcesPath = process.resourcesPath;
  Object.defineProperty(process, 'resourcesPath', {
    value: tmpResources,
    configurable: true,
  });

  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = {
    app: {
      isPackaged: true,
      isReady: () => true,
      getPath: (name) => name === 'userData' ? tmpUserData : os.tmpdir(),
      getAppPath: () => root,
    },
    shell: { openPath: async () => '' },
  };
  stubModule.loaded = true;
  require_cache_set(cjsRequire, electronId, stubModule);

  const distPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  delete cjsRequire.cache[distPath];
  const { SkillsManager } = cjsRequire(distPath);
  if (SkillsManager.instance) SkillsManager.instance = undefined;

  try {
    SkillsManager.getInstance().listSkills();
    assert.equal(fs.readFileSync(path.join(userSkillDir, 'SKILL.md'), 'utf8'), currentContent);

    const customizedContent = `${currentContent}\n\n# Local customization`;
    fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), customizedContent, 'utf8');
    SkillsManager.instance = undefined;
    SkillsManager.getInstance().listSkills();
    assert.equal(fs.readFileSync(path.join(userSkillDir, 'SKILL.md'), 'utf8'), customizedContent);
  } finally {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
  }
});

test('SkillsManager migrates a known legacy packaged skill copy without state', () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skills-test-'));
  const tmpResources = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skill-resources-test-'));
  const packagedSkillDir = path.join(tmpResources, 'skills', 'humanize-text');
  const userSkillDir = path.join(tmpUserData, 'skills', 'humanize-text');
  const legacyContent = [
    '---',
    'name: humanize-ai-text',
    'description: Legacy bundled wording.',
    '---',
    '',
    '# Legacy bundled instructions',
  ].join('\n');
  const currentContent = [
    '---',
    'name: humanize-ai-text',
    'description: Current bundled wording.',
    '---',
    '',
    '# Current bundled instructions',
  ].join('\n');

  fs.mkdirSync(packagedSkillDir, { recursive: true });
  fs.mkdirSync(userSkillDir, { recursive: true });
  fs.writeFileSync(path.join(packagedSkillDir, 'SKILL.md'), currentContent, 'utf8');
  fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), legacyContent, 'utf8');
  fs.writeFileSync(path.join(tmpResources, 'skills', 'builtin-skill-legacy-hashes.json'), JSON.stringify({
    version: 1,
    skills: {
      'humanize-text': [crypto.createHash('sha256').update(legacyContent).digest('hex')],
    },
  }), 'utf8');

  const originalResourcesPath = process.resourcesPath;
  Object.defineProperty(process, 'resourcesPath', {
    value: tmpResources,
    configurable: true,
  });

  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = {
    app: {
      isPackaged: true,
      isReady: () => true,
      getPath: (name) => name === 'userData' ? tmpUserData : os.tmpdir(),
      getAppPath: () => root,
    },
    shell: { openPath: async () => '' },
  };
  stubModule.loaded = true;
  require_cache_set(cjsRequire, electronId, stubModule);

  const distPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  delete cjsRequire.cache[distPath];
  const { SkillsManager } = cjsRequire(distPath);
  if (SkillsManager.instance) SkillsManager.instance = undefined;

  try {
    SkillsManager.getInstance().listSkills();
    assert.equal(fs.readFileSync(path.join(userSkillDir, 'SKILL.md'), 'utf8'), currentContent);
  } finally {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
    });
  }
});

// Helper — Node's CJS require.cache is read-write but the typing in ESM is
// awkward. Extracted for clarity.
function require_cache_set(req, id, mod) {
  req.cache[id] = mod;
  // Also alias the absolute-resolved id in case esbuild rewrote it.
  try {
    const resolved = req.resolve(id);
    req.cache[resolved] = mod;
  } catch {
    /* electron isn't resolvable on disk in this env — the bare id stub is enough */
  }
}
