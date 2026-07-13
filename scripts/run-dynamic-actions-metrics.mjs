import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const reportDir = process.env.DYNAMIC_ACTIONS_REPORT_DIR
  ? path.resolve(process.env.DYNAMIC_ACTIONS_REPORT_DIR)
  : path.join(root, 'reports/dynamic-actions');
const telemetryPath = process.env.DYNAMIC_ACTIONS_TELEMETRY_PATH
  ? path.resolve(process.env.DYNAMIC_ACTIONS_TELEMETRY_PATH)
  : path.join(reportDir, 'telemetry.jsonl');

const moduleUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/qa/DynamicActionMetricsAggregator.js'),
).href;
const {
  aggregateDynamicActionQaMetrics,
  parseTelemetryJsonlLines,
} = await import(moduleUrl);

function readRequiredJson(fileName) {
  const filePath = path.join(reportDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required dynamic action QA report: ${filePath}. Run test:dynamic-actions:product and test:dynamic-actions:replay first.`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readOptionalTelemetry() {
  if (!fs.existsSync(telemetryPath)) {
    return { records: [], warnings: [`Optional telemetry JSONL missing: ${telemetryPath}`] };
  }
  return parseTelemetryJsonlLines(fs.readFileSync(telemetryPath, 'utf8'));
}

try {
  const productReport = readRequiredJson('product-report.json');
  const replayReport = readRequiredJson('replay-report.json');
  const telemetry = readOptionalTelemetry();
  const summary = aggregateDynamicActionQaMetrics({
    telemetryRecords: telemetry.records,
    fixtureResults: Array.isArray(productReport.results) ? productReport.results : [],
    replayReport,
    answerQualityMetrics: null,
  });

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, 'metrics-report.json'), JSON.stringify({
    ...summary,
    warnings: telemetry.warnings,
  }, null, 2));
  console.log(JSON.stringify({
    reportDir,
    modes: Object.keys(summary.modeQuality),
    actionTypes: Object.keys(summary.falsePositiveMissByAction),
    environmentStatus: summary.environmentStatus,
    continuationGateFailures: summary.continuationGateFailures,
    warnings: telemetry.warnings,
  }, null, 2));
  if (summary.continuationGateFailures.length > 0) {
    console.error(`Dynamic action continuation quality gate failed: ${summary.continuationGateFailures.join(',')}`);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
