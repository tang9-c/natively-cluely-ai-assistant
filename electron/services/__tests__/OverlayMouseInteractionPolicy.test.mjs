import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

const modulePath = path.resolve(
  import.meta.dirname,
  '../../../dist-electron/shared/overlayMouseInteractionPolicy.js',
);

async function loadPolicy() {
  return import(modulePath);
}

test('Windows transparent area passes through until the pointer reaches CueUp UI', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();

  assert.deepEqual(
    resolveOverlayMouseInteractionPolicy({
      platform: 'win32',
      manualPassthrough: false,
      automaticInteractive: false,
    }),
    { ignoreMouseEvents: true, forward: true },
  );
  assert.deepEqual(
    resolveOverlayMouseInteractionPolicy({
      platform: 'win32',
      manualPassthrough: false,
      automaticInteractive: true,
    }),
    { ignoreMouseEvents: false, forward: false },
  );
});

test('automatic hit testing is supported on Windows and macOS only', async () => {
  const { supportsOverlayAutomaticHitTesting } = await loadPolicy();

  assert.equal(supportsOverlayAutomaticHitTesting('win32'), true);
  assert.equal(supportsOverlayAutomaticHitTesting('darwin'), true);
  assert.equal(supportsOverlayAutomaticHitTesting('linux'), false);
});

test('macOS transparent area passes through while visible CueUp UI stays interactive', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();

  assert.deepEqual(
    resolveOverlayMouseInteractionPolicy({
      platform: 'darwin',
      manualPassthrough: false,
      automaticInteractive: false,
    }),
    { ignoreMouseEvents: true, forward: true },
  );
  assert.deepEqual(
    resolveOverlayMouseInteractionPolicy({
      platform: 'darwin',
      manualPassthrough: false,
      automaticInteractive: true,
    }),
    { ignoreMouseEvents: false, forward: false },
  );
});

test('manual passthrough overrides automatic interactivity on every platform', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();

  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepEqual(
      resolveOverlayMouseInteractionPolicy({
        platform,
        manualPassthrough: true,
        automaticInteractive: true,
      }),
      { ignoreMouseEvents: true, forward: true },
    );
  }
});

test('unsupported platforms ignore automatic hit-testing state', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();

  assert.deepEqual(
    resolveOverlayMouseInteractionPolicy({
      platform: 'linux',
      manualPassthrough: false,
      automaticInteractive: false,
    }),
    { ignoreMouseEvents: false, forward: false },
  );
});
