import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function helpers() {
  const file = path.resolve('src/utils/onboardingActions.ts');
  assert.equal(fs.existsSync(file), true, 'onboarding save/validate sequence is missing');
  const module = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module, module.exports);
  return module.exports;
}
test('failed save keeps plaintext in the input and never validates; saved configuration refresh supplies the current revision', async () => {
  const { saveAndValidateOnboarding } = helpers(); const events = [];
  const base = { save: async () => { events.push('save'); return false; }, clear: () => events.push('clear'),
    refresh: async () => { events.push('refresh'); return { success: true, snapshot: { progress: { configRevision: { ai: 7 } } } }; },
    validate: async revision => { events.push(revision); return { success: false, errorCode: 'network_error' }; }, target: 'ai' };
  assert.equal((await saveAndValidateOnboarding(base)).errorCode, 'storage_failed'); assert.deepEqual(events, ['save']);
  events.length = 0; base.save = async () => { events.push('save'); return true; };
  const result = await saveAndValidateOnboarding(base);
  assert.equal(result.saved, true); assert.equal(result.errorCode, 'network_error');
  assert.deepEqual(events, ['save', 'clear', 'refresh', 7]);
});
test('onboarding error strings are fixed and do not expose provider exception details', () => {
  const { onboardingErrorText } = helpers();
  assert.equal(onboardingErrorText('model_load_failed'), '模型加载失败，请重试或重新下载。');
  assert.doesNotMatch(onboardingErrorText('secret-key-in-provider-error'), /secret/);
});

test('QCLOUD onboarding explicitly defers network validation until after secure save, while legacy settings keep preflight', async () => {
  const { ipcHandler } = await import('./helpers/onboardingRuntime.mjs');
  const events = [];
  const cm = { getSttProvider: () => 'local-sensevoice', getDefaultModel: () => 'manual', getCurlProviders: () => [], getCustomProviders: () => [],
    setNativelyApiKey: () => events.push('saved') };
  const handler = ipcHandler('set-natively-api-key', { appState: { processingHelper: { getLLMHelper: () => ({ setNativelyKey() {}, setModel() {} }) }, getRAGManager: () => null },
    require: () => ({ CredentialsManager: { getInstance: () => cm } }), validateQCloudApiKeyFormat: () => null,
    testQCloudApiKeyConnection: async () => events.push('network'), broadcast() {}, buildEmbeddingRuntimeConfig() {} });
  assert.equal((await handler({}, 'fixture-key', { selectAsDefault: false, deferValidation: true })).success, true);
  assert.deepEqual(events, ['saved']);
  events.length = 0;
  assert.equal((await handler({}, 'fixture-key')).success, true);
  assert.deepEqual(events, ['network', 'saved']);
});

test('provisioning opens only the exact approved HTTPS destinations through the existing external URL handler', async () => {
  const { ipcHandler } = await import('./helpers/onboardingRuntime.mjs'); const opened = [];
  const handler = ipcHandler('open-external', { URL, shell: { openExternal: async url => opened.push(url) }, process: { platform: 'linux' } });
  const approved = ['https://docs.volcengine.com/docs/ark/quick-start-beginner?lang=zh', 'https://docs.volcengine.com/docs/ark/manage-api-keys?lang=zh', 'https://ark.volcengine.com/region:cn-beijing/apikey'];
  for (const url of [...approved, 'http://docs.volcengine.com/docs/ark/quick-start-beginner?lang=zh', 'https://docs.volcengine.com/other', 'https://docs.volcengine.com/docs/ark/quick-start-beginner?lang=zh&redirect=elsewhere', 'https://ark.volcengine.com/region:cn-beijing/apikey#unexpected']) await handler({}, url);
  assert.deepEqual(opened, approved);
});
