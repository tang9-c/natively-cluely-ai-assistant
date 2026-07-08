import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/electron/services/qa/DynamicActionReplayRunner.js'),
).href;

async function load() {
  return import(moduleUrl);
}

test('replay runner marks missing audio as expected skipped', async () => {
  const { runDynamicActionReplay } = await load();
  const outputDir = path.join(process.cwd(), 'reports/dynamic-actions-replay-test');
  fs.rmSync(outputDir, { recursive: true, force: true });
  const report = runDynamicActionReplay({
    manifestPath: path.join(process.cwd(), 'tests/fixtures/dynamic-actions/replay/replay-manifest.json'),
    outputDir,
  });
  assert.ok(report.totalEntries >= 1);
  assert.equal(report.failedEntries, 0);
  assert.equal(report.skippedEntries, report.totalEntries);
  assert.ok(fs.existsSync(path.join(outputDir, 'replay-report.json')));
});

test('replay runner resolves audio paths from explicit audio root', async () => {
  const { runDynamicActionReplay } = await load();
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'reports/dynamic-actions-replay-root-'));
  const audioRoot = path.join(dir, 'audio');
  fs.mkdirSync(audioRoot, { recursive: true });
  fs.writeFileSync(path.join(audioRoot, 'sample.wav'), 'fake audio', 'utf8');
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify([
      {
        id: 'sample',
        modeTemplateType: 'sales',
        sourceFixture: 'sales-valid',
        audioPath: 'sample.wav',
        expectedMissingAudio: false,
        language: 'en',
        speakerCount: 1,
      },
    ]),
    'utf8',
  );

  const originalCwd = process.cwd();
  try {
    process.chdir(path.dirname(dir));
    const report = runDynamicActionReplay({
      manifestPath,
      outputDir: path.join(dir, 'out'),
      audioRoot,
    });
    assert.equal(report.failedEntries, 0);
    assert.equal(report.entries[0].reason, 'audio_replay_not_enabled_in_this_phase');
  } finally {
    process.chdir(originalCwd);
  }
});
