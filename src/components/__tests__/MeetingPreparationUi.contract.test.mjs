import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const launcher = fs.readFileSync('src/components/Launcher.tsx', 'utf8');
const entryPath = 'src/components/meeting-preparation/MeetingPreparationEntryCard.tsx';
const pagePath = 'src/components/meeting-preparation/MeetingPreparationPage.tsx';
const entry = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '';
const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';

test('Launcher keeps primary actions and exposes B plus B3', () => {
  assert.match(launcher, /启动 CueUp/);
  assert.match(launcher, /launcher-ad-carousel/);
  assert.match(entry, /meeting-preparation-entry/);
  assert.match(page, /描述会议/);
  assert.match(page, /确认信息与模式/);
  assert.match(page, /查看准备结果/);
  assert.match(page, /onOpenResearch/);
  assert.doesNotMatch(page, /profileResearchCompany|meeting-preparation-research-/);
});

test('starting a prepared meeting passes no preparation payload', () => {
  assert.match(page, /meetingPreparationApplyMode\(record\.id\)/);
  assert.match(page, /await onStartMeeting\(\)/);
  assert.doesNotMatch(page, /onStartMeeting\([^)]*(questions|citations|evidence|result)/);
});

test('manual questions remain addable after AI generated three questions', () => {
  assert.match(page, /<Plus size=\{13\} \/>添加问题/);
  assert.doesNotMatch(page, /disabled=\{isLocked \|\| record\.questions\.length >= 3\}/);
  assert.doesNotMatch(page, /record\.questions\.length >= 3/);
  assert.doesNotMatch(page, /已达 3 个上限/);
});
