// Regression: very short or empty meetings must not call post-call LLM paths.
// The title-generation call also uses generateMeetingSummary(), so it must be
// gated before any provider request is made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePath = path.join(repoRoot, 'electron/MeetingPersistence.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractProcessAndSaveMeeting() {
  const start = source.indexOf('private async processAndSaveMeeting(');
  if (start < 0) throw new Error('processAndSaveMeeting must exist');
  const end = source.indexOf('\n    /**\n     * Recover meetings', start);
  if (end < 0) throw new Error('processAndSaveMeeting end marker must exist');
  return source.slice(start, end);
}

test('processAndSaveMeeting gates all generateMeetingSummary calls behind transcript length', () => {
  const body = extractProcessAndSaveMeeting();
  const gateIndex = body.indexOf('data.transcript.length > 2');
  const firstLlmIndex = body.indexOf('this.llmHelper.generateMeetingSummary(');

  assert.ok(gateIndex >= 0, 'processAndSaveMeeting must check transcript length');
  assert.ok(firstLlmIndex >= 0, 'processAndSaveMeeting must still generate summaries for valid meetings');
  assert.ok(
    gateIndex < firstLlmIndex,
    'short transcript gate must run before any generateMeetingSummary call, including title generation'
  );
});
