import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as normalization from '../../../dist-electron/shared/meetingActionItems.js';
const normalize=normalization.normalizeMeetingActionItems;
test('strings only project deterministically without mutating legacy input',()=>{
 const old={actionItems:['  整理  资料。','独有任务'],keyPoints:[]};const before=JSON.stringify(old);
 assert.deepEqual(normalize(old),normalize(old));assert.equal(JSON.stringify(old),before);assert.equal(normalize(old).schemaVersion,3);
 assert.deepEqual(normalize(old).actionItems,old.actionItems);
});
test('structured only retains IDs, owner, deadline and source time',()=>{
 const item={id:'stable',text:'交付',owner:'甲',deadline:'周五',sourceTimestamp:20};
 assert.deepEqual(normalize({actionItemsStructured:[item]}).actionItemsStructured,[item]);
});
test('whitespace and trailing punctuation dedupe but similar wording remains distinct',()=>{
 const result=normalize({actionItems:['发 资料。','发 资料','发送资料'],actionItemsStructured:[{id:'old',text:'发 资料',owner:'甲',deadline:'周五'}]});
 assert.equal(result.actionItemsStructured.length,2);assert.equal(result.actionItemsStructured[0].id,'old');assert.equal(result.actionItemsStructured[0].owner,'甲');
});
test('same text with conflicting owners or deadlines preserves both records',()=>{
 for(const [a,b]of [[{owner:'甲'},{owner:'乙'}],[{deadline:'周五'},{deadline:'周六'}]]){
 const result=normalize({actionItems:['任务'],actionItemsStructured:[{id:'a',text:'任务',...a},{id:'b',text:'任务。',...b}]});
 assert.deepEqual(result.actionItemsStructured.map(i=>i.id),['a','b']);
 }
});
test('non-conflicting duplicates fill missing metadata and append unique structured tasks',()=>{
 const result=normalize({actionItems:['任务'],actionItemsStructured:[{id:'a',text:'任务',owner:'甲'},{id:'b',text:'任务。',deadline:'周五'},{id:'c',text:'独有'}]});
 assert.equal(result.actionItemsStructured.length,2);assert.equal(result.actionItemsStructured[0].deadline,'周五');assert.equal(result.actionItemsStructured[0].id,'a');
});
test('v3 canonical empty never resurrects old strings or action sections',()=>{
 const result=normalize({schemaVersion:3,actionItems:['旧任务'],actionItemsStructured:[],sections:[{title:'下一步',bullets:['旧分区任务']},{title:'结论',bullets:['保留']} ]});
 assert.deepEqual(result.actionItemsStructured,[]);assert.deepEqual(result.sections,[{title:'结论',bullets:['保留']}]);
});
test('legacy exact action sections merge unique bullets; ordinary conclusions remain',()=>{
 const result=normalize({actionItems:['共同任务'],actionItemsStructured:[{id:'s',text:'结构任务'}],sections:[{title:' 行动项 ',bullets:['共同任务。','分区独有']},{title:'Next Steps',bullets:['其他行动']},{title:'会议结论',bullets:['普通结论']}]});
 assert.deepEqual(result.actionItems,['共同任务','分区独有','其他行动','结构任务']);
 assert.deepEqual(result.sections,[{title:'会议结论',bullets:['普通结论']}]);
});

test('action text validity exactly matches canonical keep/drop without broadening punctuation semantics',()=>{
 for(const text of ['', '  ', '。', '...', '.。!！?？;；,，、', '任务。', '交付...', '…', '。 、']){
  const kept=normalize({schemaVersion:3,actionItemsStructured:[{id:'a',text}]}).actionItemsStructured.length===1;
  assert.equal(normalization.isValidMeetingActionText?.(text),kept,JSON.stringify(text));
 }
});
