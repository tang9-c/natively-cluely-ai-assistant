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

test('FDE real STT replay is part of the default full test list and validates only FDE audio fixtures', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/run-fde-real-stt-replay.mjs');
  const allRunner = read('scripts/run-test-all.mjs');

  assert.equal(
    pkg.scripts['test:dynamic-actions:fde-replay:real-stt'],
    'npm run build:electron && node scripts/run-fde-real-stt-replay.mjs',
  );
  assert.match(script, /modeTemplateTypes:\s*\[\s*'fde'\s*\]/);
  assert.match(script, /QCLOUD_LIVE_API_KEY|NATIVELY_API_KEY/);
  assert.match(script, /DO NOT print API keys/i);
  assert.doesNotMatch(script, /loadFixtureBackedSttTranscripts/);
  assert.doesNotMatch(script, /FDE_REAL_STT_REPLAY_TESTS/);
  assert.doesNotMatch(script, /SKIP:/);

  assert.match(allRunner, /name: 'fde-real-stt-replay'/);
  const stageStart = allRunner.indexOf("name: 'fde-real-stt-replay'");
  const stageEnd = allRunner.indexOf("name: 'e2e'", stageStart);
  assert.ok(stageStart >= 0 && stageEnd > stageStart, 'fde-real-stt-replay stage should appear before e2e');
  const stageBlock = allRunner.slice(stageStart, stageEnd);
  assert.doesNotMatch(stageBlock, /skipUnless/);
  assert.doesNotMatch(stageBlock, /FDE_REAL_STT_REPLAY_TESTS/);
});
