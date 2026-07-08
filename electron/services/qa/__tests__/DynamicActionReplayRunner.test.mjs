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
