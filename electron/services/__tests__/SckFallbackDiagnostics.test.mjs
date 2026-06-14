import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('main broadcasts explicit non-terminal warning when SCK ignores selected output route', () => {
  const src = read('electron/main.ts');
  assert.match(src, /maybeBroadcastSckOutputRouteIgnored/);
  assert.match(src, /backend !== 'sck'/);
  assert.match(src, /SCK_OUTPUT_ROUTE_IGNORED/);
  assert.match(src, /routeDiagnostics/);
  assert.match(src, /terminal: false/);
  assert.match(src, /stuck: false/);
});

test('SCK route-ignored warning is checked after system capture start paths', () => {
  const src = read('electron/main.ts');
  assert.match(src, /systemAudioCapture\?\.start\(\);\s*this\.maybeBroadcastSckOutputRouteIgnored\(\);/);
  assert.match(src, /fresh\.start\(\);\s*this\.maybeBroadcastSckOutputRouteIgnored\(fresh\);/);
  assert.match(src, /this\._sckRouteIgnoredBroadcasted = false/);
});

test('audio-capture-failed payload types accept diagnostic code and route diagnostics', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');
  assert.match(preload, /code\?: string/);
  assert.match(preload, /routeDiagnostics\?:/);
  assert.match(types, /code\?: string/);
  assert.match(types, /routeDiagnostics\?:/);
});

test('Rust SCK backend documents that device_id is ignored for non-default outputs', () => {
  const src = read('native-module/src/speaker/sck.rs');
  assert.match(src, /ScreenCaptureKit captures ALL system audio, not per-device/);
  assert.match(src, /ScreenCaptureKit fallback ignores device_id/);
});
