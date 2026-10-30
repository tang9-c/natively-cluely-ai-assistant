import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { readOnboardingConfiguration } = require('../../../dist-electron/electron/services/onboarding/OnboardingConfiguration.js');
function load(file) {
  const cache = new Map();
  function read(file) {
    file = path.resolve(file); if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const resolve = spec => {
      if (spec.startsWith('.')) for (const extension of ['.ts', '.tsx']) {
        const target = path.resolve(path.dirname(file), spec) + extension;
        if (fs.existsSync(target)) return read(target);
      }
      return require(spec);
    };
    new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText)(resolve, module, module.exports); return module.exports;
  }
  return read(file);
}
for (const selector of ['codex-cli', 'codex-cli:gpt-5.4']) test(`actual configuration ${selector} renders as a supported Codex provider`, () => {
  const ai = readOnboardingConfiguration({ credentials: { getAllCredentials: () => ({}), getDefaultModel: () => selector,
    getCredentialVersion: () => undefined, getAiResponseLanguage: () => 'Chinese' }, settings: { get: key => key === 'codexCliEnabled' ? true : undefined } }, 'ai');
  const previous = globalThis.window; globalThis.window = { electronAPI: {} };
  try {
    const Component = load('src/components/onboarding/AiServiceStep.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Component, { snapshot: { checks: { ai }, meeting: {} }, provisioning: false }));
    assert.doesNotMatch(html, /当前服务 · codex|引导暂不能验证此配置/);
    assert.match(html, /验证当前配置/);
    if (selector.includes(':')) assert.match(html, /value="ChatGPT 5.4"/);
  } finally { globalThis.window = previous; }
});
test('overview displays speech provider names without duplicating internal provider IDs as model names', () => {
  const Component = load('src/components/onboarding/PreparationOverview.tsx').default;
  for (const [provider, name] of [['qcloud-stt', 'QCLOUD API'], ['doubao-auc', 'Doubao AUC'], ['local-sensevoice', '本地 SenseVoice']]) {
    const check = { status: 'missing', provider, modelId: provider };
    const html = renderToStaticMarkup(React.createElement(Component, { snapshot: { checks: { stt: check, ai: { status: 'missing' }, microphone: { status: 'missing' }, inputDevice: { status: 'missing' }, systemAudio: { status: 'missing' } } } }));
    assert.ok(html.includes(name)); assert.ok(!html.includes(provider));
  }
});

test('friendly AI input resolves to provider model IDs and custom IDs remain untouched', () => {
  const models = load('src/utils/modelUtils.ts');
  assert.equal(models.resolveAiModelInput('doubao', 'Doubao Seed 2.0 Lite'), 'doubao-seed-2-0-lite-260215');
  assert.equal(models.resolveAiModelInput('codex-cli', 'ChatGPT 5.5'), 'gpt-5.5');
  assert.equal(models.resolveAiModelInput('doubao', 'ep-custom-123'), 'ep-custom-123');
  assert.equal(models.getAiModelDisplayName('codex-cli', 'my-model.v2'), 'my-model.v2');
  assert.equal(models.getModelDisplayName('codex-cli:my-model.v2'), 'my-model.v2');
  assert.equal(models.resolveAiModelInput('codex-cli', 'codex-cli:gpt-5.4'), 'gpt-5.4');
  assert.equal(models.resolveAiModelInput('doubao', '  Doubao Seed 2.0 Lite  '), 'doubao-seed-2-0-lite-260215');
  assert.equal(models.getCodexCliModelId('codex-cli:gpt-5.4', 'gpt-5.5'), 'gpt-5.4');
  assert.equal(models.getCodexCliModelId('codex-cli', 'gpt-5.5'), 'gpt-5.5');
});
test('device options preserve default semantics and disconnected saved IDs without duplicates', () => {
  const { getAudioDeviceOptions } = load('src/utils/settingsDisplay.ts');
  assert.deepEqual(getAudioDeviceOptions([{ id: 'mic', name: 'Microphone' }]), [{ id: 'default', name: '系统默认' }, { id: 'mic', name: 'Microphone' }]);
  assert.deepEqual(getAudioDeviceOptions([{ id: 'default', name: 'System Default' }], 'lost'), [{ id: 'default', name: '系统默认' }, { id: 'lost', name: '已保存设备（不可用）' }]);
  assert.deepEqual(getAudioDeviceOptions([]), [{ id: 'default', name: '系统默认' }]);
});
test('QCLOUD help routes to shared key management while other speech providers route to audio', () => {
  const { getAiSettingsTab, getSpeechSettingsTab } = load('src/utils/settingsDisplay.ts');
  assert.equal(getAiSettingsTab('natively'), 'natively-api');
  assert.equal(getAiSettingsTab('codex-cli'), 'ai-providers');
  assert.equal(getSpeechSettingsTab('qcloud-stt'), 'natively-api');
  assert.equal(getSpeechSettingsTab('doubao-auc'), 'audio');
});

test('both QCLOUD forms identify the same shared API Key when it has not been saved', () => {
  const previous = globalThis.window; globalThis.window = { electronAPI: {} };
  try {
    for (const [file, target, provider] of [['AiServiceStep', 'ai', 'natively'], ['SpeechStep', 'stt', 'qcloud-stt']]) {
      const Component = load(`src/components/onboarding/${file}.tsx`).default;
      const html = renderToStaticMarkup(React.createElement(Component, { snapshot: { checks: { [target]: { status: 'missing', provider, modelId: provider } }, downloads: [], meeting: {} }, provisioning: false }));
      assert.match(html, />QCLOUD API Key<input/);
    }
  } finally { globalThis.window = previous; }
});

test('speech overview does not expose a local model repository path as its display name', () => {
  const Component = load('src/components/onboarding/PreparationOverview.tsx').default;
  const id = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
  const html = renderToStaticMarkup(React.createElement(Component, { snapshot: { checks: { stt: { status: 'missing', provider: 'local-sensevoice', modelId: id }, ai: { status: 'missing' }, microphone: { status: 'missing' }, inputDevice: { status: 'missing' }, systemAudio: { status: 'missing' } } } }));
  assert.ok(html.includes('本地 SenseVoice')); assert.ok(!html.includes(id));
});

test('custom provider names are safe display metadata and never include the stored command', () => {
  const ai = readOnboardingConfiguration({ credentials: { getAllCredentials: () => ({ customProviders: [{ id: 'custom-id', name: 'Example Custom', curlCommand: 'secret-command' }] }),
    getDefaultModel: () => 'custom-id', getCredentialVersion: () => undefined, getAiResponseLanguage: () => 'Chinese' }, settings: { get: () => undefined } }, 'ai');
  assert.equal(ai.modelName, 'Example Custom'); assert.doesNotMatch(JSON.stringify(ai), /secret-command/);
});

test('overview does not repeat the generic Codex service as a model name', () => {
  const Component = load('src/components/onboarding/PreparationOverview.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Component, { snapshot: { checks: { stt: { status: 'missing' }, ai: { status: 'missing', provider: 'codex', modelId: 'codex-cli' }, microphone: { status: 'missing' }, inputDevice: { status: 'missing' }, systemAudio: { status: 'missing' } } } }));
  assert.equal((html.match(/Codex CLI/g) ?? []).length, 1);
});
