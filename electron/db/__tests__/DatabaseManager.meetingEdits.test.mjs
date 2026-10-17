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
 assert.equal(manager.getMeetingDetails('m').detailedSummary.actionItemsStructured,undefined);
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
