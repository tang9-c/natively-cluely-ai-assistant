import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url);
const source = fs.readFileSync('src/components/MeetingDetails.tsx', 'utf8');
const tree = ts.createSourceFile('details.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let result;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.getText(tree); ts.forEachChild(node, visit); }
  visit(tree); assert.ok(result, `production declaration ${name}`); return `const ${result};`;
}
const derivations = source.slice(source.indexOf('    const visibleTranscriptRows ='), source.indexOf('    const visibleCoachingInsights ='));
// Run the actual detail-page derivations with the same dependency caching as React.
const entry = `import{createMeetingAutosave}from './src/hooks/useMeetingAutosave';
import{resolveSpeakerIdentity}from './shared/speakerIdentity';import{buildVisibleTranscriptRows}from './shared/transcriptVirtualization';
${declaration('formatTime')}${declaration('formatTranscriptForSkill')}
let slots=[],cursor=0;function useMemo(fn,deps){const i=cursor++;if(!slots[i]||!deps.every((d,j)=>Object.is(d,slots[i].deps[j])))slots[i]={deps,value:fn()};return slots[i].value;}
export function derive(meeting,activeTab){cursor=0;${derivations}return{visibleTranscriptRows,canRunTranscriptSkill};}export{createMeetingAutosave};
export function skillRunner(controller, api){const window={electronAPI:api};const transcriptMarkdown='stale render text';const setSkillExportStatus=()=>{},setRunningSkillId=()=>{},setSkillsMenuOpen=()=>{};${declaration('handleRunTranscriptSkill')}return handleRunTranscriptSkill;}`;
const code = buildSync({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
test('summary typing does no hidden transcript formatting; transcript view updates after real corrections', t => {
  let timeFormats = 0;
  class MeasuredDate extends Date { toLocaleTimeString(...args) { timeFormats++; return super.toLocaleTimeString(...args); } }
  const module = { exports: {} };
  new Function('Date', 'require', 'module', 'exports', code)(MeasuredDate, require, module, module.exports);
  const { createMeetingAutosave, derive } = module.exports;
  const initial = { id: 'perf', title: '虚构会议', editState: { meetingRevision: 0 },
    detailedSummary: { overview: '摘要', schemaVersion: 3, actionItems: [], actionItemsStructured: [], keyPoints: [] },
    transcript: Array.from({ length: 5000 }, (_, i) => ({ segmentId: `s-${i}`, speaker: 'user', timestamp: i * 1000, text: `虚构转录${i}` })) };
  const controller = createMeetingAutosave(initial, { applyMeetingEdit() { throw Error('unexpected save'); }, getMeetingDetails() { throw Error('unexpected read'); } });
  t.after(() => controller.dispose());
  let tab = 'summary', latest;
  const unsubscribe = controller.subscribe(() => { latest = derive(controller.snapshot().meeting, tab); }); t.after(unsubscribe);
  derive(controller.snapshot().meeting, tab);
  for (let i = 0; i < 10; i++) controller.patch({ overview: `摘要输入${i}` });
  assert.equal(timeFormats, 0, 'hidden transcript is not formatted while editing summary');
  tab = 'transcript'; const first = derive(controller.snapshot().meeting, tab);
  assert.equal(timeFormats, 0); assert.equal(first.canRunTranscriptSkill, true);
  controller.patch({ title: '修正标题' });
  assert.equal(timeFormats, 0, 'transcript view does not generate full text while typing');
  controller.text('s-0', '修正转录');
  const corrected = latest;
  assert.equal(timeFormats, 0); assert.equal(corrected.canRunTranscriptSkill, true);
  assert.equal(corrected.visibleTranscriptRows[0].entry.text, '修正转录');
});

test('transcript skill formats the saved snapshot after flush and never runs after a failed save', async () => {
  const module = { exports: {} };
  new Function('Date', 'require', 'module', 'exports', code)(Date, require, module, module.exports);
  let flushed = false, writes = [];
  const controller = { async flush() { flushed = true; return true; }, snapshot() {
    assert.equal(flushed, true); return { meeting: { id: 'm', title: '虚构会议', transcript: [{ speaker: 'user', timestamp: 1, text: '最新保存转录' }] } };
  } };
  const run = module.exports.skillRunner(controller, { async transcriptSkillRun(input) { writes.push(input); return { success: true, filePath: 'test.md' }; } });
  await run({ id: 'skill', name: '测试' }); assert.equal(writes.length, 1); assert.match(writes[0].transcriptMarkdown, /最新保存转录/); assert.doesNotMatch(writes[0].transcriptMarkdown, /stale render/);
  controller.flush = async () => false; await run({ id: 'skill', name: '测试' }); assert.equal(writes.length, 1);
});
