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

test('replay manifest has sales, FDE, team-meet, and recruiting generated audio assets and runner skips execution phase', async () => {
  const { runDynamicActionReplay } = await load();
  const manifestPath = path.join(process.cwd(), 'tests/fixtures/dynamic-actions/replay/replay-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.length >= 9);
  assert.equal(manifest.filter((entry) => entry.modeTemplateType === 'recruiting').length, 3);
  for (const entry of manifest) {
    assert.equal(entry.expectedMissingAudio, false);
    assert.ok(fs.existsSync(path.join(process.cwd(), entry.audioPath)), `${entry.audioPath} should exist`);
  }

  const outputDir = path.join(process.cwd(), 'reports/dynamic-actions-replay-test');
  fs.rmSync(outputDir, { recursive: true, force: true });
  const report = await runDynamicActionReplay({
    manifestPath,
    outputDir,
  });
  assert.ok(report.totalEntries >= 6);
  assert.equal(report.failedEntries, 0);
  assert.equal(report.skippedEntries, report.totalEntries);
  assert.equal(report.entries[0].reason, 'audio_replay_not_enabled_in_this_phase');
  assert.equal(report.environmentStatus, 'not_applicable');
  assert.deepEqual(report.assetCoverage.requiredReal, { sales: 15, fde: 10, 'team-meet': 5 });
  assert.equal(report.assetCoverage.availableSynthetic.sales, 4);
  assert.equal(report.assetCoverage.availableSynthetic.fde, 2);
  assert.equal(report.assetCoverage.availableSynthetic['team-meet'], 1);
  assert.equal(report.assetCoverage.availableReal.sales, 0);
  assert.equal(report.assetCoverage.blockedReal.sales, 15);
  assert.equal(report.assetCoverage.blockedReal.fde, 10);
  assert.equal(report.assetCoverage.blockedReal['team-meet'], 5);
  assert.ok(fs.existsSync(path.join(outputDir, 'replay-report.json')));
});

test('recruiting audio replay runs through STT output and dynamic action detection', async () => {
  const { runDynamicActionReplay, loadFixtureBackedSttTranscripts } = await load();
  const manifestPath = path.join(process.cwd(), 'tests/fixtures/dynamic-actions/replay/replay-manifest.json');
  const outputDir = path.join(process.cwd(), 'reports/dynamic-actions-recruiting-replay-test');
  fs.rmSync(outputDir, { recursive: true, force: true });

  const sttTranscripts = loadFixtureBackedSttTranscripts({
    manifestPath,
    fixtureRoot: path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product'),
  });
  const audioInputs = [];
  const report = await runDynamicActionReplay({
    manifestPath,
    outputDir,
    audioRoot: process.cwd(),
    modeTemplateTypes: ['recruiting'],
    transcribeAudio: async ({ entry, audioPath }) => {
      audioInputs.push({ id: entry.id, audioPath });
      return sttTranscripts.get(entry.id);
    },
  });

  assert.equal(report.totalEntries, 3);
  assert.equal(report.skippedEntries, 0);
  assert.equal(report.failedEntries, 0);
  assert.equal(report.environmentStatus, 'ok');
  assert.equal(audioInputs.length, 3);
  assert.ok(audioInputs.every((input) => input.audioPath.endsWith('.wav')));

  const byId = new Map(report.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('recruiting-replay-candidate-concern-zh-001')?.status, 'passed');
  assert.equal(byId.get('recruiting-replay-candidate-concern-zh-001')?.actionType, 'candidate_concern');
  assert.equal(byId.get('recruiting-replay-experience-probe-en-001')?.status, 'passed');
  assert.equal(byId.get('recruiting-replay-experience-probe-en-001')?.actionType, 'candidate_experience_probe');
  assert.equal(byId.get('recruiting-replay-identity-mismatch-mixed-001')?.status, 'passed');
  assert.equal(byId.get('recruiting-replay-identity-mismatch-mixed-001')?.emitted, false);
});

test('sales audio replay runs through STT output and dynamic action detection', async () => {
  const { runDynamicActionReplay, loadFixtureBackedSttTranscripts } = await load();
  const manifestPath = path.join(process.cwd(), 'tests/fixtures/dynamic-actions/replay/replay-manifest.json');
  const outputDir = path.join(process.cwd(), 'reports/dynamic-actions-sales-replay-test');
  fs.rmSync(outputDir, { recursive: true, force: true });

  const sttTranscripts = loadFixtureBackedSttTranscripts({
    manifestPath,
    fixtureRoot: path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product'),
  });
  const audioInputs = [];
  const report = await runDynamicActionReplay({
    manifestPath,
    outputDir,
    audioRoot: process.cwd(),
    modeTemplateTypes: ['sales'],
    transcribeAudio: async ({ entry, audioPath }) => {
      audioInputs.push({ id: entry.id, audioPath });
      if (entry.id === 'sales-replay-internal-price-identity-001') {
        return 'Internal teammate says our price list is too high in the draft but this is internal prep not the customer speaking 客户说，这个先不谈 pricing 我们要看 integration plan。S O 和 A P I 怎么接？ Expected behavior avoid a pricing objection card and focus on technical requirements';
      }
      return sttTranscripts.get(entry.id);
    },
  });

  assert.equal(report.totalEntries, 4);
  assert.equal(report.skippedEntries, 0);
  assert.equal(report.failedEntries, 0);
  assert.equal(audioInputs.length, 4);
  assert.ok(audioInputs.every((input) => input.audioPath.endsWith('.wav')));

  const byId = new Map(report.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('sales-replay-pricing-objection-zh-001')?.status, 'passed');
  assert.equal(byId.get('sales-replay-pricing-objection-zh-001')?.actionType, 'pricing_objection');
  assert.equal(byId.get('sales-replay-case-proof-mixed-001')?.status, 'passed');
  assert.equal(byId.get('sales-replay-case-proof-mixed-001')?.actionType, 'case_study_request');
  assert.equal(byId.get('sales-replay-case-proof-mixed-001')?.continuation?.derivedActionEmitted, true);
  assert.equal(byId.get('sales-replay-capability-fit-mixed-001')?.status, 'passed');
  assert.equal(byId.get('sales-replay-capability-fit-mixed-001')?.actionType, 'case_study_request');
  assert.equal(byId.get('sales-replay-capability-fit-mixed-001')?.continuation?.visibleAnswerKind, 'generated');
  assert.equal(byId.get('sales-replay-internal-price-identity-001')?.status, 'passed');
  assert.equal(byId.get('sales-replay-internal-price-identity-001')?.emitted, false);
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
    const report = await runDynamicActionReplay({
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
