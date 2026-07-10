#!/usr/bin/env node
/**
 * Sales dynamic-action replay through real STT.
 *
 * DO NOT print API keys.
 */

import { runRealSttReplay } from './dynamic-action-real-stt-replay-lib.mjs';

await runRealSttReplay({
  label: 'sales',
  scriptName: 'test:dynamic-actions:sales-replay:real-stt',
  modeTemplateType: 'sales',
  outputDirName: 'dynamic-actions-sales-real-stt',
});
