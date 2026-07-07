import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('DynamicActionCard renders product contract copy instead of diagnostic internals', () => {
  const source = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(source, /productContract\.userAction/);
  assert.match(source, /productContract\.whyNow/);
  assert.match(source, /productContract\.outputPromise/);
  assert.match(source, /productContract\.evidenceSummary/);
  assert.match(source, /ctaLabelForOutputType/);
  assert.doesNotMatch(source, /confidencePct/);
  assert.doesNotMatch(source, /explainDynamicAction\(/);
  assert.doesNotMatch(source, /语义证据不足，已暂缓高风险动作|相似的低置信候选已被拦截/);
  assert.doesNotMatch(source, /semantic gate|provider|Triggered by|triggered by/);
});
