import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const dist = name => path.join(root, 'dist-electron', name);
let dir;
function reload(name) { const p = dist(name); delete require.cache[p]; return require(p); }
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-config-'));
  const stub = new Module('electron'); stub.loaded = true;
  stub.exports = { app: { isReady: () => true, getPath: () => dir } };
  require.cache[require.resolve('electron')] = stub;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
function managers() {
  const { CredentialsManager } = reload('electron/services/CredentialsManager.js');
  const { SettingsManager } = reload('electron/services/SettingsManager.js');
  return { credentials: CredentialsManager.getInstance(), settings: SettingsManager.getInstance() };
}
function factory() {
  let mod;
  try { mod = reload('electron/services/onboarding/OnboardingConfiguration.js'); }
  catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  assert.ok(mod, 'onboarding configuration bindings are missing'); return mod;
}
function setup() {
  const m = managers(); const f = factory();
  const h = { ...m, metadata: { runtime: 'test', files: [{ name: 'model.onnx', size: 5, mtimeMs: 1 }] } };
  h.service = f.createOnboardingService({ ...m, database: { hasNonDemoMeeting: () => false },
    readModelMetadata: () => h.metadata,
    readChecks: async () => ({ microphone: { status: 'verified' }, inputDevice: { status: 'verified' }, systemAudio: { status: 'verified' },
      stt: { status: 'missing' }, ai: { status: 'missing' } }) });
  return h;
}
async function verify(h, target) {
  const s = await h.service.refreshChecks(); const c = s.checks[target];
  return h.service.recordValidation({ target, provider: c.provider, modelId: c.modelId,
    configRevision: s.progress.configRevision[target], configIdentity: c.configIdentity,
    checkedAt: 10, depth: target === 'stt' ? 'model_load' : 'model_response', result: 'passed' });
}
const legacy = { legacySeenStartup: false, legacyPermissionsShown: false };
test('scope patches preserve other windows updates, whitelist fields, and retain old replace behavior', () => {
  const { settings } = managers();
  settings.set('providerDataScopes', { screenshots: false, transcript: true, embeddings: false });
  assert.equal(typeof settings.patchProviderDataScopes, 'function', 'atomic scope patch is missing');
  settings.patchProviderDataScopes({ transcript: false, unknown: false, screenshots: 'yes' });
  assert.deepEqual(settings.get('providerDataScopes'), { screenshots: false, transcript: false, embeddings: false });
  settings.setProviderDataScopes({ transcript: true });
  assert.deepEqual(settings.get('providerDataScopes'), { transcript: true });
  settings.setProviderDataScopes({ screenshots: false }, { mode: 'patch' });
  assert.deepEqual(settings.get('providerDataScopes'), { transcript: true, screenshots: false });
});
test('failed credential save preserves prior value, disk, version and notifications', () => {
  const { credentials } = managers(); credentials.setDoubaoLlmApiKey('old-key');
  assert.equal(typeof credentials.getCredentialVersion, 'function', 'credential identity version is missing');
  const old = credentials.getCredentialVersion('doubaoLlmApiKey'); assert.ok(old);
  const disk = fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8');
  const events = []; credentials.onConfigurationChanged(t => events.push(t));
  const blocker = path.join(dir, 'blocker'); fs.writeFileSync(blocker, 'file');
  credentials.credentialsFilePath = () => path.join(blocker, 'credentials.enc');
  assert.throws(() => credentials.setDoubaoLlmApiKey('new-key'));
  assert.equal(credentials.getDoubaoLlmApiKey(), 'old-key');
  assert.equal(credentials.getCredentialVersion('doubaoLlmApiKey'), old);
  assert.equal(fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8'), disk); assert.deepEqual(events, []);
});
test('legacy credentials do not acquire versions on passive reads; explicit validation preparation persists one', () => {
  fs.writeFileSync(path.join(dir, 'credentials.enc'), JSON.stringify({ doubaoLlmApiKey: 'legacy-secret' }));
  const { credentials } = managers(); credentials.init();
  assert.equal(typeof credentials.getCredentialVersion, 'function', 'credential identity version is missing');
  assert.equal(credentials.getCredentialVersion('doubaoLlmApiKey'), undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'credentials.enc'))).credentialVersions, undefined);
  credentials.ensureCredentialVersion('doubaoLlmApiKey'); const v = credentials.getCredentialVersion('doubaoLlmApiKey'); assert.ok(v);
  credentials.ensureCredentialVersion('doubaoLlmApiKey'); assert.equal(credentials.getCredentialVersion('doubaoLlmApiKey'), v);
});
test('configuration owners notify only affected targets after successful persistence', () => {
  const { credentials, settings } = managers(); const events = [];
  assert.equal(typeof credentials.onConfigurationChanged, 'function', 'owner notifications are missing');
  credentials.onConfigurationChanged(t => events.push(t)); settings.onConfigurationChanged(t => events.push(t));
  credentials.setSttLanguage('chinese'); assert.deepEqual(events.splice(0), ['stt']);
  credentials.setDefaultModel('other'); assert.deepEqual(events.splice(0), ['ai']);
  settings.set('codexCliModel', 'codex-other'); assert.deepEqual(events.splice(0), ['ai']);
  settings.set('localWhisperModel', 'tiny'); assert.deepEqual(events.splice(0), ['stt']);
  settings.patchProviderDataScopes({ screenshots: false }); assert.deepEqual(events.splice(0), []);
  settings.patchProviderDataScopes({ transcript: false }); assert.deepEqual(events.splice(0), ['ai']);
  settings.patchProviderDataScopes({ transcript: false }); assert.deepEqual(events.splice(0), []);
  const blocker = path.join(dir, 'blocker'); fs.writeFileSync(blocker, 'file');
  settings.settingsPath = path.join(blocker, 'settings.json');
  assert.throws(() => settings.set('localWhisperModel', 'bad')); assert.equal(settings.get('localWhisperModel'), 'tiny');
  assert.deepEqual(events, []);
});
test('AI configuration changes invalidate AI but keep speech receipt; failed validation supersedes success', async () => {
  const h = setup(); h.credentials.setSttProvider('local-sensevoice'); h.credentials.setDoubaoLlmApiKey('secret');
  h.service.initialize(legacy); await verify(h, 'stt'); await verify(h, 'ai');
  const events = []; h.service.subscribe(s => events.push(s));
  const before = h.service.getSnapshot(); h.credentials.setDefaultModel('doubao-changed');
  assert.ok(events.every(s => s.checks.ai.errorCode !== 'storage_failed'), 'successful invalidation must not broadcast a storage failure');
  const after = h.service.getSnapshot(); assert.equal(after.checks.ai.status, 'missing');
  assert.equal(after.progress.configRevision.ai, before.progress.configRevision.ai + 1);
  assert.equal(after.progress.configRevision.stt, before.progress.configRevision.stt); assert.equal(after.checks.stt.status, 'verified');
  await verify(h, 'ai'); const s = h.service.getSnapshot();
  h.service.recordValidation({ ...s.progress.validationReceipts.ai, result: 'failed' });
  assert.notEqual(h.service.getSnapshot().checks.ai.status, 'verified');
});
for (const [name, change, target] of [
  ['STT language', h => h.credentials.setSttLanguage('chinese'), 'stt'],
  ['STT endpoint', h => h.credentials.setOpenAiSttBaseUrl('https://other.test/v1'), 'stt'],
  ['Whisper model', h => h.settings.set('localWhisperModel', 'Xenova/whisper-tiny'), 'stt'],
  ['Codex configuration', h => h.settings.set('codexCliPath', '/changed/codex'), 'ai'],
  ['transcript scope', h => h.settings.patchProviderDataScopes({ transcript: false }), 'ai'],
  ['AI key', h => h.credentials.setDoubaoLlmApiKey('replacement-secret'), 'ai'],
]) test(`${name} invalidates corresponding revision`, async () => {
  const h = setup(); h.credentials.setDoubaoLlmApiKey('initial'); h.credentials.setSttProvider('local-sensevoice');
  h.service.initialize(legacy); const before = h.service.getSnapshot().progress.configRevision[target];
  change(h); assert.equal(h.service.getSnapshot().progress.configRevision[target], before + 1);
});
test('identity catches changed file metadata and revision write failure across restart without persisting secrets', async () => {
  const h = setup(); h.credentials.setSttProvider('local-sensevoice'); h.credentials.setDoubaoLlmApiKey('secret-A');
  h.service.initialize(legacy); await verify(h, 'stt'); await verify(h, 'ai');
  h.metadata.files[0].mtimeMs = 2;
  assert.equal(h.service.getSnapshot().checks.stt.status, 'missing');
  const goodPath = h.settings.settingsPath; h.settings.settingsPath = path.join(dir, 'missing-parent', 'settings.json');
  assert.throws(() => h.credentials.setDoubaoLlmApiKey('secret-B'), e => e.code === 'storage_failed');
  assert.equal(h.credentials.getDoubaoLlmApiKey(), 'secret-B'); // owning credentials commit succeeded
  assert.equal(h.service.getSnapshot().checks.ai.errorCode, 'storage_failed');
  h.settings.settingsPath = goodPath;
  const restarted = factory().createOnboardingService({ credentials: h.credentials, settings: h.settings,
    database: { hasNonDemoMeeting: () => false }, readModelMetadata: () => h.metadata });
  const s = restarted.initialize(legacy); assert.equal(s.checks.ai.status, 'missing');
  const stored = fs.readFileSync(goodPath, 'utf8'); assert.doesNotMatch(stored, /secret-A|secret-B|ApiKey/);
});
test('endpoint identity strips userinfo and query values and key versions survive restart', async () => {
  const h = setup(); h.credentials.setSttProvider('openai'); h.credentials.setOpenAiSttApiKey('secret-value');
  // Legacy endpoints may contain credentials; identity must never persist them.
  h.credentials.credentials.openAiSttBaseUrl = 'https://username:password@example.test/v1?api_key=query-secret#token';
  h.service.initialize(legacy); await verify(h, 'stt');
  const identity = h.service.getSnapshot().progress.validationReceipts.stt.configIdentity;
  assert.doesNotMatch(identity, /username|password|query-secret|secret-value|token/);
  const version = h.credentials.getCredentialVersion('openAiSttApiKey');
  h.credentials.init(); assert.equal(h.credentials.getCredentialVersion('openAiSttApiKey'), version);
});
test('preload forwards scope patch options and preserves legacy single argument invocation', async () => {
  const calls = []; let api;
  const stub = new Module('electron'); stub.loaded = true;
  stub.exports = { contextBridge: { exposeInMainWorld: (name, value) => { if (name === 'electronAPI') api = value; } },
    ipcRenderer: { on() {}, invoke: async (...args) => { calls.push(args); return { success: true }; } } };
  vm.runInNewContext(fs.readFileSync(dist('electron/preload.js'), 'utf8'), {
    require: id => { assert.equal(id, 'electron'); return stub.exports; },
    console: { ...console }, process, module: { exports: {} },
  });
  await api.setProviderDataScopes({ transcript: false }, { mode: 'patch' });
  assert.deepEqual(calls.pop(), ['set-provider-data-scopes', { transcript: false }, { mode: 'patch' }]);
  await api.setProviderDataScopes({ transcript: true });
  assert.deepEqual(calls.pop().slice(0, 2), ['set-provider-data-scopes', { transcript: true }]);
});
test('scope IPC executes patch/replace and broadcasts merged settings while keeping embeddings refresh', async () => {
  const { settings } = managers(); settings.set('providerDataScopes', { screenshots: false });
  // Execute the actual built handler with a minimal Electron host, not a duplicate implementation.
  const ts = require('typescript'); const source = fs.readFileSync(dist('electron/ipcHandlers.js'), 'utf8');
  const ast = ts.createSourceFile('ipcHandlers.js', source, ts.ScriptTarget.Latest, true);
  let statement;
  function visit(node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(ast) === 'safeHandle'
      && node.expression.arguments[0]?.text === 'set-provider-data-scopes') statement = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(statement, 'scope handler registration must exist');
  let handler; let refreshes = 0; const broadcasts = [];
  vm.runInNewContext(statement, { safeHandle: (_, callback) => handler = callback,
    SettingsManager: { getInstance: () => settings },
    appState: { getRAGManager: () => ({ initializeEmbeddings: () => refreshes++ }) },
    buildEmbeddingRuntimeConfig: () => ({}), broadcast: (...args) => broadcasts.push(args) });
  assert.equal((await handler({}, { transcript: false }, { mode: 'patch' })).success, true);
  assert.equal(settings.get('providerDataScopes').screenshots, false);
  assert.equal(broadcasts.at(-1)[1].screenshots, false); assert.equal(refreshes, 1);
  assert.equal((await handler({}, { transcript: true })).success, true);
  assert.deepEqual(settings.get('providerDataScopes'), { transcript: true });
  assert.equal((await handler({}, {}, { mode: 'bogus' })).success, false);
});

