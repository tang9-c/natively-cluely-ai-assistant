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
}, null, 2));
