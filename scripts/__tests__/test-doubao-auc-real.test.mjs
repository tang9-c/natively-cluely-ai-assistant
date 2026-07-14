import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Doubao AUC real request script is wired for default full-test execution', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/test-doubao-auc-real.mjs');
  const allRunner = read('scripts/run-test-all.mjs');

  assert.equal(
    pkg.scripts['test:doubao-auc:real'],
    'node scripts/test-doubao-auc-real.mjs',
  );
  assert.match(allRunner, /name: 'doubao-auc-real'/);
  assert.doesNotMatch(allRunner, /DOUBAO_AUC_REAL_TESTS/);
  assert.match(script, /DOUBAO_AUC_API_KEY/);
  assert.match(script, /process\.env\.DOUBAO_AUC_API_KEY/);
  assert.match(script, /process\.env\.DOUBAO_API_KEY/);
  assert.match(script, /enable_speaker_info:\s*true/);
  assert.match(script, /ssd_version:\s*'200'/);
  assert.match(script, /show_utterances:\s*true/);
  assert.match(script, /volc\.seedasr\.auc/);
  assert.match(script, /45000010/);
  assert.match(script, /Invalid X-Api-Key/);
  assert.match(script, /AUC-enabled key/);
  assert.match(script, /DO NOT print API keys/i);
  assert.match(script, /npm run test:all runs this script by default/);
});
