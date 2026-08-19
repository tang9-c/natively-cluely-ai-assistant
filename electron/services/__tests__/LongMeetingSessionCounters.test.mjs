import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('session and intelligence runtime APIs expose counts only', () => {
  const session = read('electron/SessionTracker.ts');
  const manager = read('electron/IntelligenceManager.ts');
  assert.match(session, /getRuntimeCounts\(\)/);
  assert.match(session, /fullSegments:\s*this\.fullTranscript\.length/);
  assert.match(session, /epochSummaries:\s*this\.transcriptEpochSummaries\.length/);
  assert.doesNotMatch(session.match(/getRuntimeCounts\(\)[\s\S]*?\n\s*\}/)?.[0] ?? '', /transcript:\s*this\.fullTranscript/);
  assert.match(manager, /getRuntimeCounts\(\)/);
  assert.match(manager, /actionCandidates/);
  assert.match(manager, /shownCards/);
});

test('SenseVoice runtime API exposes bounded counts without samples', () => {
  const source = read('electron/audio/sensevoice/LocalSenseVoiceSTT.ts');
  const method = source.match(/getRuntimeStats\(\)[\s\S]*?\n\s*\}/)?.[0] ?? '';
  assert.match(method, /active:\s*this\._isActive/);
  assert.match(method, /pendingAudio:\s*this\.pendingAudio\.length/);
  assert.match(method, /inFlightAudio:\s*this\.pendingAudioByTaskId\.size/);
  assert.doesNotMatch(method, /samples/);
});
