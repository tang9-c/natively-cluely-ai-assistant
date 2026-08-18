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

test('non-Windows automatic state does not alter existing interactive behavior', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();

  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(
      resolveOverlayMouseInteractionPolicy({
        platform,
        manualPassthrough: false,
        automaticInteractive: false,
      }),
      { ignoreMouseEvents: false, forward: false },
    );
  }
});
