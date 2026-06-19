import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../main.ts');
const source = fs.readFileSync(mainPath, 'utf8');
const endMeetingStart = source.indexOf('public async endMeeting');
const endMeetingEnd = source.indexOf('private async processCompletedMeetingForRAG', endMeetingStart);
const endMeetingSource = source.slice(endMeetingStart, endMeetingEnd);

test('endMeeting always clears draining state after background teardown', () => {
  assert.ok(endMeetingStart >= 0, 'endMeeting should exist');
  assert.ok(endMeetingEnd > endMeetingStart, 'endMeeting source should be isolated');

  const finallyIndex = endMeetingSource.indexOf('} finally {');
  const clearIndex = endMeetingSource.indexOf('this._isDraining = false;', finallyIndex);

  assert.ok(finallyIndex >= 0, 'background teardown should have a finally block');
  assert.ok(clearIndex > finallyIndex, '_isDraining must be cleared inside finally');
});

test('endMeeting keeps draining enabled during STT grace window', () => {
  // The original implementation blocked endMeeting with a synchronous 250 ms
  // setTimeout so trailing STT finals could arrive. That has since been
  // rewritten as an async IIFE on `_pendingTeardown` so endMeeting returns
  // ~1 ms after Stop click and the renderer can paint the launcher
  // immediately. The semantic guarantee — `_isDraining` stays true while the
  // STT drain runs — is preserved by setting `_isDraining = true;` up front
  // and clearing it only inside the IIFE's `finally` block (asserted by the
  // previous test). Here we verify the draining flag is set before the
  // background teardown that performs the actual STT drain.
  assert.match(
    endMeetingSource,
    /this\._isDraining = true;[\s\S]*this\._pendingTeardown = \(async[\s\S]*drainSttFinalsForMeetingStop/,
  );
});
