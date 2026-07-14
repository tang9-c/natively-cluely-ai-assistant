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

test('Sales and team-meet real STT replay scripts are wired as blocked-capable stages', () => {
  const pkg = JSON.parse(read('package.json'));
  const salesScript = read('scripts/run-sales-real-stt-replay.mjs');
  const teamScript = read('scripts/run-team-meet-real-stt-replay.mjs');
  const replayLib = read('scripts/dynamic-action-real-stt-replay-lib.mjs');
  const allRunner = read('scripts/run-test-all.mjs');

  assert.equal(
    pkg.scripts['test:dynamic-actions:sales-replay:real-stt'],
    'npm run build:electron && node scripts/run-sales-real-stt-replay.mjs',
  );
  assert.equal(
    pkg.scripts['test:dynamic-actions:team-meet-replay:real-stt'],
    'npm run build:electron && node scripts/run-team-meet-real-stt-replay.mjs',
  );
  assert.match(salesScript, /modeTemplateType:\s*'sales'/);
  assert.match(teamScript, /modeTemplateType:\s*'team-meet'/);
  assert.match(salesScript, /DO NOT print API keys/i);
  assert.match(teamScript, /DO NOT print API keys/i);
  assert.match(replayLib, /assetCoverageFailures/);
  assert.match(replayLib, /Missing required real audio assets/);
  assert.match(replayLib, /process\.exit\(1\)/);

  for (const stageName of ['sales-real-stt-replay', 'team-meet-real-stt-replay']) {
    const stageStart = allRunner.indexOf(`name: '${stageName}'`);
    const stageEnd = allRunner.indexOf("name: 'e2e'", stageStart);
    assert.ok(stageStart >= 0 && stageEnd > stageStart, `${stageName} stage should appear before e2e`);
    assert.match(allRunner.slice(stageStart, stageEnd), /blockedOnMissingEnv/);
  }
});
