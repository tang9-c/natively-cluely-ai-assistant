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

test('Recruiting real STT replay is part of the default full test list and validates only recruiting audio fixtures', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/run-recruiting-real-stt-replay.mjs');
  const allRunner = read('scripts/run-test-all.mjs');

  assert.equal(
    pkg.scripts['test:dynamic-actions:recruiting-replay:real-stt'],
    'npm run build:electron && node scripts/run-recruiting-real-stt-replay.mjs',
  );
  assert.match(script, /modeTemplateTypes:\s*\[\s*'recruiting'\s*\]/);
  assert.match(script, /QCLOUD_LIVE_API_KEY|NATIVELY_API_KEY/);
  assert.match(script, /DO NOT print API keys/i);
  assert.doesNotMatch(script, /loadFixtureBackedSttTranscripts/);
  assert.doesNotMatch(script, /SKIP:/);

  assert.match(allRunner, /name: 'recruiting-real-stt-replay'/);
  const stageStart = allRunner.indexOf("name: 'recruiting-real-stt-replay'");
  const stageEnd = allRunner.indexOf("name: 'e2e'", stageStart);
  assert.ok(stageStart >= 0 && stageEnd > stageStart, 'recruiting-real-stt-replay stage should appear before e2e');
  const stageBlock = allRunner.slice(stageStart, stageEnd);
  assert.doesNotMatch(stageBlock, /skipUnless/);
});
