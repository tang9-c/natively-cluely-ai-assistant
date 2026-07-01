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

test('meeting echo diagnostics compare mic/system transcripts without logging raw text', () => {
  const main = read('electron/main.ts');

  assert.match(main, /logMeetingEchoDiagnostics\(speaker, segment\.text, segment\.isFinal, receivedAt\)/);
  assert.match(main, /recordMeetingAudioPeak\('interviewer', sttChunk, now\)/);
  assert.match(main, /recordMeetingAudioPeak\('user', chunk, now\)/);
  assert.match(main, /sameWindow = absDeltaMs != null && absDeltaMs <= 2500/);
  assert.match(main, /textSimilarity/);
  assert.match(main, /audioPeak/);
  assert.match(main, /counterpartAudioPeak/);

  const logCall = main.match(
    /console\.log\('\[Main\]\[EchoDiag\] meeting transcript channel comparison', \{[\s\S]*?\n\s*\}\);/
  );
  assert.ok(logCall, 'Echo diagnostics should log a structured object');
  assert.doesNotMatch(logCall[0], /\btext\s*:/, 'Echo diagnostics must not log raw transcript text');
  assert.doesNotMatch(logCall[0], /\bnormalizedText\s*:/, 'Echo diagnostics must not log normalized transcript text');
});
