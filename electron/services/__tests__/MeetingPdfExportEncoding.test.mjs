import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('meeting PDF export renders through browser fonts so Chinese text is not written with Helvetica encoding', () => {
  const source = read('src/utils/pdfGenerator.ts');

  assert.match(source, /import html2canvas from 'html2canvas'/);
  assert.match(source, /html2canvas\(pages\[index\]/);
  assert.match(source, /doc\.addImage\(/);
  assert.match(source, /"PingFang SC"/);
  assert.match(source, /"Microsoft YaHei"/);
  assert.doesNotMatch(source, /setFont\(['"]helvetica['"]/);
  assert.doesNotMatch(source, /\[\^a-z0-9\]/i);
});

test('meeting list export awaits PDF generation failures instead of dropping async errors', () => {
  const source = read('src/components/Launcher.tsx');

  assert.match(source, /await generateMeetingPDF\(fullMeeting\)/);
  assert.match(source, /await generateMeetingPDF\(m\)/);
});

test('meeting PDF export labels transcript speakers using persisted manual corrections', () => {
  const source = read('src/utils/pdfGenerator.ts');
  assert.match(source, /resolveEffectiveSpeaker/);
  assert.match(source, /resolveEffectiveSpeaker\(entry\) === 'user'/);
});
