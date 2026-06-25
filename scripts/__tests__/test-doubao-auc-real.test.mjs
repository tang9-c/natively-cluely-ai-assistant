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

test('manual Doubao AUC real request script is opt-in and outside full test discovery', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/test-doubao-auc-real.mjs');

  assert.equal(
    pkg.scripts['test:doubao-auc:real'],
    'node scripts/test-doubao-auc-real.mjs',
  );
  assert.match(script, /DOUBAO_API_KEY/);
  assert.match(script, /enable_speaker_info:\s*true/);
  assert.match(script, /ssd_version:\s*'200'/);
  assert.match(script, /show_utterances:\s*true/);
  assert.match(script, /volc\.seedasr\.auc/);
  assert.match(script, /DO NOT print API keys/i);
});
