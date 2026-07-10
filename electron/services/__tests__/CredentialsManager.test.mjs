// electron/services/__tests__/CredentialsManager.test.mjs
//
// Phase 4 PR4.3 — coverage for CredentialsManager (currently 29.48%).
// The module is a singleton, so we mock `electron` and clear the require cache
// per test (mirrors SkillActivationManager.test.mjs). Coverage focus:
//   - constructor + getInstance (singleton lifecycle)
//   - init() loads from disk
//   - per-provider getter / setter round-trip
//   - STT provider migration paths (doubao→doubao-auc, natively→qcloud-stt, etc.)
//   - anyVisionProviderConfigured / anyLocalVisionProviderConfigured
//   - customProviders / curlProviders add/remove
//   - preferred-model getter / setter
//   - natively key promotion (default model switch) and revert on clear
//   - businessSystemKnowledgeSource CRUD
//   - free-trial token save / clear (claim flag must NOT be cleared on wipe)
//   - scrubMemory clears nested business system credentials
//   - clearAll deletes the credentials file
//   - saveCredentials throws on filesystem failure and surfaces the error
//   - getAllCredentials returns a shallow copy (mutation does not leak)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const distPath = path.join(root, 'dist-electron/electron/services/CredentialsManager.js');

function stubElectron(tmpUserData) {
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = {
    app: {
      isReady: () => true,
      getPath: (name) => (name === 'userData' ? tmpUserData : os.tmpdir()),
    },
  };
  stubModule.loaded = true;
  require.cache[electronId] = stubModule;
  try {
    require.cache[require.resolve(electronId)] = stubModule;
  } catch {
    // Electron is provided by the host app.
  }
}

function loadManager() {
  // Always re-load the module from disk so the singleton is reset.
  delete require.cache[distPath];
  const mod = require(distPath);
  // Reset the singleton so each test starts fresh.
  mod.CredentialsManager.instance = undefined;
  return mod.CredentialsManager;
}

let tmpUserData;

beforeEach(() => {
  tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-credentials-'));
  stubElectron(tmpUserData);
});

afterEach(() => {
  // Best-effort cleanup; ignore EBUSY on some platforms.
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('getInstance() returns a singleton', () => {
  const CredentialsManager = loadManager();
  const a = CredentialsManager.getInstance();
  const b = CredentialsManager.getInstance();
  assert.equal(a, b, 'getInstance must return the same instance');
});

test('init() loads credentials from disk', () => {
  // Pre-populate the credentials file with known content.
  fs.writeFileSync(
    path.join(tmpUserData, 'credentials.enc'),
    JSON.stringify({ geminiApiKey: 'g-loaded', openaiApiKey: 'oai-loaded' }, null, 2),
    'utf8',
  );
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.equal(mgr.getGeminiApiKey(), 'g-loaded');
  assert.equal(mgr.getOpenaiApiKey(), 'oai-loaded');
});

test('init() starts with empty credentials when no file is present', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.equal(mgr.getGeminiApiKey(), undefined);
  assert.equal(mgr.getOpenaiApiKey(), undefined);
});

test('setGeminiApiKey / getGeminiApiKey round-trips and persists to disk', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setGeminiApiKey('g-key-1');
  assert.equal(mgr.getGeminiApiKey(), 'g-key-1');
  // File should contain the key in JSON form.
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpUserData, 'credentials.enc'), 'utf8'));
  assert.equal(onDisk.geminiApiKey, 'g-key-1');
});

test('setSttProvider("doubao") is normalized to "doubao-auc" on disk', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setSttProvider('doubao');
  assert.equal(mgr.getSttProvider(), 'doubao-auc');
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpUserData, 'credentials.enc'), 'utf8'));
  assert.equal(onDisk.sttProvider, 'doubao-auc');
});

