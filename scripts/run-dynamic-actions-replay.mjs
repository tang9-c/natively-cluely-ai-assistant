import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/qa/DynamicActionReplayRunner.js'),
).href;
const { runDynamicActionReplay } = await import(moduleUrl);

const report = runDynamicActionReplay({
  manifestPath: path.join(root, 'tests/fixtures/dynamic-actions/replay/replay-manifest.json'),
  outputDir: path.join(root, 'reports/dynamic-actions'),
  audioRoot: root,
});

console.log(JSON.stringify(report, null, 2));
if (report.failedEntries > 0) process.exit(1);