test('default model constants and passive legacy STT normalization do not create migration writes', () => {
  const m = managers();
  m.credentials.setDefaultModel('doubao-seed-2-0-lite-260215');
  m.settings.set('localWhisperModel', 'Xenova/whisper-base');
  m.settings.set('codexCliPath', 'codex');
  const service = factory().createOnboardingService({ ...m, database: { hasNonDemoMeeting: () => false } });
  assert.equal(service.initialize(legacy).progress.origin, 'fresh', 'default constants are not prior-use evidence');
  fs.writeFileSync(path.join(dir, 'credentials.enc'), JSON.stringify({ sttProvider: 'doubao', doubaoApiKey: 'old-secret' }));
  m.credentials.init(); const before = fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8');
  service.getSnapshot();
  assert.equal(fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8'), before, 'passive snapshot must not migrate credentials');
});
test('SenseVoice identity uses the actual catalog ID; preferred AI model changes alter identity across restart', async () => {
  const h = setup(); h.credentials.setSttProvider('local-sensevoice'); h.credentials.setDoubaoLlmApiKey('key');
  h.service.initialize(legacy); await verify(h, 'ai');
  assert.equal(h.service.getSnapshot().checks.stt.modelId, 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17');
  const before = h.service.getSnapshot().checks.ai.configIdentity;
  h.credentials.setPreferredModel('doubao', 'doubao-other');
  assert.notEqual(h.service.getSnapshot().checks.ai.configIdentity, before);
});
for (const [name, change] of [
  ['QCLOUD key/default/provider', cm => cm.setNativelyApiKey('replacement', { selectAsDefault: true })],
  ['custom provider array', cm => cm.saveCustomProvider({ id: 'one', name: 'replacement', curlCommand: 'curl replacement' })],
  ['curl provider array', cm => cm.saveCurlProvider({ id: 'one', name: 'replacement', curlCommand: 'curl replacement', responsePath: 'answer' })],
  ['preferred model', cm => cm.setPreferredModel('doubao', 'replacement')],
]) test(`${name} stays unchanged when atomic rename fails`, t => {
  const { credentials: cm } = managers();
  cm.setDoubaoLlmApiKey('original');
  cm.saveCustomProvider({ id: 'one', name: 'original', curlCommand: 'curl original' });
  cm.saveCurlProvider({ id: 'one', name: 'original', curlCommand: 'curl original', responsePath: 'answer' });
  const old = structuredClone(cm.getAllCredentials()); const disk = fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8');
  const events = []; cm.onConfigurationChanged(target => events.push(target));
  t.mock.method(fs, 'renameSync', () => { throw new Error('rename failed'); });
  assert.throws(() => change(cm)); assert.deepEqual(cm.getAllCredentials(), old); assert.deepEqual(events, []);
  assert.equal(fs.readFileSync(path.join(dir, 'credentials.enc'), 'utf8'), disk);
  assert.equal(fs.existsSync(path.join(dir, 'credentials.enc.tmp')), false, 'failed saves must clean the temporary credentials copy');
});

test('local runtime version changes invalidate historical load identity', async () => {
  const h = setup(); h.credentials.setSttProvider('local-sensevoice');
  h.service.initialize(legacy); await verify(h, 'stt');
  const identity = h.service.getSnapshot().checks.stt.configIdentity;
  const s = factory().createOnboardingService({ credentials: h.credentials, settings: h.settings,
    database: { hasNonDemoMeeting: () => false }, readModelMetadata: () => h.metadata, runtimeVersion: 'next-app-runtime' });
  s.initialize(legacy);
  assert.notEqual(s.getSnapshot().checks.stt.configIdentity, identity);
  assert.notEqual(s.getSnapshot().checks.stt.status, 'previously_verified');
});

test('per-channel Whisper file changes invalidate the selected speech configuration', async () => {
  const m = managers(); m.credentials.setSttProvider('local-whisper');
  m.settings.set('localWhisperPerChannelEnabled', true); m.settings.set('localWhisperModelMic', 'Xenova/whisper-tiny');
  let micMtime = 1;
  const service = factory().createOnboardingService({ ...m, database: { hasNonDemoMeeting: () => false },
    readModelMetadata: (_provider, model) => ({ runtime: 'test', files: [{ name: 'model.onnx', size: 10,
      mtimeMs: model === 'Xenova/whisper-tiny' ? micMtime : 1 }] }) });
  service.initialize(legacy); const s = service.getSnapshot();
  service.recordValidation({ target: 'stt', provider: 'local-whisper', configRevision: 0,
    configIdentity: s.checks.stt.configIdentity, checkedAt: 1, depth: 'model_load', result: 'passed' });
  assert.equal(service.getSnapshot().checks.stt.status, 'verified');
  micMtime = 2; assert.equal(service.getSnapshot().checks.stt.status, 'missing');
});

test('QCLOUD AI validation prepares the legacy saved key revision without replacing the selected service', () => {
  const h = setup(); h.credentials.credentials = { defaultModel: 'natively', nativelyApiKey: 'legacy-qcloud-key' };
  const f = factory();
  f.prepareOnboardingCredentials(h, 'ai');
  assert.ok(h.credentials.getCredentialVersion('nativelyApiKey'));
  assert.equal(h.credentials.getDefaultModel(), 'natively');
  assert.equal(f.readOnboardingConfiguration(h, 'ai').errorCode, undefined);
});
