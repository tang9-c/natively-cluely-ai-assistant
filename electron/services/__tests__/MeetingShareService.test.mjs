import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
const modulePath = '../../../dist-electron/electron/services/MeetingShareService.js';
function project(meeting) {
  const service = existsSync(new URL(modulePath, import.meta.url)) ? require(modulePath) : {};
  assert.equal(typeof service.buildMeetingMinutes, 'function', 'minutes needs a safe shared content projection');
  return service.buildMeetingMinutes(meeting);
}
const fixture = {
 id:'share', title:'星舟 & Copilot <img src=x>',date:'2026-10-01T09:00:00Z',duration:'20:00',summary:'STALE',
 detailedSummary:{overview:'## 概要\n**已编辑** Azure &amp; 星舟。\n\n- 第一项\n- 第二项\n\n## 私人问答\nPRIVATE QA\n### 子问题\nPRIVATE CHILD\n## 决策\n确认试点。\n\n**跟进草稿**\nPRIVATE DRAFT\n\n**要点**\n继续公开讨论。\n\n## 辅导评价\nPRIVATE COACH\n',
 keyPoints:['**专名** OpenAI',''],decisions:['确认试点。'],actionItems:['旧行动'],actionItemsStructured:[{id:'action',text:'旧行动',owner:'虚构林青',deadline:'周五'}],sections:[{title:'下一步',bullets:['旧行动','兼容任务']},{title:'会议结论',bullets:['确认试点。','补充分区事实']},{title:'辅导建议',bullets:['PRIVATE SECTION']},{title:'销售推进',bullets:['PRIVATE UNKNOWN']}],followUpDraft:'PRIVATE FIELD',coachingInsights:[{title:'PRIVATE INSIGHT'}]},
 transcript:[{speaker:'user',text:'PRIVATE TRANSCRIPT'}],usage:[{question:'PRIVATE QUESTION',answer:'PRIVATE ANSWER'}]
};
test('minutes filters explicit private headings and fields, merges only fact sections and canonical actions',()=>{
 const result=project(fixture);
 assert.doesNotMatch(result.text,/PRIVATE|STALE|\*\*|^##/m);
 for(const value of ['已编辑 Azure & 星舟。','第一项','第二项','继续公开讨论。','专名 OpenAI','补充分区事实','兼容任务','负责人：虚构林青','截止日期：周五'])assert.ok(result.text.includes(value),value);
 assert.equal((result.text.match(/旧行动/g)||[]).length,1);
 assert.equal((result.text.match(/确认试点。/g)||[]).length,1);
 assert.doesNotMatch(result.html,/<img|<script|<[^>]+(?:href|src)=/i);
 assert.match(result.html,/&lt;img src=x&gt;/);
 assert.match(result.html,/<li>第一项<\/li>/);
});
test('authoritative empty actions and edited empty overview never revive stale content',()=>{
 const result=project({...fixture,editState:{editedSummaryFields:['overview']},detailedSummary:{schemaVersion:3,overview:'',keyPoints:['有效要点'],actionItems:['STALE ACTION'],actionItemsStructured:[],sections:[{title:'下一步',bullets:['STALE SECTION']}]}});
 assert.doesNotMatch(result.text,/STALE|行动项|负责人|截止日期/);assert.match(result.text,/有效要点/);
 assert.throws(()=>project({...fixture,detailedSummary:{schemaVersion:3,overview:'## 私人问答\nPRIVATE',keyPoints:[],actionItems:[],actionItemsStructured:[]}}),/summary_not_ready/);
});
test('legacy English private templates, nested blocks and unsafe markup are not executable or shared',()=>{
 const result=project({...fixture,detailedSummary:{overview:'# Meeting overview\nPublic **fact** [Azure](https://example.com).\n\n## Coaching Insights\nPRIVATE\n### Detail\nPRIVATE\n## Key Points\n> Visible &lt;safe&gt;\n\n<script>alert(1)</script>\n\n![secret](https://example.com/secret)\n\n## Follow-up draft\nPRIVATE',actionItems:[],keyPoints:[]}});
 assert.doesNotMatch(result.text,/PRIVATE|secret|alert\(1\)|https:/);assert.match(result.text,/Public fact Azure/);assert.match(result.text,/Visible <safe>/);
 assert.doesNotMatch(result.html,/<script|<img|https:/);
});
test('DOCX paragraphs, plain text and HTML use the identical ordered content model',async()=>{
 const result=project(fixture);
 const {buildMeetingDocxBuffer}=require('../../../dist-electron/electron/services/MeetingDocxExportService.js');
 const zip=await require('jszip').loadAsync(await buildMeetingDocxBuffer(fixture,{profile:'minutes'}));
 const xml=await zip.file('word/document.xml').async('string');
 const decode=value=>value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
 const paragraphs=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(([p])=>[...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(([,t])=>decode(t)).join('')).filter(Boolean);
 assert.deepEqual(paragraphs,result.blocks.map(block=>block.text));
 assert.deepEqual(result.text.split('\n').filter(Boolean).map(line=>line.replace(/^• /,'')),paragraphs);
 const htmlTexts=[...result.html.matchAll(/<(?:h1|h2|p|li)>(.*?)<\/(?:h1|h2|p|li)>/g)].map(([,text])=>decode(text));
 assert.deepEqual(htmlTexts,paragraphs);
});

test('a bold-only factual overview is content rather than a section label',()=>{
 const result=project({...fixture,detailedSummary:{overview:'**原始摘要**',actionItems:[],keyPoints:[]}});
 assert.ok(result.text.includes('原始摘要'));
});

test('public Markdown headings retain long Chinese and English paragraphs without empty sections',()=>{
 const long='星舟 Azure OpenAI 接口与中文字段保持一致。'.repeat(120);
 const result=project({...fixture,detailedSummary:{overview:`## 方案范围\n${long}\n\n## 空章节\n\n## 辅导建议\nPRIVATE`,actionItems:[],keyPoints:[]}});
 assert.ok(result.blocks.some(block=>block.kind==='heading'&&block.text==='方案范围'));
 assert.ok(result.blocks.some(block=>block.text===long));assert.doesNotMatch(result.text,/空章节|PRIVATE/);
});

test('canonical rows with distinct saved owners survive while unknown metadata is omitted',()=>{
 const result=project({...fixture,detailedSummary:{schemaVersion:3,overview:'有效摘要',keyPoints:[],actionItems:[],actionItemsStructured:[{id:'a',text:'同名任务',owner:'甲'},{id:'b',text:'同名任务',owner:'乙'},{id:'c',text:'未分配任务'}]}});
 assert.equal((result.text.match(/同名任务/g)||[]).length,2);
 assert.match(result.text,/负责人：甲/);assert.match(result.text,/负责人：乙/);
 assert.doesNotMatch(result.text,/待确认|未知|截止日期/);
});

test('known legacy mode fact labels are shared while explicitly labeled coaching and Q&A stay private',()=>{
 const result=project({...fixture,summary:'',detailedSummary:{overview:'## 会议概述\n公开说明\n## 改进空间\nPRIVATE IMPROVEMENT\n## 问题与回答\nPRIVATE INTERVIEW\n## 要点\n公开要点',actionItems:[],keyPoints:[],sections:[{title:'摘要',bullets:['通用模式事实']},{title:'概览',bullets:['旧模式概览']},{title:'已做决策',bullets:['团队已确认决定']},{title:'回答质量',bullets:['PRIVATE REVIEW']}]}});
 for(const value of ['公开说明','公开要点','通用模式事实','旧模式概览','团队已确认决定'])assert.ok(result.text.includes(value),value);
 assert.doesNotMatch(result.text,/PRIVATE/);
});

test('privacy filtering uses explicit category labels without inferring privacy from a factual heading',()=>{
 const result=project({...fixture,detailedSummary:{overview:'## 辅导产品部署范围\n这是一条产品会议事实\n\n## 2. 辅导建议\nPRIVATE\n## 决策\n按既定范围试点',actionItems:[],keyPoints:[]}});
 assert.ok(result.text.includes('这是一条产品会议事实'));assert.doesNotMatch(result.text,/PRIVATE/);
});
