import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('generate-what-to-say resolves business system context before realtime context plan', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /BusinessSystemContextService/);
  assert.match(handler, /businessSystemResult/);
  assert.match(handler, /contextCandidates\.push\(businessSystemResult\.candidate\)/);
  assert.ok(
    handler.indexOf('BusinessSystemContextService') < handler.indexOf('buildRealtimeContextPlan'),
    'business system context should be resolved before context plan is built'
  );
});

test('generate-what-to-say short-circuits fixed business system failures without LLM', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /businessSystemResult\.kind === 'fixed_reply'/);
  assert.match(handler, /statusCode:\s*'business-system-unavailable'/);
  assert.ok(
    handler.indexOf("businessSystemResult.kind === 'fixed_reply'") < handler.indexOf('runWhatShouldISay'),
    'fixed business system failures must return before LLM generation'
  );
});

test('generate-what-to-say uses canonical business system degraded reason helper for fixed replies', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /businessSystemDegradedReasonForStatus/);
  assert.match(handler, /const businessSystemDegradedReason\s*=/);
  assert.doesNotMatch(handler, /degradedReason:\s*`business_system_\$\{businessSystemResult\.status\}`/);
});
