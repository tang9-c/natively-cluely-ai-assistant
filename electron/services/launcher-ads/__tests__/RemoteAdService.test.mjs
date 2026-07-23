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

// I1: CUEUP_LAUNCHER_ADS_URL must be https://. The https guard is
// implemented inside defaultDependencies() which is the production wiring
// invoked by RemoteAdService's parameterless constructor. We cannot invoke
// that factory directly under ELECTRON_RUN_AS_NODE because it touches
// Electron's `app`, so we verify the gate by importing and exercising the
// shared isHttpsUrl helper — the same one defaultDependencies uses to
// decide whether to forward the configUrl.
test('I1: isHttpsUrl rejects http and non-URL values; accepts https', async () => {
  const { isHttpsUrl } = await import('../../../../dist-electron/electron/services/launcher-ads/RemoteAdValidator.js');
  assert.equal(isHttpsUrl('https://config.example.com/launcher-ads.json'), true);
  assert.equal(isHttpsUrl('http://config.example.com/launcher-ads.json'), false);
  assert.equal(isHttpsUrl('ftp://config.example.com/x.json'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl('cueup://launcher-ad/default'), false);
  assert.equal(isHttpsUrl('not a url'), false);
  assert.equal(isHttpsUrl(null), false);
  assert.equal(isHttpsUrl(undefined), false);
  assert.equal(isHttpsUrl(42), false);
});

// I1 follow-through: a service constructed with the same http-guard logic
// in its deps (mirroring the production defaultDependencies gate) must
// treat configUrl as empty, never invoke fetchJson, and return the
// builtin ad.
test('I1: service with http configUrl treated as empty returns builtin without fetchJson', async () => {
  let fetchJsonCalls = 0;
  const httpConfigUrl = 'http://config.example.com/launcher-ads.json';
  // Mirror the production gate: empty string when not https.
  const gatedDeps = {
    configUrl: (await import('../../../../dist-electron/electron/services/launcher-ads/RemoteAdValidator.js'))
      .isHttpsUrl(httpConfigUrl) ? httpConfigUrl : '',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => null,
    writeCache: () => {},
    fetchJson: async () => { fetchJsonCalls += 1; return validConfig; },
  };
  assert.equal(gatedDeps.configUrl, '', 'http URL must be gated to empty');
  const service = new RemoteAdService(gatedDeps);
  const ads = await service.getAds();
  assert.equal(fetchJsonCalls, 0, 'fetchJson must not be called');
  assert.equal(ads.length, 1);
  assert.equal(ads[0].builtin, true);
});

// I2: fetchJson rejection paths must not propagate to the IPC layer. The
// service catches every error from fetchJson and falls back to stale cache
// or the builtin ad. We exercise each rejection path by injecting a
// mock fetchJson that mirrors the production rejection modes, then
// verify the service returns the builtin ad without throwing.
test('I2: 5xx fetchJson rejection falls back to builtin without throwing', async () => {
  const writes = [];
  const service = new RemoteAdService({
    configUrl: 'https://config.example.com/launcher-ads.json',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => null,
    writeCache: (value) => writes.push(value),
    fetchJson: async () => { throw new Error('HTTP 503'); },
  });
  const ads = await service.getAds();
  assert.equal(ads.length, 1);
  assert.equal(ads[0].builtin, true);
  assert.equal(writes.length, 0, 'no cache write on fetch error');
});

test('I2: non-JSON body fetchJson rejection falls back to builtin', async () => {
  const writes = [];
  const service = new RemoteAdService({
    configUrl: 'https://config.example.com/launcher-ads.json',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => null,
    writeCache: (value) => writes.push(value),
    fetchJson: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
  });
  const ads = await service.getAds();
  assert.equal(ads.length, 1);
  assert.equal(ads[0].builtin, true);
  assert.equal(writes.length, 0);
});

test('I2: oversized content-length rejection falls back to builtin', async () => {
  const writes = [];
  const service = new RemoteAdService({
    configUrl: 'https://config.example.com/launcher-ads.json',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => null,
    writeCache: (value) => writes.push(value),
    fetchJson: async () => { throw new Error('response too large'); },
  });
  const ads = await service.getAds();
  assert.equal(ads.length, 1);
  assert.equal(ads[0].builtin, true);
  assert.equal(writes.length, 0);
});

test('I2: oversized body rejection falls back to builtin', async () => {
  const writes = [];
  const service = new RemoteAdService({
    configUrl: 'https://config.example.com/launcher-ads.json',
    now: () => new Date('2026-07-22T12:00:00Z'),
    readCache: () => null,
    writeCache: (value) => writes.push(value),
    fetchJson: async () => { throw new Error('response too large'); },
  });
  const ads = await service.getAds();
  assert.equal(ads.length, 1);
  assert.equal(ads[0].builtin, true);
  assert.equal(writes.length, 0);
});

