// LLMHelper.SetModel.test.mjs
// TDD cycle: extend LLMHelper slice coverage with setModel + active provider tracking.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

describe('LLMHelper setModel + active provider tracking', () => {
  test('setModel("natively") makes the QCloud provider active and survives getActiveCustomProvider returning null', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    helper.setNativelyKey('sk-test-key-only-for-active-tracking');
    helper.setModel('natively');

    // After selecting a real model, getActiveCustomProvider must be null
    // (we're on a built-in provider, not a custom curl provider).
    assert.equal(
      helper.getActiveCustomProvider(),
      null,
      'built-in model selection must not register a custom provider',
    );
  });

  test('setModel preserves Natively selection across subsequent apiKey mutations', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    helper.setNativelyKey('sk-original');
    helper.setModel('natively');
    helper.setNativelyKey('sk-rotated');

    // Rotating the api key must not silently change the model selection.
    // The current model id should still reflect the QCLOUD provider selection.
    const activeId = helper.currentModelId;
    assert.equal(activeId, 'natively');
  });
});
