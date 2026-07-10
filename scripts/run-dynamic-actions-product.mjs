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
});

console.log(JSON.stringify({
  totalFixtures: report.totalFixtures,
  recallRate: report.score.recallRate,
  falsePositiveRate: report.score.falsePositiveRate,
  modeScores: report.modeScores,
}, null, 2));

const fde = report.modeScores.fde;
const team = report.modeScores['team-meet'];
if (fde && (fde.recallRate <= 0.75 || fde.falsePositiveRate >= 0.10)) process.exitCode = 1;
if (team && (team.recallRate <= 0.85 || team.falsePositiveRate >= 0.10)) process.exitCode = 1;
