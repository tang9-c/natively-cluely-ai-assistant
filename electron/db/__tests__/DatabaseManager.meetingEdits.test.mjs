import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'natively-t1-'));
  const filename = join(dir, 'meeting.db');
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      start_time INTEGER,
      duration_ms INTEGER,
      summary_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      calendar_event_id TEXT,
      source TEXT,
      is_processed INTEGER DEFAULT 1
    );
    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      speaker TEXT,
      speaker_id TEXT,
      speaker_label TEXT,
      provider_speaker_id TEXT,
      diarization_provider TEXT,
      content TEXT,
      timestamp_ms INTEGER,
      start_timestamp_ms INTEGER,
      end_timestamp_ms INTEGER,
      speaker_verification_json TEXT,
      speaker_identity_correction_json TEXT,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    CREATE TABLE ai_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      type TEXT,
      timestamp INTEGER,
      user_query TEXT,
      ai_response TEXT,
      metadata_json TEXT,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
  `);
  db.pragma('user_version = 37');
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db; manager.dbPath = filename;
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, manager, filename };
}
function seed(db) {
 db.prepare('INSERT INTO meetings (id,title,summary_json) VALUES (?,?,?)').run('m','auto',JSON.stringify({detailedSummary:{actionItems:[],keyPoints:[]}}));
 db.prepare('INSERT INTO transcripts (meeting_id,speaker,content,timestamp_ms) VALUES (?,?,?,?)').run('m','user','original',100);
}
test('v38 backup includes WAL and backfills stable IDs without changing old content', t => {
 const {db,manager,filename}=fixture(t); seed(db);
 manager.migrateMeetingEdits();
 assert.equal(db.pragma('user_version',{simple:true}),38);
 assert.equal(db.prepare('SELECT segment_id FROM transcripts').get().segment_id,'legacy:m:1');
 assert.equal(db.prepare('SELECT content FROM transcripts').get().content,'original');
 assert.deepEqual(db.pragma('foreign_key_check'),[]);
 assert.ok(existsSync(filename+'.pre-v38.bak'));
 const backup=new Database(filename+'.pre-v38.bak');
 assert.equal(backup.prepare('SELECT content FROM transcripts').get().content,'original'); backup.close();
 manager.migrateMeetingEdits();
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transcripts').get().n,1);
});
test('edits survive delayed generation and deletion prevents resurrection',t=>{
 const {db,manager}=fixture(t); seed(db); manager.migrateMeetingEdits();
 const edit=operation=>manager.applyMeetingEdit({meetingId:'m',expectedRevision:manager.getMeetingDetails('m').editState.meetingRevision,operation});
 assert.equal(edit({type:'summary',patch:{title:'human',actionItemsStructured:[{id:'a',text:'human task'}]}}).ok,true);
 assert.equal(edit({type:'text',segmentId:'legacy:m:1',text:'corrected'}).ok,true);
 assert.equal(edit({type:'text',segmentId:'legacy:m:1',text:'corrected twice'}).ok,true);
 assert.equal(manager.mergeGeneratedMeetingResult({id:'m',title:'stale',summary:'generated',detailedSummary:{overview:'generated',actionItems:[],keyPoints:[],actionItemsStructured:[{id:'b',text:'stale'}]}},0),true);
 const result=manager.getMeetingDetails('m');
 assert.equal(result.title,'human'); assert.equal(result.transcript[0].text,'corrected twice');
 assert.equal(result.transcript[0].originalContent,'original');
 assert.equal(result.detailedSummary.actionItemsStructured[0].text,'human task');
 assert.equal(result.editState.summarySourceRevision,0); assert.equal(result.editState.transcriptRevision,2);
 manager.deleteMeeting('m');
 assert.equal(manager.mergeGeneratedMeetingResult({id:'m',title:'revived'},0),false);
 assert.equal(manager.getMeetingDetails('m'),null);
});
test('revision conflicts, whitelist and identity batches are atomic',t=>{
 const {db,manager}=fixture(t); seed(db); manager.migrateMeetingEdits();
 const apply=(operation,expectedRevision=0)=>manager.applyMeetingEdit({meetingId:'m',expectedRevision,operation});
 assert.equal(apply({type:'summary',patch:{generationStatus:'success'}}).error,'invalid_input');
 assert.equal(apply({type:'identity',segmentIds:['legacy:m:1','missing'],identity:'me'}).error,'invalid_input');
 assert.equal(manager.getMeetingDetails('m').editState.meetingRevision,0);
 assert.equal(apply({type:'identity',segmentIds:['legacy:m:1'],identity:'unknown'}).ok,true);
 assert.equal(manager.getMeetingDetails('m').transcript[0].speakerIdentityCorrection.identity,'unknown');
 assert.equal(apply({type:'text',segmentId:'legacy:m:1',text:'stale'}).error,'conflict');
 assert.equal(manager.updateMeetingTitle('m','legacy title'),true);
 assert.equal(manager.updateMeetingSummary('m',{actionItems:['legacy human']}),true);
 manager.mergeGeneratedMeetingResult({id:'m',title:'generated',detailedSummary:{actionItems:[],keyPoints:[],actionItemsStructured:[{id:'b',text:'stale'}]}},0);
 assert.equal(manager.getMeetingDetails('m').title,'legacy title');
 assert.deepEqual(manager.getMeetingDetails('m').detailedSummary.actionItems,['legacy human']);
 assert.deepEqual(manager.getMeetingDetails('m').detailedSummary.actionItemsStructured.map(item=>item.text),['legacy human']);
});
test('migration failure rolls back columns and user_version',t=>{
 const {db,manager}=fixture(t);seed(db);
 db.exec('CREATE INDEX transcripts_meeting_segment ON transcripts(meeting_id)');
 assert.throws(()=>manager.migrateMeetingEdits());
 assert.equal(db.pragma('user_version',{simple:true}),37);
 assert.equal(db.pragma('table_info(transcripts)').some(c=>c.name==='segment_id'),false);
 assert.equal(db.prepare('SELECT content FROM transcripts').get().content,'original');
});
test('SQLite write failure rolls back edits and revision; concurrent connection sees conflict',t=>{
 const {db,manager,filename}=fixture(t);seed(db);manager.migrateMeetingEdits();
 db.exec(`CREATE TRIGGER fail_edit BEFORE UPDATE OF edit_state_json ON meetings BEGIN SELECT RAISE(ABORT,'fictional failure'); END;`);
 const request={meetingId:'m',expectedRevision:0,operation:{type:'text',segmentId:'legacy:m:1',text:'edited'}};
 assert.equal(manager.applyMeetingEdit(request).error,'save_failed');
 assert.equal(manager.getMeetingDetails('m').transcript[0].text,'original');
 db.exec('DROP TRIGGER fail_edit');
 const secondDb=new Database(filename);const second=Object.create(DatabaseManager.prototype);second.db=secondDb;
 t.after(()=>secondDb.close());
 assert.equal(second.applyMeetingEdit(request).ok,true);
 assert.equal(manager.applyMeetingEdit(request).error,'conflict');
});
test('new stable IDs and merged aliases round-trip without rewriting saved meetings',t=>{
 const {db,manager}=fixture(t);manager.migrateMeetingEdits();
 const meeting={id:'new',title:'new',date:'2026-01-01',summary:'',transcript:[{segmentId:'canonical',rawSegmentIds:['canonical','merged'],speaker:'user',text:'fictional',timestamp:1}]};
 manager.saveMeeting(meeting,1,1);
 const saved=manager.getMeetingDetails('new');
 assert.equal(saved.transcript[0].segmentId,'canonical');
 assert.deepEqual(saved.transcript[0].rawSegmentIds,['canonical','merged']);
 assert.throws(()=>manager.saveMeeting({...meeting,title:'overwrite'},1,1));
 assert.equal(manager.getMeetingDetails('new').title,'new');
});
test('malformed stored aliases do not prevent loading meeting details',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 db.prepare('UPDATE transcripts SET raw_segment_ids_json = ?').run('{broken');
 assert.equal(manager.getMeetingDetails('m').transcript[0].rawSegmentIds,undefined);
 db.prepare('UPDATE transcripts SET raw_segment_ids_json = ?').run('[1,null]');
 assert.equal(manager.getMeetingDetails('m').transcript[0].rawSegmentIds,undefined);
});
test('invalid edits reject empty text, unsafe revisions and malformed summary values',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 for (const operation of [
  {type:'text',segmentId:'legacy:m:1',text:'   '},
  {type:'summary',patch:{keyPoints:[42]}},
  {type:'summary',patch:{sections:[{title:'x',bullets:[null]}]}},
  {type:'summary',patch:{actionItemsStructured:[{id:'a',text:'task',sourceTimestamp:'wrong'}]}},
 ]) assert.equal(manager.applyMeetingEdit({meetingId:'m',expectedRevision:0,operation}).error,'invalid_input');
 assert.equal(manager.applyMeetingEdit({meetingId:'m',expectedRevision:Number.MAX_SAFE_INTEGER+1,operation:{type:'summary',patch:{title:'bad'}}}).error,'invalid_input');
 assert.equal(manager.getMeetingDetails('m').editState.meetingRevision,0);
});
test('persisted merged aliases resolve edits to canonical segment after reload',t=>{
 const {manager}=fixture(t);manager.migrateMeetingEdits();
 manager.saveMeeting({id:'alias',title:'a',date:'2026-01-01',summary:'',transcript:[{segmentId:'a',rawSegmentIds:['a','b','c'],speaker:'user',text:'merged',timestamp:10}]},1,1);
 const result=manager.applyMeetingEdit({meetingId:'alias',expectedRevision:0,operation:{type:'identity',segmentIds:['b','c'],identity:'other'}});
 assert.equal(result.ok,true);
 assert.equal(result.meeting.transcript[0].segmentId,'a');
 assert.equal(result.meeting.transcript[0].timestamp,10);
 assert.equal(result.meeting.transcript[0].text,'merged');
 assert.equal(result.meeting.transcript[0].editRevision,1);
});
test('ignored SQLite update cannot report edit success',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 db.exec(`CREATE TRIGGER ignore_edit BEFORE UPDATE OF edit_state_json ON meetings BEGIN SELECT RAISE(IGNORE); END;`);
 const result=manager.applyMeetingEdit({meetingId:'m',expectedRevision:0,operation:{type:'text',segmentId:'legacy:m:1',text:'changed'}});
 assert.equal(result.error,'save_failed');
 assert.equal(manager.getMeetingDetails('m').transcript[0].text,'original');
});
test('deduplicated final alias remains editable after persisted reload', async t => {
 const { SessionTracker } = await import('../../../dist-electron/electron/SessionTracker.js');
 const {manager}=fixture(t);manager.migrateMeetingEdits();
 const tracker=new SessionTracker();
 const first={segmentId:'dedup-a',speaker:'interviewer',text:'重复虚构内容',timestamp:Date.now(),final:true};
 tracker.addTranscript(first);
 tracker.addTranscript({...first,segmentId:'dedup-b',timestamp:first.timestamp+100});
 manager.saveMeeting({id:'dedup',title:'fictional',date:'2026-01-01',summary:'',transcript:tracker.getFullTranscript()},1,1000);
 const loaded=manager.getMeetingDetails('dedup');
 assert.equal(loaded.transcript.length,1);
 assert.deepEqual(loaded.transcript[0].rawSegmentIds,['dedup-a','dedup-b']);
 const result=manager.applyMeetingEdit({meetingId:'dedup',expectedRevision:0,operation:{type:'identity',segmentIds:['dedup-b'],identity:'other'}});
 assert.equal(result.ok,true);
 assert.equal(result.meeting.transcript[0].segmentId,'dedup-a');
 assert.equal(result.meeting.transcript[0].timestamp,first.timestamp);
 assert.equal(result.meeting.transcript[0].text,first.text);
});

test('first summary edit upgrades both historical lists atomically and preserves metadata',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 const old={overview:'old',actionItems:['Task one.','Only strings'],keyPoints:[],actionItemsStructured:[{id:'stable',text:'Task one',owner:'甲',deadline:'周五'},{id:'unique',text:'Only structured'}]};
 db.prepare('UPDATE meetings SET summary_json=?').run(JSON.stringify({detailedSummary:old}));
 const result=manager.applyMeetingEdit({meetingId:'m',expectedRevision:0,operation:{type:'summary',patch:{overview:''}}});
 assert.equal(result.ok,true);
 assert.equal(result.meeting.detailedSummary.schemaVersion,3);
 assert.deepEqual(result.meeting.detailedSummary.actionItems,['Task one.','Only strings','Only structured']);
 assert.equal(result.meeting.detailedSummary.actionItemsStructured[0].id,'stable');
 assert.equal(result.meeting.detailedSummary.actionItemsStructured[0].owner,'甲');
 assert.equal(result.meeting.transcript[0].text,'original');
});
test('canonical deletion and legacy explicit empty stay empty after reload and delayed generation',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 db.prepare('UPDATE meetings SET summary_json=?').run(JSON.stringify({detailedSummary:{schemaVersion:3,actionItems:['stale'],keyPoints:[],actionItemsStructured:[{id:'a',text:'old',owner:'甲'}]}}));
 assert.equal(manager.updateMeetingSummary('m',{actionItems:[]}),true);
 manager.mergeGeneratedMeetingResult({id:'m',title:'late',detailedSummary:{actionItems:['resurrect'],keyPoints:[],actionItemsStructured:[{id:'b',text:'resurrect'}]}},0);
 const summary=manager.getMeetingDetails('m').detailedSummary;
 assert.deepEqual(summary.actionItemsStructured,[]); assert.deepEqual(summary.actionItems,[]); assert.equal(summary.schemaVersion,3);
});
test('legacy explicit edits retain matching metadata but remove deleted canonical items',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 db.prepare('UPDATE meetings SET summary_json=?').run(JSON.stringify({detailedSummary:{schemaVersion:3,actionItems:[],keyPoints:[],actionItemsStructured:[{id:'a',text:'keep',owner:'甲'},{id:'b',text:'delete'}]}}));
 assert.equal(manager.updateMeetingSummary('m',{actionItems:['keep.','new']}),true);
 const items=manager.getMeetingDetails('m').detailedSummary.actionItemsStructured;
 assert.equal(items.length,2); assert.equal(items[0].id,'a');assert.equal(items[0].owner,'甲');assert.equal(items[1].text,'new');
});
test('explicit section rename to an action heading retains its text in canonical actions',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 const first=manager.applyMeetingEdit({meetingId:'m',expectedRevision:0,operation:{type:'summary',patch:{sections:[{title:'会议结论',bullets:['保留普通结论']}]}}});assert.equal(first.ok,true);
 const result=manager.applyMeetingEdit({meetingId:'m',expectedRevision:1,operation:{type:'summary',patch:{sections:[{title:'下一步',bullets:['不能丢失的任务']},{title:'结论',bullets:['普通结论']}]}}});
 assert.equal(result.ok,true);assert.deepEqual(result.meeting.detailedSummary.actionItems,['不能丢失的任务']);assert.deepEqual(result.meeting.detailedSummary.sections,[{title:'结论',bullets:['普通结论']}]);
});
test('section-derived human actions stay protected against delayed generation',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 const result=manager.applyMeetingEdit({meetingId:'m',expectedRevision:0,operation:{type:'summary',patch:{sections:[{title:'行动项',bullets:['人手添加']}]}}});assert.equal(result.ok,true);
 manager.mergeGeneratedMeetingResult({id:'m',title:'late',detailedSummary:{actionItems:['late'],keyPoints:[]}},0);
 assert.deepEqual(manager.getMeetingDetails('m').detailedSummary.actionItems,['人手添加']);
});
test('legacy text-only update cannot choose between conflicting existing owners',t=>{
 const {db,manager}=fixture(t);seed(db);manager.migrateMeetingEdits();
 db.prepare('UPDATE meetings SET summary_json=?').run(JSON.stringify({detailedSummary:{actionItems:['任务'],keyPoints:[],actionItemsStructured:[{id:'a',text:'任务',owner:'甲'},{id:'b',text:'任务',owner:'乙'},{id:'c',text:'已删除'}]}}));
 assert.equal(manager.updateMeetingSummary('m',{actionItems:['任务']}),true);
 assert.deepEqual(manager.getMeetingDetails('m').detailedSummary.actionItemsStructured.map(item=>[item.id,item.owner]),[['a','甲'],['b','乙']]);
});
