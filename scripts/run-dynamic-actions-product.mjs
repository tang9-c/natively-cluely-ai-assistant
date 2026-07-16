import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/qa/DynamicActionFixtureRunner.js'),
).href;
const { runDynamicActionProductFixtures } = await import(moduleUrl);

const report = await runDynamicActionProductFixtures({
  fixtureDir: path.join(root, 'tests/fixtures/dynamic-actions/product'),
  outputDir: path.join(root, 'reports/dynamic-actions'),
  semanticGateMode: 'fixture_oracle',
});

console.log(JSON.stringify({
  totalFixtures: report.totalFixtures,
  semanticGateMode: 'fixture_oracle',
  recallRate: report.score.recallRate,
  falsePositiveRate: report.score.falsePositiveRate,
  modeScores: report.modeScores,
}, null, 2));

const failures = [];

function addScoreFailures(label, score) {
  if (!score) return;
  if (score.recallNumerator !== score.recallDenominator) {
    failures.push(`${label}: recall ${score.recallNumerator}/${score.recallDenominator}`);
  }
  if (score.falsePositiveNumerator !== 0) {
    failures.push(`${label}: false positives ${score.falsePositiveNumerator}/${score.falsePositiveDenominator}`);
  }
  for (const fixtureId of score.answerQualityFailures ?? []) {
    failures.push(`${label}: answer quality failed ${fixtureId}`);
  }
  for (const fixtureId of score.groundingFailures ?? []) {
    failures.push(`${label}: grounding failed ${fixtureId}`);
  }
  for (const fixtureId of score.missingFieldFailures ?? []) {
    failures.push(`${label}: missing field failed ${fixtureId}`);
  }
}

addScoreFailures('all', report.score);
for (const [mode, score] of Object.entries(report.modeScores)) {
  addScoreFailures(mode, score);
}
for (const invalid of report.invalidFixtures ?? []) {
  failures.push(`invalid fixture ${invalid.file}${invalid.fixtureId ? `:${invalid.fixtureId}` : ''}: ${invalid.error}`);
}

if (failures.length > 0) {
  console.error(`Dynamic action product quality gate failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
