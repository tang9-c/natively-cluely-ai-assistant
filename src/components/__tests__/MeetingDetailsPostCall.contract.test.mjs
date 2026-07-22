import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(process.cwd(), 'src/components/MeetingDetails.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');

test('MeetingDetails renders FDE decisions and open questions separately', () => {
  assert.match(source, /决策项/);
  assert.match(source, /待确认事项/);
  assert.match(source, /detailedSummary\?\.decisions/);
  assert.match(source, /detailedSummary\?\.openQuestions/);
});

test('MeetingDetails keeps empty coaching and follow-up sections hidden', () => {
  assert.match(source, /coachingInsights && meeting\.detailedSummary\.coachingInsights\.length > 0/);
  assert.match(source, /followUpDraft && meeting\.detailedSummary\.followUpDraft\.trim\(\)/);
});

test('MeetingDetails copy full summary includes post-call enhanced fields', () => {
  const copyBlock = source.slice(source.indexOf('const handleCopy'), source.indexOf('const handleRunTranscriptSkill'));

  assert.match(copyBlock, /detailedSummary\.decisions/);
  assert.match(copyBlock, /detailedSummary\.openQuestions/);
  assert.match(copyBlock, /detailedSummary\.sections/);
  assert.match(copyBlock, /detailedSummary\.followUpDraft/);
});
