import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const modulePath = path.join(root, 'dist-electron/shared/dynamicActionAvailability.js');

test('maps semantic arbitration to privacy-safe renderer availability events', () => {
  assert.ok(fs.existsSync(modulePath), 'dynamic action availability module should be built');
  const {
    dynamicActionAvailabilityFromArbitration,
    dynamicActionAvailabilityFromArbitrations,
  } = require(modulePath);

  assert.deepEqual(
    dynamicActionAvailabilityFromArbitration('cloud_unavailable', 10),
    { status: 'cloud_unavailable', reason: 'cloud_unavailable', observedAt: 10 },
  );
  assert.deepEqual(
    dynamicActionAvailabilityFromArbitration('local_fallback_cloud_unavailable', 11),
    { status: 'local_fallback', reason: 'local_fallback_cloud_unavailable', observedAt: 11 },
  );
  assert.deepEqual(
    dynamicActionAvailabilityFromArbitration('cloud_used', 12),
    { status: 'available', reason: 'cloud_recovered', observedAt: 12 },
  );
  assert.equal(dynamicActionAvailabilityFromArbitration('local_only_by_privacy', 13), null);
  assert.equal(dynamicActionAvailabilityFromArbitration('local_only_not_needed', 14), null);

  assert.deepEqual(
    dynamicActionAvailabilityFromArbitrations(['cloud_unavailable', 'cloud_used'], 20),
    { status: 'cloud_unavailable', reason: 'cloud_unavailable', observedAt: 20 },
    'a successful candidate must not hide another unavailable candidate from the same assessment',
  );
  assert.deepEqual(
    dynamicActionAvailabilityFromArbitrations(
      ['cloud_used', 'local_fallback_cloud_unavailable'],
      21,
    ),
    {
      status: 'local_fallback',
      reason: 'local_fallback_cloud_unavailable',
      observedAt: 21,
    },
  );
  assert.deepEqual(
    dynamicActionAvailabilityFromArbitrations(
      ['local_only_not_needed', 'cloud_used'],
      22,
    ),
    { status: 'available', reason: 'cloud_recovered', observedAt: 22 },
  );
  assert.equal(
    dynamicActionAvailabilityFromArbitrations(
      ['local_only_by_privacy', 'local_only_not_needed'],
      23,
    ),
    null,
  );
});
