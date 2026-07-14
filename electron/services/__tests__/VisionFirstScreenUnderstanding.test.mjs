// Vision-first screen understanding service tests.
//
// These are the executable replacement for the retired OCR-first
// ScreenUnderstandingMode/ScreenUnderstandingService suites.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');
const testUserData = path.join(root, '.tmp', 'screen-understanding-test-user-data');
const screenshotDir = path.join(testUserData, 'screenshots');

process.env.NATIVELY_TEST_USER_DATA = testUserData;

let fixturePath;

before(async () => {
  await fs.mkdir(screenshotDir, { recursive: true });
  fixturePath = path.join(screenshotDir, 'screen.png');
  await fs.writeFile(
    fixturePath,
    Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108020000009077' +
        '53DE0000000C4944415478DA6364F800000200010001ACFCC8AF0000000049' +
        '454E44AE426082',
      'hex',
    ),
  );
});

async function loadService() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'ScreenUnderstandingService.js')).href);
  return mod.ScreenUnderstandingService;
}

class FakeOptimizer {
  constructor() {
    this.calls = [];
  }

  async optimize(sourcePath, opts = {}) {
    this.calls.push({ sourcePath, opts });
    const stat = await fs.stat(sourcePath);
    return {
      path: sourcePath,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteSize: stat.size,
      originalWidth: 1,
      originalHeight: 1,
      originalByteSize: stat.size,
      durationMs: 0,
      profile: opts.profile || 'balanced',
      provider: opts.provider || 'generic',
      cacheHit: false,
      ownsFile: false,
    };
  }
}

async function makeService({ hash = 'hash-1' } = {}) {
  const ScreenUnderstandingService = await loadService();
  const optimizer = new FakeOptimizer();
  const service = new ScreenUnderstandingService(optimizer);
  service.imageHashService = {
    computeHash: async () => hash,
    quickHash: async () => hash,
  };
  return { service, optimizer };
}

function baseRequest(overrides = {}) {
  return {
    modeId: 'mode-1',
    modeTemplateType: 'general',
    userAction: 'what_to_say',
    qualityMode: 'balanced',
    imagePaths: [fixturePath],
    transcript: '',
    screenUnderstandingMode: 'vision_first',
    providerPolicy: {
      __providersOverride: [fakeProvider({ id: 'cloud', output: 'Visible project status dashboard' })],
    },
    ...overrides,
  };
}

function fakeProvider(overrides = {}) {
  const calls = [];
  const provider = {
    id: 'fake',
    displayName: 'Fake Vision',
    modelId: 'fake-vision-model',
    isLocal: false,
    isConfigured: true,
    supportsVision: true,
    scopeAllowsScreenshots: true,
    hint: 'generic',
    invoke: async (params) => {
      calls.push(params);
      if (overrides.throwError) throw new Error(overrides.throwError);
      return overrides.output ?? 'Fake vision summary';
    },
    ...overrides,
  };
  provider.calls = calls;
  return provider;
}

test('vision_first returns first successful provider output as vision_extract', async () => {
  const first = fakeProvider({ id: 'first', output: 'The screen shows a pricing dashboard.' });
  const second = fakeProvider({ id: 'second', output: 'should not run' });
  const { service } = await makeService();

  const result = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [first, second] },
  }));

  assert.equal(result.status, 'available');
  assert.equal(result.source, 'vision_extract');
  assert.equal(result.source_kind, 'vision');
  assert.equal(result.providerUsed, 'first');
  assert.equal(result.extractedText, 'The screen shows a pricing dashboard.');
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0);
});

test('vision_first falls back from failed provider to next successful provider', async () => {
  const failing = fakeProvider({ id: 'failing', throwError: '503 provider unavailable' });
  const backup = fakeProvider({ id: 'backup', output: 'Recovered from backup provider.' });
  const { service } = await makeService({ hash: 'hash-fallback' });

  const result = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [failing, backup] },
  }));

  assert.equal(result.status, 'available');
  assert.equal(result.providerUsed, 'backup');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].errorClass, 'provider_error');
  assert.equal(result.attempts[1].ok, true);
});

test('vision_only with no providers returns a clear unavailable result', async () => {
  const { service } = await makeService({ hash: 'hash-no-provider' });

  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'vision_only',
    providerPolicy: { __providersOverride: [] },
  }));

  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'unavailable');
  assert.equal(result.failureReason, 'no_vision_provider');
  assert.match(result.unavailableReason || '', /vision-capable provider/i);
});

test('private_vision blocks cloud providers and succeeds with local provider', async () => {
  const cloud = fakeProvider({ id: 'cloud', isLocal: false, output: 'should not run' });
  const local = fakeProvider({ id: 'ollama', isLocal: true, output: 'Local-only visual summary.' });
  const { service } = await makeService({ hash: 'hash-private-local' });

  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'private_vision',
    providerPolicy: { __providersOverride: [cloud, local] },
  }));

  assert.equal(result.status, 'available');
  assert.equal(result.providerUsed, 'ollama');
  assert.equal(cloud.calls.length, 0);
  assert.equal(local.calls.length, 1);
  assert.equal(result.attempts.find(a => a.provider === 'cloud')?.skipReason, 'privacy_blocked');
});

