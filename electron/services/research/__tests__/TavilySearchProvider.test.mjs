// electron/services/research/__tests__/TavilySearchProvider.test.mjs
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

const providerPath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/TavilySearchProvider.js',
);

describe('TavilySearchProvider', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  const restoreFetch = () => { globalThis.fetch = originalFetch; };

  test('search() POSTs to https://api.tavily.com/search with api_key', async () => {
    let capturedUrl, capturedBody;
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        results: [{ title: 'Apple Inc.', url: 'https://apple.com', content: 'Tech co' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { TavilySearchProvider } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'tvly-test', fetchImpl: globalThis.fetch });
    const results = await p.search(['Apple revenue 2024']);
    assert.equal(capturedUrl, 'https://api.tavily.com/search');
    assert.equal(capturedBody.api_key, 'tvly-test');
    assert.equal(capturedBody.query, 'Apple revenue 2024');
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Apple Inc.');
    assert.equal(results[0].url, 'https://apple.com');
    restoreFetch();
  });

  test('search() throws TavilyQuotaError on HTTP 429', async () => {
    globalThis.fetch = async () => new Response('{"detail":"quota exceeded"}', { status: 429 });
    const { TavilySearchProvider, TavilyQuotaError } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'tvly-test', fetchImpl: globalThis.fetch });
    await assert.rejects(() => p.search(['x']), (err) => err instanceof TavilyQuotaError);
    restoreFetch();
  });

  test('search() throws TavilyAuthError on HTTP 401', async () => {
    globalThis.fetch = async () => new Response('unauthorized', { status: 401 });
    const { TavilySearchProvider, TavilyAuthError } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'bad', fetchImpl: globalThis.fetch });
    await assert.rejects(() => p.search(['x']), (err) => err instanceof TavilyAuthError);
    restoreFetch();
  });

  test('search() throws TavilyNetworkError on AbortError', async () => {
    globalThis.fetch = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const { TavilySearchProvider, TavilyNetworkError } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'k', fetchImpl: globalThis.fetch });
    await assert.rejects(() => p.search(['x']), (err) => err instanceof TavilyNetworkError);
    restoreFetch();
  });

  test('search() filters out results with invalid URLs', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      results: [
        { title: 'Valid', url: 'https://apple.com/valid', content: 'ok' },
        { title: 'Empty URL', url: '', content: 'bad' },
        { title: 'Relative URL', url: '/path', content: 'bad' },
        { title: 'No URL field', content: 'bad' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const { TavilySearchProvider } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'k', fetchImpl: globalThis.fetch });
    const results = await p.search(['x']);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Valid');
    restoreFetch();
  });

  test('search() dedupes results by URL across multiple queries', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      results: [
        { title: 'A', url: 'https://apple.com/1', content: 'a' },
        { title: 'A2', url: 'https://apple.com/1', content: 'a2' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const { TavilySearchProvider } = cjsRequire(providerPath);
    const p = new TavilySearchProvider({ apiKey: 'k', fetchImpl: globalThis.fetch });
    const results = await p.search(['q1', 'q2']);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'A');
    restoreFetch();
  });
});