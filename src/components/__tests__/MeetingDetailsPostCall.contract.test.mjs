import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(process.cwd(), 'src/components/MeetingDetails.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const databaseSourcePath = path.resolve(process.cwd(), 'electron/db/DatabaseManager.ts');
const databaseSource = fs.readFileSync(databaseSourcePath, 'utf8');

test('MeetingDetails renders FDE decisions and open questions separately', () => {
  assert.match(source, /决策项/);
  assert.match(source, /待确认事项/);
  assert.match(source, /detailedSummary\?\.decisions/);
  assert.match(source, /detailedSummary\?\.openQuestions/);
});

test('MeetingDetails keeps empty coaching and follow-up sections hidden', () => {
  assert.match(source, /visibleCoachingInsights\.length > 0/);
  assert.match(source, /visibleFollowUpDraft/);
});

test('MeetingDetails copy full summary includes post-call enhanced fields', () => {
  const copyBlock = source.slice(source.indexOf('const handleCopy'), source.indexOf('const handleRunTranscriptSkill'));

  assert.match(copyBlock, /detailedSummary\.decisions/);
  assert.match(copyBlock, /detailedSummary\.openQuestions/);
  assert.match(copyBlock, /detailedSummary\.sections/);
  assert.match(copyBlock, /visibleCoachingInsights/);
  assert.match(copyBlock, /visibleFollowUpDraft/);
});

test('MeetingDetails filters legacy English post-call enhancements from saved summaries', () => {
  assert.match(source, /LEGACY_ENGLISH_FOLLOW_UP_PATTERN/);
  assert.match(source, /LEGACY_ENGLISH_COACHING_PATTERN/);
  assert.match(source, /getVisibleCoachingInsights/);
  assert.match(source, /getVisibleFollowUpDraft/);
  assert.doesNotMatch(source, /meeting\.detailedSummary\.coachingInsights\.map\(insight/);
  assert.doesNotMatch(source, /<pre[\s\S]*meeting\.detailedSummary\.followUpDraft/);
});

test('MeetingDetails shows the exact failed cloud summary notice only in the summary tab', () => {
  const summaryTabBlock = source.slice(
    source.indexOf("{activeTab === 'summary' && ("),
    source.indexOf("{activeTab === 'transcript' && ("),
  );

  assert.match(
    summaryTabBlock,
    /meeting\.detailedSummary\?\.generationStatus === 'failed'/,
  );
  assert.match(summaryTabBlock, /云端摘要暂时生成失败，会议转录已保存。/);
});

test('Meeting detailed summary types include the cloud summary generation status', () => {
  const generationStatusType = /generationStatus\?:\s*'success'\s*\|\s*'failed'/;

  assert.match(source, generationStatusType);
  assert.match(databaseSource, generationStatusType);
});
