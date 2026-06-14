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

test('BaseSTT exposes async drainFinals hook that preserves the existing grace wait', () => {
  const src = read('electron/audio/BaseSTT.ts');
  assert.match(src, /drainFinals\(timeoutMs\?: number\): Promise<void>/);
  assert.match(src, /this\.finalize\(\)/);
  assert.match(src, /setTimeout\(resolve, timeoutMs\)/);
});

test('LocalWhisperSTT implements bounded drainFinals for pending final tasks', () => {
  const src = read('electron/audio/LocalWhisperSTT.ts');
  assert.match(src, /async drainFinals\(timeoutMs: number = 5000\): Promise<void>/);
  assert.match(src, /this\.isDrainingFinals = true/);
  assert.match(src, /this\.finalize\(\)/);
  assert.match(src, /this\.pendingAudio\.length === 0/);
  assert.match(src, /this\.drainingFinalsInFlight === 0/);
  assert.match(src, /Date\.now\(\) - started >= timeoutMs/);
});

test('main endMeeting drains STT providers before stopMeeting snapshot', () => {
  const src = read('electron/main.ts');
  const drainIdx = src.indexOf('await this.drainSttFinalsForMeetingStop()');
  const snapshotIdx = src.indexOf('const meetingId = await this.intelligenceManager.stopMeeting()');
  assert.ok(drainIdx > 0, 'endMeeting should call drainSttFinalsForMeetingStop');
  assert.ok(snapshotIdx > drainIdx, 'meeting snapshot must happen after STT drain');
  assert.doesNotMatch(src, /Grace window for STT trailing finals[\s\S]{0,300}setTimeout\(resolve, 250\)/);
});
