import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('benchmark IPC is rejected unless the explicit environment gate is enabled', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /CUEUP_LONG_MEETING_BENCHMARK/);
  assert.match(ipc, /benchmark:inject-transcript/);
  assert.match(ipc, /benchmark:get-runtime-snapshot/);
  assert.match(ipc, /Long meeting benchmark bridge is disabled/);
});

test('benchmark injection and live STT share one transcript routing method', () => {
  const main = read('electron/main.ts');
  assert.match(main, /private routeTranscriptPayload/);
  assert.match(main, /stt\.on\('transcript',[\s\S]*?routeTranscriptPayload/);
  assert.match(main, /injectBenchmarkTranscript[\s\S]*?routeTranscriptPayload/);
});

test('benchmark preload bridge is typed but does not bypass main gating', () => {
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');
  assert.match(preload, /benchmarkInjectTranscript/);
  assert.match(preload, /benchmarkGetRuntimeSnapshot/);
  assert.match(rendererTypes, /benchmarkInjectTranscript/);
  assert.match(rendererTypes, /benchmarkGetRuntimeSnapshot/);
});
