import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function loadRouter() {
  const routerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/ProviderRouter.js');
  return import(pathToFileURL(routerPath).href);
}

test('assertProviderDataScopes throws ProviderScopeError when a denied scope is requested', async () => {
  const { assertProviderDataScopes, ProviderScopeError } = await loadRouter();

  assert.throws(
    () => assertProviderDataScopes('openai', ['transcript'], { transcript: false }),
    (err) => err instanceof ProviderScopeError && err.deniedScopes.includes('transcript')
  );
});

test('assertProviderDataScopes is a no-op when scopes are allowed or unset', async () => {
  const { assertProviderDataScopes } = await loadRouter();

  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], { transcript: true }));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], {}));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', ['transcript'], undefined));
  assert.doesNotThrow(() => assertProviderDataScopes('openai', [], { transcript: false }));
});

test('routeLLMProviders marks all providers unavailable when scope is denied', async () => {
  const { routeLLMProviders } = await loadRouter();

  const attempts = routeLLMProviders({
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: false },
  });

  for (const attempt of attempts) {
    assert.equal(attempt.status, 'unavailable', `${attempt.provider} should be unavailable`);
    assert.equal(attempt.unavailableReason, 'disabled');
  }
});

test('routeLLMProviders keeps providers available when scopes are allowed', async () => {
  const { routeLLMProviders } = await loadRouter();

  const attempts = routeLLMProviders({
    capability: 'chat',
    availability: { hasOpenAI: true, hasGroq: true, hasGemini: true },
    dataScopes: ['transcript'],
    scopePolicy: { transcript: true },
  });

  const available = attempts.filter(a => a.status === 'available');
  assert.ok(available.length > 0, 'expected at least one provider to be available');
});

test('LLMHelper guards every outbound provider with assertOutboundScopes', () => {
  const src = read('electron/LLMHelper.ts');

  for (const guardSite of [
    "this.assertOutboundScopes('groq'",
    "this.assertOutboundScopes('openai'",
    "this.assertOutboundScopes('claude'",
    "this.assertOutboundScopes('gemini'",
    "this.assertOutboundScopes('natively'",
    "this.assertOutboundScopes('custom_curl'",
    "this.assertOutboundScopes('custom_provider'",
  ]) {
    assert.ok(src.includes(guardSite), `LLMHelper missing scope guard for ${guardSite}`);
  }
});

test('LLMHelper passes data scopes and policy to routeLLMProviders for fallback rotation', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /dataScopes: outboundScopes/);
  assert.match(src, /scopePolicy,/);
});

test('Embedding provider resolver fails closed when embeddings scope is denied', () => {
  const src = read('electron/rag/EmbeddingProviderResolver.ts');

  assert.match(src, /assertProviderDataScopes\('cloud_embeddings', \['embeddings'\], config\.providerDataScopes\)/);
  assert.match(src, /if \(!embeddingsDenied && config\.qcloudKey\)/);
  assert.match(src, /candidates\.push\(factories\.qcloud\(config\.qcloudKey\)\)/);
});

test('RAGManager forwards providerDataScopes from config and runtime keys', () => {
  const src = read('electron/rag/RAGManager.ts');

  assert.match(src, /providerDataScopes\?: ProviderDataScopePolicy/);
  assert.match(src, /providerDataScopes: config\.providerDataScopes/);
});

