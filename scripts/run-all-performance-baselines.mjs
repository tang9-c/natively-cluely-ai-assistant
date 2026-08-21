#!/usr/bin/env node

import 'dotenv/config';

import {
  OrchestratorError,
  parseOrchestratorArgs,
  runAllPerformanceBaselines,
} from './lib/performanceBaselineOrchestrator.mjs';

const abortController = new AbortController();
const interrupt = () => abortController.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

try {
  const result = await runAllPerformanceBaselines(parseOrchestratorArgs(process.argv.slice(2)), {
    signal: abortController.signal,
  });
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof OrchestratorError ? error.code : 'orchestrator_unexpected_failure'}\n`);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
