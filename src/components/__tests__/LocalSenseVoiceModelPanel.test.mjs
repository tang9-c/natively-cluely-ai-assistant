import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('LocalSenseVoiceModelPanel exposes term correction controls', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/LocalSenseVoiceModelPanel.tsx'), 'utf8');

  assert.match(source, /localSenseVoiceGetTerms/);
  assert.match(source, /localSenseVoiceSetTerms/);
  assert.match(source, /correctionEnabled/);
  assert.match(source, /variants/);
  assert.match(source, /termCorrectionDialogOpen/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /管理词表/);
  assert.match(source, /已启用 · \$\{terms\.length\} 条词条/);
  assert.match(source, /下次转写会话生效/);
  assert.match(source, /未填写常见误识别，不会生效/);
  assert.match(source, /Math\.random\(\)\.toString\(36\)/);
  assert.doesNotMatch(source, /localSenseVoiceSuggestTerms/);
  assert.doesNotMatch(source, /homophoneReplacerEnabled/);
  assert.doesNotMatch(source, /vadProfile/);
});
