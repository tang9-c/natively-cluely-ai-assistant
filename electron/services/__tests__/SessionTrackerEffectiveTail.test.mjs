import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('effective transcript tail applies speaker overrides only to the requested tail', async () => {
  const trackerPath = path.join(root, 'dist-electron/electron/SessionTracker.js');
  const { SessionTracker } = await import(pathToFileURL(trackerPath).href);
  const tracker = new SessionTracker();

  for (let index = 0; index < 30; index += 1) {
    tracker.addTranscript({
      speaker: index % 2 === 0 ? 'interviewer' : 'user',
      text: `turn-${index}`,
      timestamp: index,
      final: true,
    });
  }

  let overrideCalls = 0;
  const originalApplyOverride = tracker.applySpeakerVerificationOverride.bind(tracker);
  tracker.applySpeakerVerificationOverride = (segment) => {
    overrideCalls += 1;
    return originalApplyOverride(segment);
  };

  const tail = tracker.getEffectiveTranscriptTail(12);

  assert.equal(overrideCalls, 12);
  assert.deepEqual(tail.map((segment) => segment.text),
    Array.from({ length: 12 }, (_, index) => `turn-${index + 18}`));
});

test('skill watcher uses the bounded effective transcript tail API', () => {
  const source = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');

  assert.match(source, /this\.session\.getEffectiveTranscriptTail\(12\)/);
  assert.doesNotMatch(source, /getEffectiveFullTranscript\(\)\.slice\(-12\)/);
});
