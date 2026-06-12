import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const providerPath = path.resolve(__dirname, '../../../dist-electron/electron/rag/providers/DoubaoEmbeddingProvider.js');

async function loadProvider() {
  return import(pathToFileURL(providerPath).href);
}

test('DoubaoEmbeddingProvider does not call the API when model is not configured', async () => {
  const { DoubaoEmbeddingProvider } = await loadProvider();
  const provider = new DoubaoEmbeddingProvider('fake-key');

  assert.equal(provider.model, 'unknown', 'model should fall back to unknown when not provided');

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: false, status: 404, text: async () => 'Not Found' };
  };

  try {
    const available = await provider.isAvailable();
    assert.equal(available, false, 'provider should report unavailable when model is not configured');
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false, 'should not make a network request when model is not configured');
});

test('DoubaoEmbeddingProvider does not call the API when model is unknown', async () => {
  const { DoubaoEmbeddingProvider } = await loadProvider();
  const provider = new DoubaoEmbeddingProvider('fake-key', 'unknown');

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return { ok: false, status: 404, text: async () => 'Not Found' };
  };

  try {
    const available = await provider.isAvailable();
    assert.equal(available, false, 'provider should report unavailable when model is unknown');
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false, 'should not make a network request when model is unknown');
});
