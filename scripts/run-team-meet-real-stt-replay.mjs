#!/usr/bin/env node
/**
 * Team meeting dynamic-action replay through real STT.
 *
 * DO NOT print API keys.
 */

import { runRealSttReplay } from './dynamic-action-real-stt-replay-lib.mjs';

await runRealSttReplay({
  label: 'team-meet',
  scriptName: 'test:dynamic-actions:team-meet-replay:real-stt',
  modeTemplateType: 'team-meet',
  outputDirName: 'dynamic-actions-team-meet-real-stt',
});
