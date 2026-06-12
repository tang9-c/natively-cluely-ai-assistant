import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolverPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/EmbeddingProviderResolver.js');

function loadResolver() {
  return import(pathToFileURL(resolverPath).href);
}

test('EmbeddingProviderResolver skips Doubao when embedding model is not configured', async () => {
  mock.module('electron', {
    namedExports: {
      app: {
        isPackaged: false,
        getAppPath: () => path.resolve(__dirname, '../../..'),
      },
    },
  });

  const { EmbeddingProviderResolver } = await loadResolver();

  const originalFetch = global.fetch;
  const originalLog = console.log;
  let doubaoRequestMade = false;
  const logs = [];
  global.fetch = async (url) => {
    if (typeof url === 'string' && url.includes('ark.cn-beijing.volces.com')) {
      doubaoRequestMade = true;
    }
    return { ok: false, status: 404, text: async () => 'Not Found' };
  };
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    // Resolve with a Doubao key but no embedding model/endpoint ID.
    // Local provider should be selected, not Doubao.
    const provider = await EmbeddingProviderResolver.resolve({
      doubaoKey: 'fake-key',
    });
    assert.notEqual(provider.name, 'doubao', 'Doubao should not be selected when no endpoint ID is configured');
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    mock.restoreAll();
  }

  assert.equal(doubaoRequestMade, false, 'Should not make any Doubao API request when endpoint ID is missing');
  assert.equal(
    logs.some(log => log.includes('[EmbeddingProviderResolver] Provider doubao unavailable')),
    false,
    'Should not probe Doubao availability when no endpoint ID is configured'
  );
});

test('EmbeddingProviderResolver selects Doubao when a valid endpoint ID is configured', async () => {
  mock.module('electron', {
    namedExports: {
      app: {
        isPackaged: false,
        getAppPath: () => path.resolve(__dirname, '../../..'),
      },
    },
  });

  const { EmbeddingProviderResolver } = await loadResolver();

  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.includes('ark.cn-beijing.volces.com')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      assert.equal(body.model, 'ep-test-123', 'request should use configured endpoint ID');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: new Array(4096).fill(0.1) }],
        }),
        text: async () => '',
      };
    }
    return { ok: false, status: 404, text: async () => 'Not Found' };
  };

  try {
    const provider = await EmbeddingProviderResolver.resolve({
      doubaoKey: 'fake-key',
      doubaoEmbeddingModel: 'ep-test-123',
    });
    assert.equal(provider.name, 'doubao');
    assert.equal(provider.model, 'ep-test-123');
  } finally {
    global.fetch = originalFetch;
    mock.restoreAll();
  }
});
