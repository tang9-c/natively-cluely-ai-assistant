import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'scripts/assert-dynamic-action-report-privacy.mjs'),
).href;

const SENTINELS = {
  transcript: 'PRIVATE_TRANSCRIPT_SENTINEL_7F91',
  evidence: 'PRIVATE_EVIDENCE_SENTINEL_2A44',
  providerBody: 'PRIVATE_PROVIDER_BODY_SENTINEL_9C10',
  apiKey: 'sk_TEST_ONLY_1234567890ABCDEF',
};

async function load() {
  return import(moduleUrl);
}

test('privacy assertion accepts aggregate-only reports', async () => {
  const { assertDynamicActionReportPrivacy } = await load();
  assert.doesNotThrow(() => assertDynamicActionReportPrivacy({
    reports: [{
      entries: [{
        id: 'safe',
        continuation: {
          fixtureId: 'safe',
          derivedActionEmitted: true,
          parentActionId: 'parent',
          childActionId: 'child',
          evidenceCount: 1,
        },
      }],
    }],
    fixtures: [{ turns: [{ text: SENTINELS.transcript }], generatedAnswer: SENTINELS.evidence }],
  }));
});

test('privacy assertion rejects nested prompt keys', async () => {
  const { assertDynamicActionReportPrivacy } = await load();
  assert.throws(() => assertDynamicActionReportPrivacy({
    reports: [{ nested: { prompt: 'do not store me' } }],
    fixtures: [],
  }), /privacy_forbidden_key/);
});

test('privacy assertion rejects fixture turn text leaked into report values', async () => {
  const { assertDynamicActionReportPrivacy } = await load();
  assert.throws(() => assertDynamicActionReportPrivacy({
    reports: [{ value: SENTINELS.transcript }],
    fixtures: [{ turns: [{ text: SENTINELS.transcript }] }],
  }), /privacy_fixture_content_leaked/);
});

test('privacy assertion rejects evidence excerpt leakage', async () => {
  const { assertDynamicActionReportPrivacy } = await load();
  assert.throws(() => assertDynamicActionReportPrivacy({
    reports: [{ usage: { excerpt: SENTINELS.evidence } }],
    fixtures: [{ generatedAnswer: SENTINELS.evidence }],
  }), /privacy_forbidden_key/);
});

test('privacy assertion rejects provider body and credential patterns', async () => {
  const { assertDynamicActionReportPrivacy } = await load();
  assert.throws(() => assertDynamicActionReportPrivacy({
    reports: [{ provider: { providerBody: SENTINELS.providerBody } }],
    fixtures: [],
  }), /privacy_forbidden_key/);
  assert.throws(() => assertDynamicActionReportPrivacy({
    reports: [{ token: SENTINELS.apiKey }],
    fixtures: [],
  }), /privacy_credential_pattern/);
});
