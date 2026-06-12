// SessionTrackerUserInterimFlush.test.mjs
//
// Regression: when the user (mic) speaker has an unfinalized interim transcript
// at stop-meeting time, stopMeeting() → session.flushInterimTranscript() must
// promote that interim segment to final and persist it, otherwise the user's
// last utterance is silently dropped from the saved meeting.
//
// The interviewer path already has this protection via lastInterimInterviewer.
// The user path did not — handleTranscript() (line ~316-320) only logs user
// segments and never caches the latest interim, so flushInterimTranscript()
// has no field to flush.
//
// These tests pin the behavior in the source so a regression is loud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../SessionTracker.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

test('SessionTracker caches the latest interim USER segment (mirror of interviewer path)', () => {
  // Must declare a field analogous to lastInterimInterviewer
  assert.match(
    source,
    /private\s+lastInterimUser\s*:\s*TranscriptSegment\s*\|\s*null\s*=\s*null\s*;?/,
    'SessionTracker must declare a lastInterimUser field so the user speaker has the same interim caching as interviewer'
  );
});

test('handleTranscript caches interim user segments to lastInterimUser', () => {
  // Extract the handleTranscript method body
  const start = source.indexOf('handleTranscript(segment: TranscriptSegment):');
  assert.ok(start >= 0, 'handleTranscript method must exist');
  // Find the next top-level method or end of class
  const nextMethod = source.indexOf('\n    public ', start + 1);
  const end = nextMethod >= 0 ? nextMethod : source.length;
  const body = source.slice(start, end);

  // In the speaker === 'user' branch, when segment.final is false,
  // it must write to this.lastInterimUser. Today the branch is a log-only stub.
  assert.match(
    body,
    /if\s*\(\s*segment\.speaker\s*===\s*['"]user['"]\s*\)\s*\{[\s\S]{0,400}lastInterimUser/,
    "handleTranscript's user branch must write non-final segments to this.lastInterimUser (mirroring the interviewer branch's lastInterimInterviewer assignment)"
  );

  // And the final segment must clear it
  assert.match(
    body,
    /else\s*\{[\s\S]{0,200}lastInterimUser\s*=\s*null/,
    "handleTranscript's user branch must clear this.lastInterimUser on a final segment (mirror of lastInterimInterviewer)"
  );
});

test('flushInterimTranscript promotes BOTH interviewer and user interim segments', () => {
  const start = source.indexOf('flushInterimTranscript(): void');
  assert.ok(start >= 0, 'flushInterimTranscript method must exist');
  const nextMethod = source.indexOf('\n    public ', start + 1);
  const end = nextMethod >= 0 ? nextMethod : source.length;
  const body = source.slice(start, end);

  // Must check lastInterimInterviewer (existing)
  assert.match(body, /lastInterimInterviewer/);
  // Must check lastInterimUser (new)
  assert.match(
    body,
    /lastInterimUser/,
    'flushInterimTranscript must also flush lastInterimUser, not just lastInterimInterviewer'
  );
  // And must null BOTH at the end
  const nullInterviewer = body.match(/lastInterimInterviewer\s*=\s*null/g) || [];
  const nullUser = body.match(/lastInterimUser\s*=\s*null/g) || [];
  assert.ok(nullInterviewer.length >= 1, 'must null out lastInterimInterviewer after flush');
  assert.ok(nullUser.length >= 1, 'must null out lastInterimUser after flush');
});
