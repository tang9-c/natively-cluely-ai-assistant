import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/qa/DynamicActionReplayRunner.js'),
).href;
const { loadFixtureBackedSttTranscripts, runDynamicActionReplay } = await import(moduleUrl);

const manifestPath = path.join(root, 'tests/fixtures/dynamic-actions/replay/replay-manifest.json');
const sttTranscripts = loadFixtureBackedSttTranscripts({
  manifestPath,
  fixtureRoot: path.join(root, 'tests/fixtures/dynamic-actions/product'),
});

const report = await runDynamicActionReplay({
  manifestPath,
  outputDir: path.join(root, 'reports/dynamic-actions'),
  audioRoot: root,
  semanticGateMode: 'fixture_oracle',
  transcribeAudio: async ({ entry }) => sttTranscripts.get(entry.id),
});

console.log(JSON.stringify(report, null, 2));
if (report.failedEntries > 0) process.exit(1);
