#!/usr/bin/env node
/**
 * Recruiting dynamic-action replay through real STT.
 *
 * DO NOT print API keys.
 */

import { runRealSttReplay } from './dynamic-action-real-stt-replay-lib.mjs';

await runRealSttReplay({
  label: 'recruiting',
  scriptName: 'test:dynamic-actions:recruiting-replay:real-stt',
  modeTemplateType: 'recruiting',
  outputDirName: 'dynamic-actions-recruiting-real-stt',
  semanticGateMode: process.env.RECRUITING_REAL_SEMANTIC_GATE === '1'
    ? 'real'
    : 'fixture_oracle',
});