test('getSttProvider() self-heals stored "doubao" → "doubao-auc" and persists', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  // Manually set the legacy value (bypassing the normalization in setSttProvider)
  // by writing the file directly, then re-init.
  fs.writeFileSync(
    path.join(tmpUserData, 'credentials.enc'),
    JSON.stringify({ sttProvider: 'doubao' }, null, 2),
    'utf8',
  );
  mgr.init();
  assert.equal(mgr.getSttProvider(), 'doubao-auc');
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpUserData, 'credentials.enc'), 'utf8'));
  assert.equal(onDisk.sttProvider, 'doubao-auc');
});

test('getSttProvider() migrates "natively" → "qcloud-stt" when nativelyApiKey is set', () => {
  fs.writeFileSync(
    path.join(tmpUserData, 'credentials.enc'),
    JSON.stringify({ sttProvider: 'natively', nativelyApiKey: 'nkey' }, null, 2),
    'utf8',
  );
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.equal(mgr.getSttProvider(), 'qcloud-stt');
});

test('getSttProvider() migrates "natively" → "local-sensevoice" when no nativelyApiKey is set', () => {
  fs.writeFileSync(
    path.join(tmpUserData, 'credentials.enc'),
    JSON.stringify({ sttProvider: 'natively' }, null, 2),
    'utf8',
  );
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.equal(mgr.getSttProvider(), 'local-sensevoice');
});

test('getSttProvider() defaults to "none" when no provider is configured', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.equal(mgr.getSttProvider(), 'none');
});

test('anyVisionProviderConfigured() returns true when nativelyApiKey is present', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setNativelyApiKey('nkey');
  assert.equal(mgr.anyVisionProviderConfigured(), true);
});

test('anyVisionProviderConfigured() returns false when no provider is configured', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.equal(mgr.anyVisionProviderConfigured(), false);
});

test('anyLocalVisionProviderConfigured() returns true when ollamaBaseUrl is set', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.credentials.ollamaBaseUrl = 'http://localhost:11434';
  assert.equal(mgr.anyLocalVisionProviderConfigured(), true);
});

test('anyLocalVisionProviderConfigured() returns false when nothing is set', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  assert.equal(mgr.anyLocalVisionProviderConfigured(), false);
});

test('saveCustomProvider / deleteCustomProvider round-trip', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.saveCustomProvider({ id: 'p1', name: 'Provider One', curlCommand: 'curl ...' });
  mgr.saveCustomProvider({ id: 'p2', name: 'Provider Two', curlCommand: 'curl ...' });
  let providers = mgr.getCustomProviders();
  assert.equal(providers.length, 2);
  // Update existing
  mgr.saveCustomProvider({ id: 'p1', name: 'Provider One Updated', curlCommand: 'curl v2' });
  providers = mgr.getCustomProviders();
  assert.equal(providers.length, 2);
  assert.equal(providers.find(p => p.id === 'p1').name, 'Provider One Updated');
  // Delete
  mgr.deleteCustomProvider('p2');
  providers = mgr.getCustomProviders();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].id, 'p1');
});

test('getPreferredModel / setPreferredModel round-trips per provider', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  assert.equal(mgr.getPreferredModel('gemini'), undefined);
  mgr.setPreferredModel('gemini', 'gemini-2.0-flash');
  assert.equal(mgr.getPreferredModel('gemini'), 'gemini-2.0-flash');
  mgr.setPreferredModel('doubao', 'doubao-pro');
  assert.equal(mgr.getPreferredModel('doubao'), 'doubao-pro');
  assert.equal(mgr.getPreferredModel('openai'), undefined);
});

test('setNativelyApiKey promotes default model to "natively" when no preference was set', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setNativelyApiKey('nkey');
  assert.equal(mgr.getDefaultModel(), 'natively');
});

test('setNativelyApiKey() with selectAsDefault=true forces the default even when a non-gemini model is set', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setDefaultModel('openai-custom');
  mgr.setNativelyApiKey('nkey', { selectAsDefault: true });
  assert.equal(mgr.getDefaultModel(), 'natively');
});

test('setNativelyApiKey("") clears the key and reverts the default model', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setNativelyApiKey('nkey');
  assert.equal(mgr.getDefaultModel(), 'natively');
  mgr.setNativelyApiKey('');
  assert.equal(mgr.getNativelyApiKey(), undefined);
  // The default should revert away from 'natively'
  assert.notEqual(mgr.getDefaultModel(), 'natively');
});

