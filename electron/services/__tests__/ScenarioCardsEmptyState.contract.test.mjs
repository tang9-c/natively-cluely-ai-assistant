import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('reference-materials empty state is a clickable upload entry', () => {
  const source = read('src/components/profile/cards/ReferenceMaterialsCard.tsx');

  assert.doesNotMatch(source, />\s*暂无资料\s*</);
  assert.match(source, /documents\.length === 0 \? \(\s*<button/s);
  assert.match(source, /onClick=\{\(\) => onUpload\(card\.docSubtype\)\}/);
  assert.match(source, /添加场景资料/);
  assert.match(source, /正在加入资料\.\.\./);
});
