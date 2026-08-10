import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadModule() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/McpToolCatalogCache.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

const tool = (name) => ({ name, inputSchema: { type: 'object', properties: {} } });

test('catalog cache isolates the same source by opaque credential revision', async () => {
  const { McpToolCatalogCache } = await loadModule();
  const cache = new McpToolCatalogCache({ ttlMs: 600_000, now: () => 100 });
  let loads = 0;

  const first = await cache.getOrLoad({
    sourceId: 'plm',
    credentialRevision: 1,
    load: async () => [tool(`tool-${++loads}`)],
  });
  const cached = await cache.getOrLoad({
    sourceId: 'plm',
    credentialRevision: 1,
    load: async () => [tool(`tool-${++loads}`)],
  });
  const afterCredentialChange = await cache.getOrLoad({
    sourceId: 'plm',
    credentialRevision: 2,
    load: async () => [tool(`tool-${++loads}`)],
  });

  assert.equal(first[0].name, 'tool-1');
  assert.equal(cached[0].name, 'tool-1');
  assert.equal(afterCredentialChange[0].name, 'tool-2');
  assert.equal(loads, 2);
});

test('catalog cache expires by TTL and invalidate removes every revision for a source', async () => {
  const { McpToolCatalogCache } = await loadModule();
  let now = 100;
  let loads = 0;
  const cache = new McpToolCatalogCache({ ttlMs: 50, now: () => now });
  const load = async () => [tool(`tool-${++loads}`)];

  await cache.getOrLoad({ sourceId: 'plm', credentialRevision: 1, load });
  now = 151;
  const expired = await cache.getOrLoad({ sourceId: 'plm', credentialRevision: 1, load });
  await cache.getOrLoad({ sourceId: 'plm', credentialRevision: 2, load });
  cache.invalidate('plm');
  const invalidated = await cache.getOrLoad({ sourceId: 'plm', credentialRevision: 2, load });

  assert.equal(expired[0].name, 'tool-2');
  assert.equal(invalidated[0].name, 'tool-4');
});

test('failed discovery is not cached and concurrent loads share one promise', async () => {
  const { McpToolCatalogCache } = await loadModule();
  const cache = new McpToolCatalogCache({ ttlMs: 600_000, now: () => 100 });
  let attempts = 0;
  const failingLoad = async () => {
    attempts += 1;
    throw new Error('discovery failed');
  };

  await assert.rejects(() => cache.getOrLoad({ sourceId: 'plm', credentialRevision: 1, load: failingLoad }));
  await assert.rejects(() => cache.getOrLoad({ sourceId: 'plm', credentialRevision: 1, load: failingLoad }));
  assert.equal(attempts, 2);

  let resolveLoad;
  const sharedLoad = () => new Promise((resolve) => { resolveLoad = resolve; });
  const a = cache.getOrLoad({ sourceId: 'plm', credentialRevision: 1, load: sharedLoad });
  const b = cache.getOrLoad({ sourceId: 'plm', credentialRevision: 1, load: sharedLoad });
  resolveLoad([tool('shared')]);
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first[0].name, 'shared');
  assert.equal(second[0].name, 'shared');
});

test('invalidate during discovery prevents the stale in-flight result from being cached', async () => {
  const { McpToolCatalogCache } = await loadModule();
  const cache = new McpToolCatalogCache({ ttlMs: 600_000, now: () => 100 });
  let resolveFirst;
  const first = cache.getOrLoad({
    sourceId: 'plm',
    credentialRevision: 1,
    load: () => new Promise((resolve) => { resolveFirst = resolve; }),
  });

  cache.invalidate('plm');
  resolveFirst([tool('stale')]);
  await first;
  const fresh = await cache.getOrLoad({
    sourceId: 'plm',
    credentialRevision: 1,
    load: async () => [tool('fresh')],
  });

  assert.equal(fresh[0].name, 'fresh');
});
