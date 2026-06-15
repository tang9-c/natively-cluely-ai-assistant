import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('LocalSenseVoiceSTT gates diagnostic logs behind verbose logging', () => {
  const source = read('electron/audio/sensevoice/LocalSenseVoiceSTT.ts');

  assert.match(source, /isVerboseLogging\(\)/);
  assert.match(source, /debugLog\('start'/);
  assert.match(source, /debugLog\('worker-result'/);
  assert.match(source, /textLength: text\.length/);
  assert.match(source, /sampleCount: samples\.length/);
  assert.match(source, /verboseLogging: isVerboseLogging\(\)/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,180}message\.text/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,180}text,/);
});

test('SenseVoice worker logs metadata without transcript text', () => {
  const source = read('electron/audio/sensevoice/senseVoiceWorker.ts');

  assert.match(source, /isVerboseLogging\(\)/);
  assert.match(source, /workerVerboseLogging/);
  assert.match(source, /msg\.verboseLogging/);
  assert.match(source, /debugLog\('transcribe-complete'/);
  assert.match(source, /textLength: text\.length/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,180}result\?\.text/);
  assert.doesNotMatch(source, /console\.log[\s\S]{0,180}text,/);
});
