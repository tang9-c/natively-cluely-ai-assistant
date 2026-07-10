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

test('product fixtures include sales, FDE, team-meet, and recruiting schema fields', async () => {
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
  assert.equal(counts.recruiting, 5);
});

test('product runner writes JSON and Markdown reports', async () => {
  const { runDynamicActionProductFixtures } = await load();
  const outDir = path.join(process.cwd(), 'reports/dynamic-actions-test');
  fs.rmSync(outDir, { recursive: true, force: true });
  const report = await runDynamicActionProductFixtures({
    fixtureDir: path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product'),
    outputDir: outDir,
  });
  assert.equal(report.totalFixtures, 125);
  assert.ok(fs.existsSync(path.join(outDir, 'product-report.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'product-report.md')));
  assert.equal(typeof report.score.recallRate, 'number');
  assert.equal(typeof report.score.falsePositiveRate, 'number');
});

test('product runner records invalid fixture files without dropping valid files', async () => {
  const { runDynamicActionProductFixtures } = await load();
  const fixtureDir = fs.mkdtempSync(path.join(process.cwd(), 'reports/dynamic-actions-bad-fixture-'));
  const outputDir = fs.mkdtempSync(path.join(process.cwd(), 'reports/dynamic-actions-bad-output-'));
  fs.writeFileSync(
    path.join(fixtureDir, 'sales.json'),
    JSON.stringify([
      {
        id: 'sales-valid',
        modeTemplateType: 'sales',
        language: 'en',
        transcriptTurns: [{ speaker: 'Customer', text: 'This is too expensive for our budget.' }],
        expected: { shouldEmit: true, actionType: 'pricing_objection', outputType: 'spoken_response' },
      },
    ]),
    'utf8',
  );
  fs.writeFileSync(path.join(fixtureDir, 'fde.json'), '{bad json', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'team-meet.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'recruiting.json'), '[]', 'utf8');

  const report = await runDynamicActionProductFixtures({ fixtureDir, outputDir });

  assert.equal(report.totalFixtures, 1);
  assert.equal(report.invalidFixtures.length, 1);
  assert.match(report.invalidFixtures[0].file, /fde\.json$/);
  assert.ok(fs.existsSync(path.join(outputDir, 'product-report.json')));
});
