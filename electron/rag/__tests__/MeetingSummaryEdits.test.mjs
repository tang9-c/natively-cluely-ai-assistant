import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {VectorStore} from '../../../dist-electron/electron/rag/VectorStore.js';
import {assembleMeetingEvidence} from '../../../dist-electron/electron/rag/MeetingEvidenceAssembler.js';
test('both native and JS summary results exclude edited stale evidence',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE meetings(id TEXT PRIMARY KEY, edit_state_json TEXT);CREATE TABLE chunk_summaries(id INTEGER PRIMARY KEY, meeting_id TEXT,summary_text TEXT)');
 db.prepare('INSERT INTO chunk_summaries VALUES(?,?,?)').run(1,'dirty','OLD TEXT');db.prepare('INSERT INTO chunk_summaries VALUES(?,?,?)').run(2,'clean','valid');
 db.prepare('INSERT INTO meetings VALUES(?,?)').run('dirty',JSON.stringify({indexDirty:true}));db.prepare('INSERT INTO meetings VALUES(?,?)').run('clean','{}');
 const store=Object.create(VectorStore.prototype);store.db=db;
 const stale=[{meetingId:'dirty',summaryText:'OLD TEXT',similarity:1},{meetingId:'clean',summaryText:'valid',similarity:.8}];
 store.searchSummariesNative=async()=>stale;store.searchSummariesJSWorker=async()=>stale;
 for(const native of [true,false]){store.useNativeVec=native;assert.deepEqual((await store.searchSummaries([1],5,'space')).map(s=>s.summaryText),['valid']);}
});
test('global lexical result uses canonical actions and preserves unchanged transcript evidence',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE meetings(id TEXT,title TEXT,summary_json TEXT,start_time INTEGER,created_at TEXT);CREATE TABLE transcripts(meeting_id TEXT,content TEXT,timestamp_ms INTEGER)');
 db.prepare('INSERT INTO meetings VALUES(?,?,?,?,?)').run('m','task meeting',JSON.stringify({legacySummary:'old legacy',detailedSummary:{schemaVersion:3,overview:'edited',actionItems:['DELETED TASK'],actionItemsStructured:[{id:'a',text:'task now',owner:'甲'}]}}),1,'2026-01-01');
 db.prepare('INSERT INTO transcripts VALUES(?,?,?)').run('m','task transcript unchanged',1);
 const store=Object.create(VectorStore.prototype);store.db=db;
 const results=await store.searchLexicalMeetings('task');assert.equal(results.length,1);assert.doesNotMatch(results[0].text,/DELETED TASK|old legacy/);assert.match(results[0].text,/task now/);assert.match(results[0].text,/transcript unchanged/);
});
test('meeting evidence projects legacy unique tasks and v3 deleted actions consistently',()=>{
 const build=summary=>assembleMeetingEvidence({meetingId:'m',intent:'action_items',summary,retrievedChunks:[],timelineChunks:[]});
 const legacy=build({actionItems:['string task'],actionItemsStructured:[{id:'a',text:'owned task',owner:'甲'}]});assert.match(legacy.formattedContext,/string task/);assert.match(legacy.formattedContext,/owned task.*甲/);
 const empty=build({schemaVersion:3,actionItems:['deleted'],actionItemsStructured:[]});assert.doesNotMatch(empty.formattedContext,/deleted/);assert.equal(empty.evidence.length,0);
});