test('private_vision with only cloud providers fails with privacy_blocked', async () => {
  const cloud = fakeProvider({ id: 'cloud', isLocal: false, output: 'should not run' });
  const { service } = await makeService({ hash: 'hash-private-blocked' });

  const result = await service.understand(baseRequest({
    screenUnderstandingMode: 'private_vision',
    providerPolicy: { __providersOverride: [cloud] },
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'privacy_blocked');
  assert.equal(cloud.calls.length, 0);
});

test('screenshots provider scope blocks path resolution and provider invocation', async () => {
  const provider = fakeProvider({ id: 'cloud', output: 'should not run' });
  const { service, optimizer } = await makeService({ hash: 'hash-scope' });

  const result = await service.understand(baseRequest({
    providerPolicy: {
      allowScreenshots: false,
      __providersOverride: [provider],
    },
  }));

  assert.equal(result.status, 'unavailable');
  assert.equal(result.failureReason, 'scope_blocked');
  assert.equal(provider.calls.length, 0);
  assert.equal(optimizer.calls.length, 0);
  assert.match(result.warnings.join('\n'), /Screenshots disabled/);
});

test('invalid image paths are rejected before provider invocation', async () => {
  const provider = fakeProvider({ id: 'cloud', output: 'should not run' });
  const { service } = await makeService({ hash: 'hash-invalid' });

  const result = await service.understand(baseRequest({
    imagePaths: ['/etc/passwd'],
    providerPolicy: { __providersOverride: [provider] },
  }));

  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'unavailable');
  assert.equal(provider.calls.length, 0);
  assert.ok(result.warnings.some(w => /Invalid image path rejected/.test(w)));
});

test('technical interview requests use technical optimization and vision_direct source', async () => {
  const provider = fakeProvider({ id: 'cloud', output: 'Two Sum coding problem with function twoSum(nums, target) { return []; }' });
  const { service, optimizer } = await makeService({ hash: 'hash-technical' });

  const result = await service.understand(baseRequest({
    modeTemplateType: 'technical-interview',
    userAction: 'code_hint',
    transcript: 'Can you solve the visible coding problem?',
    providerPolicy: { __providersOverride: [provider] },
  }));

  assert.equal(result.source, 'vision_direct');
  assert.equal(result.screenType, 'code');
  assert.equal(result.taskDetected, 'coding_interview');
  assert.equal(optimizer.calls[0].opts.profile, 'technical');
});

test('qualityMode fast and best select matching optimization profiles', async () => {
  const { service: fastService, optimizer: fastOptimizer } = await makeService({ hash: 'hash-fast' });
  await fastService.understand(baseRequest({ qualityMode: 'fast' }));
  assert.equal(fastOptimizer.calls[0].opts.profile, 'fast');

  const { service: bestService, optimizer: bestOptimizer } = await makeService({ hash: 'hash-best' });
  await bestService.understand(baseRequest({ qualityMode: 'best' }));
  assert.equal(bestOptimizer.calls[0].opts.profile, 'best');
});

test('structured JSON output populates extracted fields without OCR', async () => {
  const structured = JSON.stringify({
    visibleSummary: 'A deployment checklist is visible.',
    extractedText: 'Owner: Li. Artifact: validation report.',
    codeBlocks: ['const ready = true;'],
    tables: [{ rows: [['Owner', 'Artifact'], ['Li', 'Report']] }],
    errors: ['TypeError: sample visible error'],
    screenType: 'document',
    taskDetected: 'deployment_review',
    confidence: 0.92,
  });
  const { service } = await makeService({ hash: 'hash-json' });

  const result = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [fakeProvider({ id: 'cloud', output: structured })] },
  }));

  assert.equal(result.visibleSummary, 'A deployment checklist is visible.');
  assert.equal(result.extractedText, 'Owner: Li. Artifact: validation report.');
  assert.deepEqual(result.codeBlocks, ['const ready = true;']);
  assert.equal(result.tables[0].rows[1][1], 'Report');
  assert.equal(result.errors[0], 'TypeError: sample visible error');
  assert.equal(result.screenType, 'document');
  assert.equal(result.taskDetected, 'deployment_review');
  assert.equal(result.confidence, 0.92);
  assert.equal(result.ocrText, result.extractedText);
});

test('plain text output still classifies visible errors', async () => {
  const output = 'Build failed\nTypeError: cannot read property value of undefined';
  const { service } = await makeService({ hash: 'hash-error' });

  const result = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [fakeProvider({ id: 'cloud', output })] },
  }));

  assert.equal(result.screenType, 'error');
  assert.ok(result.errors.some(line => line.includes('TypeError')));
});

test('same image hash reuses cached result and avoids a second provider call', async () => {
  const provider = fakeProvider({ id: 'cloud', output: 'Cached visible summary.' });
  const { service } = await makeService({ hash: 'hash-cache' });

  const first = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [provider] },
  }));
  const second = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [provider] },
  }));

  assert.equal(provider.calls.length, 1);
  assert.equal(second.extractedText, first.extractedText);
  assert.equal(second.imageHash, first.imageHash);
});

test('empty provider output fails with all_vision_failed instead of fabricating context', async () => {
  const { service } = await makeService({ hash: 'hash-empty-output' });

  const result = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [fakeProvider({ id: 'cloud', output: '   ' })] },
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'all_vision_failed');
  assert.equal(result.extractedText, undefined);
});

test('non-vision or unconfigured providers are skipped without invocation', async () => {
  const noVision = fakeProvider({ id: 'text-only', supportsVision: false });
  const notConfigured = fakeProvider({ id: 'missing-key', isConfigured: false });
  const { service } = await makeService({ hash: 'hash-skips' });

  const result = await service.understand(baseRequest({
    providerPolicy: { __providersOverride: [noVision, notConfigured] },
  }));

  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'no_vision_provider');
  assert.equal(noVision.calls.length, 0);
  assert.equal(notConfigured.calls.length, 0);
  assert.equal(result.attempts[0].skipReason, 'no_vision');
  assert.equal(result.attempts[1].skipReason, 'not_configured');
});
