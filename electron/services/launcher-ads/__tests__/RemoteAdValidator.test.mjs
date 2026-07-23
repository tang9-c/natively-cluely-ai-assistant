import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  validateRemoteAdConfig,
} from '../../../../dist-electron/electron/services/launcher-ads/RemoteAdValidator.js';

test('validates, filters, deduplicates, sorts, and limits ads', () => {
  const now = new Date('2026-07-22T12:00:00Z');
  const ads = Array.from({ length: 12 }, (_, index) => ({
    id: `ad-${index}`,
    imageUrl: `https://cdn.example.com/${index}.webp`,
    targetUrl: `https://example.com/${index}`,
    alt: `广告 ${index}`,
    priority: index,
  }));

  const result = validateRemoteAdConfig({
    version: 1,
    ads: [
      ...ads,
      { id: 'http-image', imageUrl: 'http://example.com/a.png', alt: 'bad' },
      { id: 'expired', imageUrl: 'https://example.com/e.png', alt: 'expired', endsAt: '2026-07-22T11:59:59Z' },
      { id: 'future', imageUrl: 'https://example.com/f.png', alt: 'future', startsAt: '2026-07-22T12:00:01Z' },
      { id: 'ad-11', imageUrl: 'https://example.com/duplicate.png', alt: 'duplicate', priority: 999 },
    ],
  }, now);

  assert.equal(result.length, 10);
  assert.deepEqual(result.map((ad) => ad.id), [
    'ad-11', 'ad-10', 'ad-9', 'ad-8', 'ad-7',
    'ad-6', 'ad-5', 'ad-4', 'ad-3', 'ad-2',
  ]);
});

test('rejects unsupported config versions and unsafe target protocols', () => {
  assert.deepEqual(validateRemoteAdConfig({ version: 2, ads: [] }, new Date()), []);
  assert.deepEqual(validateRemoteAdConfig({
    version: 1,
    ads: [{
      id: 'unsafe',
      imageUrl: 'https://cdn.example.com/a.webp',
      targetUrl: 'javascript:alert(1)',
      alt: 'unsafe',
    }],
  }, new Date()), []);
});