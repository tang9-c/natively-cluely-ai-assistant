#!/usr/bin/env node
/**
 * FDE dynamic-action replay through real STT.
 *
 * DO NOT print API keys.
 */

import { runRealSttReplay } from './dynamic-action-real-stt-replay-lib.mjs';

await runRealSttReplay({
  label: 'FDE',
  scriptName: 'test:dynamic-actions:fde-replay:real-stt',
  modeTemplateType: 'fde',
  outputDirName: 'dynamic-actions-fde-real-stt',
});
