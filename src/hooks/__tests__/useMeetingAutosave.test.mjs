import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
const bundle=buildSync({entryPoints:['src/hooks/useMeetingAutosave.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {createMeetingAutosave}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const meeting=(revision=0)=>({id:'m',title:'title',summary:'',date:'2026-01-01',duration:'1',editState:{meetingRevision:revision},detailedSummary:{schemaVersion:3,overview:'old',keyPoints:[],actionItems:[],actionItemsStructured:[]},transcript:[{segmentId:'seg',text:'original'}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};
function fixture(t,apply){let latest=meeting();const calls=[];
 const bridge={getMeetingDetails:async()=>structuredClone(latest),applyMeetingEdit:async request=>{calls.push(request);if(apply){const result=await apply(request,calls.length);if(result)return result;}
 latest={...latest,editState:{meetingRevision:latest.editState.meetingRevision+1},detailedSummary:{...latest.detailedSummary}};
 if(request.operation.type==='text')latest.transcript=latest.transcript.map(entry=>entry.segmentId===request.operation.segmentId?{...entry,text:request.operation.text}:entry);
 if(request.operation.type==='summary'){for(const [key,value]of Object.entries(request.operation.patch)){if(key==='title')latest.title=value;else latest.detailedSummary[key]=value;}}
 return {ok:true,meeting:structuredClone(latest),revision:latest.editState.meetingRevision};}};
 const controller=createMeetingAutosave(latest,bridge);t.after(()=>controller.dispose());
 return {controller,calls,setLatest(value){latest=value;},get latest(){return latest;}};
}
test('draft is immediate; edits during in-flight save survive and requests are serial',async t=>{
 const gate=deferred();const f=fixture(t,async(_request,n)=>{if(n===1)await gate.promise;});
 f.controller.patch({overview:'first'});assert.equal(f.controller.snapshot().meeting.detailedSummary.overview,'first');
 const pending=f.controller.flush();await Promise.resolve();f.controller.patch({title:'new title',overview:'second'});
 assert.equal(f.calls.length,1);gate.resolve();assert.equal(await pending,true);
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].expectedRevision,1);
 assert.equal(f.latest.title,'new title');assert.equal(f.latest.detailedSummary.overview,'second');
});
test('failure keeps draft and explicit retry persists it',async t=>{
 const f=fixture(t,async(_request,n)=>n===1?{ok:false,error:'save_failed'}:undefined);
 f.controller.patch({overview:''});assert.equal(await f.controller.flush(),false);
 assert.equal(f.controller.snapshot().meeting.detailedSummary.overview,'');assert.equal(f.controller.snapshot().status,'error');
 assert.equal(await f.controller.flush(),true);assert.equal(f.latest.detailedSummary.overview,'');
});
test('unrelated revision conflict refreshes and retries once',async t=>{
 const f=fixture(t,async(_request,n)=>n===1?{ok:false,error:'conflict'}:undefined);
 const latest=meeting(1);latest.title='external title';f.setLatest(latest);
 f.controller.patch({overview:'mine'});assert.equal(await f.controller.flush(),true);
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].expectedRevision,1);assert.equal(f.latest.title,'external title');
});
test('same-field conflict preserves local input until explicit keep or reload',async t=>{
 const f=fixture(t,async(_request,n)=>n===1?{ok:false,error:'conflict'}:undefined);
 const latest=meeting(1);latest.detailedSummary.overview='theirs';f.setLatest(latest);
 f.controller.patch({overview:'mine'});assert.equal(await f.controller.flush(),false);
 assert.equal(f.calls.length,1);assert.equal(f.controller.snapshot().meeting.detailedSummary.overview,'mine');
 assert.equal(f.controller.snapshot().status,'conflict');assert.equal(await f.controller.keepLocal(),true);assert.equal(f.latest.detailedSummary.overview,'mine');
});
test('generation notification merges clean fields at same revision without resetting dirty input',async t=>{
 const f=fixture(t);f.controller.patch({title:'local title'});
 const generated=meeting();generated.detailedSummary.keyPoints=['generated'];f.controller.refresh(generated);
 assert.equal(f.controller.snapshot().meeting.title,'local title');assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.keyPoints,['generated']);
});
test('notification changing a dirty field must not silently overwrite remote field',async t=>{
 const f=fixture(t);f.controller.patch({overview:'mine'});
 const remote=meeting(1);remote.detailedSummary.overview='theirs';f.setLatest(remote);f.controller.refresh(remote);
 assert.equal(await f.controller.flush(),false);assert.equal(f.calls.length,0);assert.equal(f.controller.snapshot().status,'conflict');
});
test('identity edits wait for summary and subsequent summary waits for identity',async t=>{
 const gate=deferred();const f=fixture(t,async(_request,n)=>{if(n===2)await gate.promise;});
 f.controller.patch({title:'new'});const identity=f.controller.operation({type:'identity',segmentIds:['seg'],identity:'me'});
 while(f.calls.length<2)await new Promise(r=>setImmediate(r));
 f.controller.patch({overview:'after identity'});const last=f.controller.flush();assert.equal(f.calls.length,2);gate.resolve();
 assert.equal(await identity,true);assert.equal(await last,true);assert.deepEqual(f.calls.map(c=>c.expectedRevision),[0,1,2]);
});
test('identity completion cannot claim saved while a newer summary draft is pending',async t=>{
 const gate=deferred();const f=fixture(t,async(_request,n)=>{if(n===1)await gate.promise;});
 const pending=f.controller.operation({type:'identity',segmentIds:['seg'],identity:'me'});
 while(f.calls.length<1)await new Promise(r=>setImmediate(r));
 f.controller.patch({overview:'pending'});gate.resolve();await pending;
 assert.equal(f.controller.snapshot().status,'pending');assert.equal(f.controller.snapshot().meeting.detailedSummary.overview,'pending');
});
test('unchanged blur cannot mark a generated field as a human edit',async t=>{
 const f=fixture(t);f.controller.patch({overview:'old'});assert.equal(await f.controller.flush(),true);assert.equal(f.calls.length,0);
});
test('blur repeated during in-flight save does not submit the same draft twice',async t=>{
 const gate=deferred();const f=fixture(t,async(_request,n)=>{if(n===1)await gate.promise;});
 f.controller.patch({overview:'new'});const pending=f.controller.flush();await Promise.resolve();f.controller.patch({overview:'new'});gate.resolve();assert.equal(await pending,true);assert.equal(f.calls.length,1);
});
test('late save response cannot roll back a newer generated notification',async t=>{
 const gate=deferred();const f=fixture(t,async(_request,n)=>{if(n===1){await gate.promise;const old=meeting(1);old.detailedSummary.overview='mine';return {ok:true,revision:1,meeting:old};}});
 f.controller.patch({overview:'mine'});const pending=f.controller.flush();await Promise.resolve();
 const latest=meeting(2);latest.detailedSummary.overview='mine';latest.detailedSummary.keyPoints=['new generated'];f.controller.refresh(latest);
 gate.resolve();assert.equal(await pending,true);assert.equal(f.controller.snapshot().meeting.editState.meetingRevision,2);assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.keyPoints,['new generated']);
});
test('failed identity cannot be reported saved by an empty flush and retries the actual operation',async t=>{
 const f=fixture(t,async(_request,n)=>n===1?{ok:false,error:'save_failed'}:undefined);
 const operation={type:'identity',segmentIds:['seg'],identity:'me'};
 assert.equal(await f.controller.operation(operation),false);
 assert.equal(await f.controller.flush(),false);assert.equal(f.controller.snapshot().status,'error');
 assert.equal(await f.controller.operation(operation),true);assert.equal(f.calls.length,2);
});

