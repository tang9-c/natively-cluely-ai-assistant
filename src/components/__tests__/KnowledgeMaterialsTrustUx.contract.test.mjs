import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('knowledge material settings uses trust view model and honest failed-material action', () => {
  const source = read('src/components/settings/KnowledgeMaterialsSettings.tsx');
  const types = read('src/types/electron.d.ts');

  assert.match(source, /explainMaterialStatus/);
  assert.match(source, /重新上传新文件/);
  assert.match(source, /onClick=\{uploadMaterials\}/);
  assert.match(source, /canReindex/);
  assert.match(source, /primaryActionLabel/);
  assert.match(source, /未配置语义检索/);
  assert.match(source, /语义索引失败/);
  assert.doesNotMatch(source, /title=\{canReindex \? '重新索引' : '仅已完成资料可重新索引'\}/);

  assert.match(types, /error_code\?: string \| null/);
  assert.match(types, /errorCode\?: string \| null/);
});