test('saveBusinessSystemKnowledgeSource + getBusinessSystemKnowledgeSourcesPublic redacts secrets', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.saveBusinessSystemKnowledgeSource(
    {
      id: 'src-1',
      name: 'Windchill',
      kind: 'plm',
      url: 'https://example.test/mcp',
      authType: 'api_key',
      enabled: true,
      isDefault: true,
    },
    { apiKey: 'sk-secret-1', username: 'u1', password: 'p1' },
  );

  const publicView = mgr.getBusinessSystemKnowledgeSourcesPublic();
  assert.equal(publicView.length, 1);
  assert.equal(publicView[0].credentialState.hasApiKey, true);
  assert.equal(publicView[0].credentialState.hasUsername, true);
  assert.equal(publicView[0].credentialState.hasPassword, true);
  // Plaintext credentials MUST NOT leak through the public view.
  const json = JSON.stringify(publicView);
  assert.doesNotMatch(json, /sk-secret-1/);
  assert.doesNotMatch(json, /p1/);

  // The private getter still returns the real secrets.
  const privateCreds = mgr.getBusinessSystemCredentials('src-1');
  assert.equal(privateCreds.apiKey, 'sk-secret-1');
  assert.equal(privateCreds.username, 'u1');
  assert.equal(privateCreds.password, 'p1');

  // Delete
  mgr.deleteBusinessSystemKnowledgeSource('src-1');
  assert.equal(mgr.getBusinessSystemKnowledgeSources().length, 0);
  assert.equal(mgr.getBusinessSystemCredentials('src-1'), undefined);
});

test('saveBusinessSystemKnowledgeSource demotes the previous default to non-default', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.saveBusinessSystemKnowledgeSource({
    id: 'src-1', name: 'A', kind: 'plm', url: 'https://a', authType: 'api_key',
    enabled: true, isDefault: true,
  });
  mgr.saveBusinessSystemKnowledgeSource({
    id: 'src-2', name: 'B', kind: 'plm', url: 'https://b', authType: 'api_key',
    enabled: true, isDefault: true,
  });
  const sources = mgr.getBusinessSystemKnowledgeSources();
  assert.equal(sources.length, 2);
  const a = sources.find(s => s.id === 'src-1');
  const b = sources.find(s => s.id === 'src-2');
  assert.equal(a.isDefault, false);
  assert.equal(b.isDefault, true);
});

test('trial token save/clear keeps the claimed flag sticky', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setTrialToken('tok-1', '2099-01-01T00:00:00Z', '2024-01-01T00:00:00Z');
  assert.equal(mgr.getTrialToken(), 'tok-1');
  assert.equal(mgr.getTrialExpiresAt(), '2099-01-01T00:00:00Z');
  assert.equal(mgr.getTrialStartedAt(), '2024-01-01T00:00:00Z');
  assert.equal(mgr.getTrialClaimed(), true);

  mgr.clearTrialToken();
  assert.equal(mgr.getTrialToken(), undefined);
  // The claim flag is sticky: clears the token but the UI must still hide the card.
  assert.equal(mgr.getTrialClaimed(), true);
});

test('scrubMemory clears all string credentials and nested business system credentials', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setGeminiApiKey('g-1');
  mgr.setOpenaiApiKey('o-1');
  mgr.saveBusinessSystemKnowledgeSource(
    { id: 'src-1', name: 'B', kind: 'plm', url: 'https://b', authType: 'api_key', enabled: true, isDefault: true },
    { apiKey: 'sk-b1', username: 'u-b', password: 'p-b' },
  );
  mgr.scrubMemory();
  // All string credentials are wiped — the in-memory store is replaced with a
  // new empty object, so getters return undefined.
  assert.equal(mgr.getGeminiApiKey(), undefined);
  assert.equal(mgr.getOpenaiApiKey(), undefined);
  // Nested business system credentials are wiped too.
  assert.equal(mgr.getBusinessSystemCredentials('src-1'), undefined);
});