test('review I1: empty action draft keeps its stable row and metadata until explicit deletion',async t=>{
 const f=fixture(t);const item={id:'a',text:'',owner:'甲',deadline:'周五'};
 f.controller.patch({actionItemsStructured:[item]});
 assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.actionItemsStructured,[item]);
 assert.equal(await f.controller.flush(),false);assert.equal(f.calls.length,0);assert.equal(f.controller.snapshot().status,'invalid');
 f.controller.patch({actionItemsStructured:[{...item,owner:'乙',deadline:''}]});
 assert.equal(f.controller.snapshot().meeting.detailedSummary.actionItemsStructured[0].owner,'乙');
 f.controller.patch({actionItemsStructured:[{...item,text:'替换任务',owner:'乙',deadline:''}]});
 assert.equal(await f.controller.flush(),true);assert.equal(f.latest.detailedSummary.actionItemsStructured[0].text,'替换任务');
 f.controller.patch({actionItemsStructured:[{...item,text:'替换任务',owner:'',deadline:''}]});assert.equal(await f.controller.flush(),true);assert.equal(f.latest.detailedSummary.actionItemsStructured[0].owner,'');
 f.controller.patch({actionItemsStructured:[item]});assert.equal(await f.controller.flush(),false);
 f.controller.patch({actionItemsStructured:[]});assert.equal(await f.controller.flush(),true);assert.deepEqual(f.latest.detailedSummary.actionItemsStructured,[]);
});
test('review I2: intermediate action section heading stays a draft until explicit edit end',async t=>{
 const f=fixture(t);const sections=[{title:'下一步',bullets:['必须保留正文']}];
 f.controller.patch({sections});
 assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.sections,sections);
 assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.actionItemsStructured,[]);
 assert.equal(typeof f.controller.setSectionTitleEditing,'function');
 f.controller.setSectionTitleEditing(true);assert.equal(await f.controller.flush(),false);assert.equal(f.calls.length,0);
 f.controller.patch({sections:[{title:'下一步计划',bullets:['必须保留正文']}]});f.controller.setSectionTitleEditing(false);
 assert.equal(await f.controller.flush(),true);assert.equal(f.latest.detailedSummary.sections[0].title,'下一步计划');
 f.controller.setSectionTitleEditing(true);f.controller.patch({sections});f.controller.setSectionTitleEditing(false);
 assert.equal(await f.controller.flush(),true);assert.deepEqual(f.calls.at(-1).operation.patch.sections,sections); // DB performs the atomic canonical migration; Electron regression verifies its result.
});
test('review I3: summary input after failed identity keeps the retryable error and retries both edits',async t=>{
 const f=fixture(t,async(_request,n)=>n===1?{ok:false,error:'save_failed'}:undefined);
 assert.equal(await f.controller.operation({type:'identity',segmentIds:['seg'],identity:'me'}),false);
 f.controller.patch({title:'身份失败后修改标题'});assert.equal(f.controller.snapshot().status,'error');
 assert.equal(await f.controller.flush(),false);assert.equal(f.controller.snapshot().status,'error');
 assert.equal(await f.controller.retry(),true);assert.equal(f.latest.title,'身份失败后修改标题');
 assert.equal(f.calls.at(-1).operation.type,'identity');assert.equal(await f.controller.flush(),true);
});

