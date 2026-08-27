import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('meeting DOCX export is wired through IPC, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ipc, /safeHandle\('export-meeting-docx'/);
  assert.match(ipc, /MeetingDocxExportService/);
  assert.match(preload, /exportMeetingDocx:\s*\(meetingId:\s*string,\s*includeTranscript:\s*boolean\)\s*=>\s*\n?\s*ipcRenderer\.invoke\('export-meeting-docx'/);
  assert.match(types, /exportMeetingDocx:\s*\(meetingId:\s*string,\s*includeTranscript:\s*boolean\)/);
});

test('meeting menu offers summary and full-transcript DOCX exports without the PDF generator', () => {
  const launcher = read('src/components/Launcher.tsx');
  const analytics = read('src/lib/analytics/analytics.service.ts');

  assert.match(launcher, /导出会议纪要/);
  assert.match(launcher, /导出会议纪要（含完整转录）/);
  assert.match(launcher, /exportMeetingDocx\(m\.id, false\)/);
  assert.match(launcher, /exportMeetingDocx\(m\.id, true\)/);
  assert.doesNotMatch(launcher, /generateMeetingPDF|trackPdfExported/);
  assert.doesNotMatch(analytics, /trackPdfExported|pdf_exported/);
});
