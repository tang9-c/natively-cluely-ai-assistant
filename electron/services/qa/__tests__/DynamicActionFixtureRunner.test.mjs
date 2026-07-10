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

test('product runner reports per-mode quality gates', async () => {
  const { runDynamicActionProductFixtures } = await load();
  const outDir = path.join(process.cwd(), 'reports/dynamic-actions-mode-score-test');
  fs.rmSync(outDir, { recursive: true, force: true });

  const report = await runDynamicActionProductFixtures({
    fixtureDir: path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product'),
    outputDir: outDir,
  });

  assert.ok(report.modeScores.sales);
  assert.ok(report.modeScores.fde);
  assert.ok(report.modeScores['team-meet']);
  assert.equal(typeof report.modeScores.fde.recallRate, 'number');
  assert.equal(typeof report.modeScores['team-meet'].falsePositiveRate, 'number');
});

test('product runner marks assessSignals as the default runner mode', async () => {
  const { runDynamicActionProductFixtures } = await load();
  const fixtureDir = fs.mkdtempSync(path.join(process.cwd(), 'reports/dynamic-actions-assess-fixtures-'));
  const outputDir = fs.mkdtempSync(path.join(process.cwd(), 'reports/dynamic-actions-assess-output-'));
  fs.writeFileSync(path.join(fixtureDir, 'sales.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'fde.json'), JSON.stringify([{
    id: 'fde-assess-default',
    modeTemplateType: 'fde',
    language: 'zh',
    transcriptTurns: [{ speaker: 'customer', text: '我们要确认 ECO 审批权限和验证产物。' }],
    expected: { shouldEmit: true, actionType: 'fde_integration_check' },
  }]), 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'team-meet.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'recruiting.json'), '[]', 'utf8');

  const report = await runDynamicActionProductFixtures({ fixtureDir, outputDir });
  assert.equal(report.results[0].runnerMode, 'assessSignals');
});

test('product runner validates accepted output through artifact builder', async () => {
  const { runDynamicActionProductFixtures } = await load();
  const fixtureDir = fs.mkdtempSync(path.join(process.cwd(), 'reports/dynamic-actions-accepted-fixtures-'));
  const outputDir = fs.mkdtempSync(path.join(process.cwd(), 'reports/dynamic-actions-accepted-output-'));
  fs.writeFileSync(path.join(fixtureDir, 'sales.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'fde.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'recruiting.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'team-meet.json'), JSON.stringify([{
    id: 'team-accepted-path-test',
    modeTemplateType: 'team-meet',
    language: 'mixed',
    transcriptTurns: [{ speaker: 'teammate', text: 'Maya 负责发布 checklist，周五前发出来。' }],
    assessment: { runnerMode: 'regex' },
    expected: {
      shouldEmit: true,
      actionType: 'action_item',
      acceptedAnswer: 'Owner: Maya\nDeliverable: 发布 checklist\nDue: 周五',
      acceptedMissingFields: [],
      acceptedGroundedSources: [{ type: 'transcript', status: 'used' }],
    },
  }]), 'utf8');

  const report = await runDynamicActionProductFixtures({ fixtureDir, outputDir });
  const [entry] = report.results;
  assert.equal(entry.acceptedPathPassed, true);
  assert.equal(entry.acceptedArtifact.actionType, 'action_item');
  assert.deepEqual(entry.acceptedOutputFailures, []);
  assert.deepEqual(entry.groundingFailures, []);
  assert.deepEqual(entry.missingFieldFailures, []);
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
