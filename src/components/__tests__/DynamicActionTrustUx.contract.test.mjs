import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('DynamicActionCard renders trust explanation through view model', () => {
  const source = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(source, /explainDynamicAction/);
  assert.match(source, /actionTrustExplanation/);
  assert.match(source, /actionTrustExplanation\.message/);
  assert.doesNotMatch(source, /语义证据不足，已暂缓高风险动作|相似的低置信候选已被拦截/);
});
