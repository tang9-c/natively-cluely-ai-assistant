import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RemoteAdService } from '../../../../dist-electron/electron/services/launcher-ads/RemoteAdService.js';

const validConfig = {
  version: 1,
  ads: [{ id: 'one', imageUrl: 'https://cdn.example.com/one.webp', alt: 'one', priority: 1 }],
};

test('fetches valid config and writes cache', async () => {
  const writes = [];
  const service = new RemoteAdService({
    configUrl: 'https://config.example.com/launcher-ads.json',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => null,
    writeCache: (value) => writes.push(value),
    fetchJson: async () => validConfig,
  });

  assert.deepEqual((await service.getAds()).map((ad) => ad.id), ['one']);
  assert.equal(writes.length, 1);
});

test('falls back to stale valid cache, then builtin ad', async () => {
  const cached = { fetchedAt: '2026-07-20T12:00:00Z', config: validConfig };
  const staleService = new RemoteAdService({
    configUrl: 'https://config.example.com/launcher-ads.json',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => cached,
    writeCache: () => {},
    fetchJson: async () => { throw new Error('offline'); },
  });
  assert.deepEqual((await staleService.getAds()).map((ad) => ad.id), ['one']);

  const emptyService = new RemoteAdService({
    configUrl: '',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => null,
    writeCache: () => {},
    fetchJson: async () => { throw new Error('must not run'); },
  });
  assert.equal((await emptyService.getAds())[0].builtin, true);
});

test('accepts only https target URLs', () => {
  assert.equal(RemoteAdService.isAllowedTargetUrl('https://example.com/a'), true);
  assert.equal(RemoteAdService.isAllowedTargetUrl('http://example.com/a'), false);
  assert.equal(RemoteAdService.isAllowedTargetUrl('file:///tmp/a'), false);
  assert.equal(RemoteAdService.isAllowedTargetUrl('javascript:alert(1)'), false);
});
