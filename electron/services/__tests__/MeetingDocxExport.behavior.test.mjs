import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const servicePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/MeetingDocxExportService.js',
);

function loadService() {
  delete require.cache[servicePath];
  return require(servicePath);
}

async function documentXml(buffer) {
  const JSZip = require('jszip');
  const archive = await JSZip.loadAsync(buffer);
  const entry = archive.file('word/document.xml');
  assert.ok(entry, 'DOCX should contain word/document.xml');
  return entry.async('string');
}

const meeting = {
  id: 'meeting-docx-1',
  title: '客户需求评审 / 方案确认',
  date: '2026-08-27T09:30:00.000Z',
  duration: '42:18',
  summary: 'See detailed summary',
  detailedSummary: {
    overview: '客户确认先完成接口验证，再进入正式部署。',
    keyPoints: ['现有系统需要兼容中文字段。'],
    decisions: ['采用分阶段上线。'],
    actionItems: ['准备接口清单。'],
    actionItemsStructured: [{
      id: 'action-1',
      text: '准备接口清单',
      owner: '张三',
      deadline: '2026-08-30',
      sourceTimestamp: 755_000,
    }],
    openQuestions: ['生产环境开放时间待确认。'],
    sections: [{ title: '销售推进', bullets: ['下周安排技术澄清会。'] }],
    followUpDraft: '感谢今天的沟通，附件为接口清单。',
    coachingInsights: [{
      id: 'coach-1',
      type: 'next_step',
      title: '明确下一步',
      detail: '结束前再次确认负责人和日期。',
      severity: 'opportunity',
    }],
    generationStatus: 'success',
  },
  transcript: [{
    speaker: 'interviewer',
    text: '这段转录只应出现在完整档案中。',
    timestamp: 10_000,
    speakerIdentityCorrection: { isMe: true, source: 'user', correctedAt: 20_000 },
  }],
  usage: [{ type: 'chat', timestamp: 1, question: '隐藏问题', answer: '隐藏回答' }],
};

test('summary DOCX contains detailed summary sections without transcript or AI usage', async () => {
  const { buildMeetingDocxBuffer } = loadService();
  const xml = await documentXml(await buildMeetingDocxBuffer(meeting, { includeTranscript: false }));

  for (const expected of [
    '会议概述',
    '客户确认先完成接口验证，再进入正式部署。',
    '关键要点',
    '决策项',
    '行动项',
    '准备接口清单',
    '负责人：张三',
    '截止日期：2026-08-30',
    '来源：12:35',
    '待确认事项',
    '销售推进',
    '跟进草稿',
    '辅导建议',
  ]) {
    assert.match(xml, new RegExp(expected));
  }

  assert.doesNotMatch(xml, /See detailed summary/);
  assert.doesNotMatch(xml, /这段转录只应出现在完整档案中/);
  assert.doesNotMatch(xml, /隐藏问题|隐藏回答|AI 使用记录/);
  assert.equal((xml.match(/准备接口清单/g) || []).length, 1, 'structured actions should not be duplicated');
});

test('full DOCX adds a transcript appendix and respects speaker correction', async () => {
  const { buildMeetingDocxBuffer } = loadService();
  const xml = await documentXml(await buildMeetingDocxBuffer(meeting, { includeTranscript: true }));

  assert.match(xml, /完整转录/);
  assert.match(xml, /我 \[00:10\]/);
  assert.match(xml, /这段转录只应出现在完整档案中/);
});

test('legacy summary is exportable while placeholder-only meetings are rejected', async () => {
  const { buildMeetingDocxBuffer, hasExportableMeetingSummary } = loadService();
  const legacyMeeting = { ...meeting, summary: '旧版有效摘要', detailedSummary: undefined };
  const pendingMeeting = {
    ...meeting,
    summary: 'Generating summary...',
    detailedSummary: { actionItems: [], keyPoints: [] },
  };

  assert.equal(hasExportableMeetingSummary(legacyMeeting), true);
  assert.match(await documentXml(await buildMeetingDocxBuffer(legacyMeeting, { includeTranscript: false })), /旧版有效摘要/);
  assert.equal(hasExportableMeetingSummary(pendingMeeting), false);
  await assert.rejects(
    () => buildMeetingDocxBuffer(pendingMeeting, { includeTranscript: false }),
    /summary_not_ready/,
  );
});

test('DOCX filenames are safe on Windows and distinguish transcript exports', () => {
  const { safeDocxFilename } = loadService();

  assert.equal(safeDocxFilename('客户/方案:*?评审', false), '客户_方案_评审-会议纪要.docx');
  assert.equal(safeDocxFilename('客户/方案:*?评审', true), '客户_方案_评审-完整会议档案.docx');
  assert.equal(safeDocxFilename('CON', false), 'CON_-会议纪要.docx');
});

test('DOCX chooses a native Chinese font for each desktop platform', () => {
  const { resolveDocxFont } = loadService();

  assert.equal(resolveDocxFont('darwin'), 'Arial Unicode MS');
  assert.equal(resolveDocxFont('win32'), 'Microsoft YaHei');
  assert.equal(resolveDocxFont('linux'), 'Noto Sans CJK SC');
});