test('review I1 punctuation: canonical-discarded text cannot save or remove its draft metadata',async t=>{
 for(const text of ['。','...','.。!！?？;；,，、','  。  ']){
  const f=fixture(t);const item={id:'punctuation',text,owner:'甲',deadline:'周五'};
  f.controller.patch({actionItemsStructured:[item]});assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.actionItemsStructured,[item]);
  assert.equal(await f.controller.flush(),false,`canonical-discarded ${JSON.stringify(text)} must not save`);
  assert.equal(f.calls.length,0);assert.equal(f.controller.snapshot().status,'invalid');assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.actionItemsStructured,[item]);
  f.controller.patch({actionItemsStructured:[{...item,text:text+'补充任务。'}]});assert.equal(await f.controller.flush(),true);
  assert.deepEqual(f.controller.snapshot().meeting.detailedSummary.actionItemsStructured,[{...item,text:text+'补充任务。'}]);
 }
});

test('text drafts survive virtualization, invalid input and failed saves in the shared revision queue',async t=>{
 const f=fixture(t,async(_request,n)=>n===1?{ok:false,error:'save_failed'}:undefined);
 f.controller.text('seg','  ');assert.equal(f.controller.snapshot().meeting.transcript[0].text,'  ');
 assert.equal(await f.controller.flush(),false);assert.equal(f.calls.length,0);assert.equal(f.controller.snapshot().status,'invalid');
 f.controller.text('seg','corrected');assert.equal(await f.controller.flush(),false);
 assert.equal(f.controller.snapshot().meeting.transcript[0].text,'corrected');
 assert.equal(await f.controller.retry(),true);assert.deepEqual(f.calls.at(-1).operation,{type:'text',segmentId:'seg',text:'corrected'});
 f.controller.patch({overview:'after text'});assert.equal(await f.controller.flush(),true);assert.equal(f.calls.at(-1).expectedRevision,1);
});
test('text conflict keeps the local draft until explicit resolution',async t=>{
 const f=fixture(t);f.controller.text('seg','mine');const remote=meeting(1);remote.transcript[0].text='theirs';f.setLatest(remote);f.controller.refresh(remote);
 assert.equal(await f.controller.flush(),false);assert.equal(f.controller.snapshot().meeting.transcript[0].text,'mine');assert.equal(f.calls.length,0);
});

test('a newer text draft waits for the in-flight text save and retains its own revision',async t=>{
 const gate=deferred();const f=fixture(t,async(_request,n)=>{if(n===1)await gate.promise;});
 f.controller.text('seg','first text');const pending=f.controller.flush();await Promise.resolve();
 f.controller.text('seg','newer text');assert.equal(f.controller.snapshot().meeting.transcript[0].text,'newer text');gate.resolve();
 assert.equal(await pending,true);assert.deepEqual(f.calls.map(call=>call.operation.text),['first text','newer text']);assert.deepEqual(f.calls.map(call=>call.expectedRevision),[0,1]);
 assert.equal(f.controller.snapshot().meeting.transcript[0].text,'newer text');
});
