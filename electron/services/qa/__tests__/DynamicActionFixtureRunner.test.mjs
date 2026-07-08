import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), 'dist-electron/electron/services/qa/DynamicActionFixtureRunner.js'),
).href;

async function load() {
  return import(moduleUrl);
}

test('product fixtures have exact Step 5 counts and existing schema fields', async () => {
  const { loadProductFixtures } = await load();
  const fixtures = loadProductFixtures(path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product'));
  const counts = fixtures.reduce((acc, fixture) => {
    acc[fixture.modeTemplateType] = (acc[fixture.modeTemplateType] ?? 0) + 1;
    assert.ok(Array.isArray(fixture.transcriptTurns));
    assert.equal(typeof fixture.expected.shouldEmit, 'boolean');
    assert.equal('mode' in fixture, false);
    assert.equal('expectedActions' in fixture, false);
    return acc;
  }, {});
  assert.equal(counts.sales, 50);
  assert.equal(counts.fde, 40);
  assert.equal(counts['team-meet'], 30);
});

test('product runner writes JSON and Markdown reports', async () => {
  const { runDynamicActionProductFixtures } = await load();
  const outDir = path.join(process.cwd(), 'reports/dynamic-actions-test');
  fs.rmSync(outDir, { recursive: true, force: true });
  const report = await runDynamicActionProductFixtures({
    fixtureDir: path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product'),
    outputDir: outDir,
  });
  assert.equal(report.totalFixtures, 120);
  assert.ok(fs.existsSync(path.join(outDir, 'product-report.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'product-report.md')));
  assert.equal(typeof report.score.recallRate, 'number');
  assert.equal(typeof report.score.falsePositiveRate, 'number');
});