test('runtime embedding reinitialization preserves Doubao endpoint configuration', () => {
  const processing = read('electron/ProcessingHelper.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const pipeline = read('electron/rag/EmbeddingPipeline.ts');
  const runtime = read('electron/rag/EmbeddingRuntimeConfig.ts');

  assert.match(processing, /initializeEmbeddings\(buildEmbeddingRuntimeConfig\(\)\)/);
  assert.match(runtime, /credentials\.getDoubaoEmbeddingModel\(\)/);
  assert.match(runtime, /process\.env\.DOUBAO_EMBEDDING_MODEL/);
  assert.match(runtime, /ollamaUrl: process\.env\.OLLAMA_URL \|\| 'http:\/\/localhost:11434'/);
  assert.match(ipc, /initializeEmbeddings\(buildEmbeddingRuntimeConfig\(\)\)/);
  assert.match(pipeline, /prev\.doubaoEmbeddingModel !== next\.doubaoEmbeddingModel/);
});

test('embedding runtime config includes the saved QCLOUD key and every fallback credential', () => {
  const runtime = read('electron/rag/EmbeddingRuntimeConfig.ts');

  assert.match(runtime, /qcloudKey:\s*credentials\.getNativelyApiKey\(\)\s*\|\|\s*process\.env\.NATIVE_API_KEY\s*\|\|\s*undefined/);
  assert.match(runtime, /doubaoKey:/);
  assert.match(runtime, /doubaoEmbeddingModel:/);
  assert.match(runtime, /openaiKey:/);
  assert.match(runtime, /geminiKey:/);
  assert.match(runtime, /ollamaUrl:/);
  assert.match(runtime, /providerDataScopes:/);
});

test('all RAG initialization paths reuse the complete embedding runtime config', () => {
  const main = read('electron/main.ts');
  const processing = read('electron/ProcessingHelper.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const ragManager = read('electron/rag/RAGManager.ts');
  const pipeline = read('electron/rag/EmbeddingPipeline.ts');

  assert.match(main, /buildEmbeddingRuntimeConfig\(\)/);
  assert.match(processing, /initializeEmbeddings\(buildEmbeddingRuntimeConfig\(\)\)/);
  assert.ok(
    (ipc.match(/initializeEmbeddings\(buildEmbeddingRuntimeConfig\(\)\)/g) || []).length >= 3,
    'QCLOUD key, Doubao key, and Doubao model changes must all reinitialize with complete config',
  );
  assert.match(ragManager, /qcloudKey\?: string/);
  assert.match(ragManager, /qcloudKey: config\.qcloudKey/);
  assert.match(pipeline, /prev\.qcloudKey !== next\.qcloudKey/);
  assert.match(
    pipeline,
    /prev\.providerDataScopes\?\.embeddings !== next\.providerDataScopes\?\.embeddings/,
  );
});

test('SettingsManager exposes providerDataScopes setting', () => {
  const src = read('electron/services/SettingsManager.ts');

  assert.match(src, /providerDataScopes\?:\s*\{[\s\S]+transcript\?: boolean;/);
  assert.match(src, /post_call_summary\?: boolean;/);
});

test('IPC handlers expose get/set provider-data-scopes and broadcast updates', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const handlerStart = ipc.indexOf("safeHandle('set-provider-data-scopes'");
  const handlerEnd = ipc.indexOf("\n  safeHandle(", handlerStart + 1);
  const scopeHandler = ipc.slice(handlerStart, handlerEnd);

  assert.match(ipc, /safeHandle\(['"]get-provider-data-scopes['"]/);
  assert.match(ipc, /safeHandle\(['"]set-provider-data-scopes['"]/);
  assert.match(scopeHandler, /broadcast\('provider-data-scopes-changed', sanitized\)/);
  assert.match(scopeHandler, /SettingsManager\.getInstance\(\)\.set\('providerDataScopes'/);
  assert.match(scopeHandler, /initializeEmbeddings\(buildEmbeddingRuntimeConfig\(\)\)/);
});

test('preload and renderer types expose provider data scope controls', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(preload, /getProviderDataScopes:/);
  assert.match(preload, /setProviderDataScopes:/);
  assert.match(preload, /onProviderDataScopesChanged:/);
  assert.match(preload, /ipcRenderer\.invoke\('get-provider-data-scopes'\)/);
  assert.match(preload, /ipcRenderer\.invoke\('set-provider-data-scopes', scopes\)/);

  assert.match(types, /getProviderDataScopes:\s*\(\)\s*=>\s*Promise/);
  assert.match(types, /setProviderDataScopes:\s*\(scopes:/);
});

test('AIProvidersSettings renders cloud provider data scope controls wired to real IPC', () => {
  const src = read('src/components/settings/AIProvidersSettings.tsx');

  // Stable i18n-safe anchor: data-testid survives translation.
  assert.match(src, /data-testid="cloud-provider-data-scopes"/);
  assert.match(src, /getProviderDataScopes\?\.\(\)\.then\(setProviderDataScopes\)/);
  assert.match(src, /setProviderDataScopes\?\.\(next\)/);
  assert.match(src, /onProviderDataScopesChanged\(setProviderDataScopes\)/);
});

test('AIProvidersSettings hides legacy cloud API key provider cards', () => {
  const src = read('src/components/settings/AIProvidersSettings.tsx');

  for (const provider of ['Gemini', 'Groq', 'OpenAI', 'Claude']) {
    assert.doesNotMatch(src, new RegExp(`providerName="${provider}"`));
  }

  assert.match(src, /providerName="Doubao \(Volcengine\)"/);
});

test('main and ProcessingHelper hydrate ragManager.initializeEmbeddings with policy', () => {
  const main = read('electron/main.ts');
  const ph = read('electron/ProcessingHelper.ts');
  const runtime = read('electron/rag/EmbeddingRuntimeConfig.ts');

  assert.match(main, /buildEmbeddingRuntimeConfig\(\)/);
  assert.match(ph, /buildEmbeddingRuntimeConfig\(\)/);
  assert.match(runtime, /providerDataScopes/);
});