test('clearAll() deletes the credentials file from disk', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setGeminiApiKey('g-1');
  const filePath = path.join(tmpUserData, 'credentials.enc');
  assert.equal(fs.existsSync(filePath), true, 'credentials.enc should exist after a setter call');
  mgr.clearAll();
  assert.equal(fs.existsSync(filePath), false, 'clearAll should delete the credentials file');
});

test('getAllCredentials() returns a shallow copy, not the live reference', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setGeminiApiKey('g-1');
  const snapshot = mgr.getAllCredentials();
  // Mutating the snapshot must NOT change the live state.
  snapshot.geminiApiKey = 'tampered';
  assert.equal(mgr.getGeminiApiKey(), 'g-1');
});

test('saveCredentials() throws (and surfaces) when the userData directory is read-only', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  // Replace the file path with one inside a directory we make read-only
  // by pre-creating a FILE at that path. fs.writeFileSync into a path whose
  // parent component is a regular file fails with ENOTDIR.
  const blocker = path.join(tmpUserData, 'blocker');
  fs.writeFileSync(blocker, 'i am a file, not a directory');
  // Patch the private method via prototype to redirect the credentials file
  // path into the read-only blocker location.
  mgr.credentialsFilePath = () => path.join(blocker, 'credentials.enc');
  assert.throws(() => mgr.saveCredentials(), /ENOTDIR|EISDIR|EROFS|EPERM|EACCES/);
});

test('getDefaultModel() returns the documented fallback when no default is set', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  // The fallback model id is the well-known default for the chat pipeline.
  assert.match(mgr.getDefaultModel(), /doubao-seed-2-0-lite-260215/);
});

test('getSttLanguage() and getAiResponseLanguage() return documented defaults', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.equal(mgr.getSttLanguage(), 'english-us');
  assert.equal(mgr.getAiResponseLanguage(), 'Chinese');
});

test('setOpenAiSttBaseUrl("") normalizes to undefined (so callers can fall back to the default endpoint)', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setOpenAiSttBaseUrl('   ');
  assert.equal(mgr.getOpenAiSttBaseUrl(), undefined);
  mgr.setOpenAiSttBaseUrl('https://self-hosted.example/v1');
  assert.equal(mgr.getOpenAiSttBaseUrl(), 'https://self-hosted.example/v1');
});

test('setTavilyApiKey("") normalizes to undefined and persist on disk', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setTavilyApiKey('t-1');
  assert.equal(mgr.getTavilyApiKey(), 't-1');
  mgr.setTavilyApiKey('   ');
  assert.equal(mgr.getTavilyApiKey(), undefined);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmpUserData, 'credentials.enc'), 'utf8'));
  assert.equal(onDisk.tavilyApiKey, undefined);
});

test('getCurlProviders() returns an empty array by default', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.init();
  assert.deepEqual(mgr.getCurlProviders(), []);
});

test('saveCurlProvider() / deleteCurlProvider() round-trip', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.saveCurlProvider({ id: 'c1', name: 'Curl One', curlCommand: 'curl', responsePath: 'choices[0].message.content' });
  mgr.saveCurlProvider({ id: 'c2', name: 'Curl Two', curlCommand: 'curl', responsePath: 'a.b.c' });
  let list = mgr.getCurlProviders();
  assert.equal(list.length, 2);
  mgr.deleteCurlProvider('c1');
  list = mgr.getCurlProviders();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'c2');
});

test('getDoubaoAucApiKey() reuses the doubao key (current single-key design)', () => {
  const CredentialsManager = loadManager();
  const mgr = CredentialsManager.getInstance();
  mgr.setDoubaoApiKey('doubao-key-1');
  assert.equal(mgr.getDoubaoAucApiKey(), 'doubao-key-1');
  mgr.setDoubaoAucApiKey('doubao-auc-key-2');
  assert.equal(mgr.getDoubaoApiKey(), 'doubao-auc-key-2');
  assert.equal(mgr.getDoubaoAucApiKey(), 'doubao-auc-key-2');
});