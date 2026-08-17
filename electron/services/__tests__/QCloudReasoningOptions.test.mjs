import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const policyPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/llm/QCloudRequestPolicy.js',
);

function loadPolicy() {
  delete require.cache[policyPath];
  return require(policyPath);
}

test('QCLOUD omits reasoning effort when thinking is disabled', () => {
  const { resolveQCloudReasoningEffort } = loadPolicy();

  assert.equal(
    resolveQCloudReasoningEffort({ type: 'disabled' }, 'medium'),
    undefined,
  );
});

test('QCLOUD preserves reasoning effort when thinking is enabled', () => {
  const { resolveQCloudReasoningEffort } = loadPolicy();

  assert.equal(
    resolveQCloudReasoningEffort({ type: 'enabled' }, 'minimal'),
    'minimal',
  );
});
