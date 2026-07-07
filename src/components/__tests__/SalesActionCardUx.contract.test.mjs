import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('sales product contract exposes user-facing action promises for the card', () => {
  const source = read('electron/services/dynamic-actions/DynamicActionProductContract.ts');

  assert.match(source, /回应价格异议/);
  assert.match(source, /生成后续邮件草稿/);
  assert.match(source, /生成一封可发送的邮件草稿/);
  assert.match(source, /(锁定下一步|推进下一步)/);
  assert.doesNotMatch(source, /Handle pricing objection/);
});
