#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const modulePath = path.join(root, 'dist-electron/electron/services/eval/ContextQualityDiagnostics.js');
if (!fs.existsSync(modulePath)) {
  console.error(`Context quality diagnostics build output not found at ${modulePath}; run npm run build:electron first.`);
  process.exit(1);
}
const {
  getContextQualityDiagnosticsCollector,
  summarizeContextQualityDiagnostics,
} = await import(pathToFileURL(modulePath).href);

function readInput() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    return {
      input: getContextQualityDiagnosticsCollector().snapshot(),
      source: 'collector',
      status: 'process_local_snapshot',
      warning: 'No JSON input was provided. The in-memory collector is process-local, so this report only covers data recorded inside this script process.',
    };
  }
  const absolutePath = path.resolve(root, inputPath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return {
    input: JSON.parse(raw),
    source: 'json_file',
    status: 'ok',
  };
}

const reportInput = readInput();
const summary = summarizeContextQualityDiagnostics(reportInput.input);
console.log(JSON.stringify({
  status: reportInput.status,
  source: reportInput.source,
  ...(reportInput.warning ? { warning: reportInput.warning } : {}),
  summary,
}, null, 2));
