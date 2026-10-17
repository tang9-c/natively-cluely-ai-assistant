import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {RAGManager}=require('../../../dist-electron/electron/rag/RAGManager.js');
const {VectorStore}=require('../../../dist-electron/electron/rag/VectorStore.js');
const {EmbeddingPipeline}=require('../../../dist-electron/electron/rag/EmbeddingPipeline.js');
const {DatabaseManager}=require('../../../dist-electron/electron/db/DatabaseManager.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t) {
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE meetings(id TEXT PRIMARY KEY,title TEXT,start_time INTEGER,duration_ms INTEGER,created_at TEXT,source TEXT,is_processed INTEGER,summary_json TEXT,edit_state_json TEXT,rag_transcript_hash TEXT,rag_index_state TEXT DEFAULT 'missing',embedding_provider TEXT,embedding_dimensions INTEGER,embedding_space TEXT);
 CREATE TABLE transcripts(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT,segment_id TEXT,raw_segment_ids_json TEXT,speaker TEXT,speaker_id TEXT,speaker_label TEXT,provider_speaker_id TEXT,diarization_provider TEXT,content TEXT,original_content TEXT,edit_revision INTEGER DEFAULT 0,timestamp_ms INTEGER,start_timestamp_ms INTEGER,end_timestamp_ms INTEGER,speaker_verification_json TEXT,speaker_identity_correction_json TEXT);
 CREATE TABLE ai_interactions(id INTEGER PRIMARY KEY,meeting_id TEXT,type TEXT,timestamp INTEGER,user_query TEXT,ai_response TEXT,metadata_json TEXT);
 CREATE TABLE chunks(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT,chunk_index INTEGER,speaker TEXT,start_timestamp_ms INTEGER,end_timestamp_ms INTEGER,cleaned_text TEXT,token_count INTEGER,embedding BLOB);
 CREATE TABLE chunk_summaries(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT UNIQUE,summary_text TEXT,embedding BLOB);
 CREATE TABLE embedding_queue(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT,chunk_id INTEGER,status TEXT,retry_count INTEGER DEFAULT 0,error_message TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,processed_at TEXT,UNIQUE(meeting_id,chunk_id));`);
 const initial={meetingRevision:0,transcriptRevision:0,summarySourceRevision:0,indexDirty:false,editedSummaryFields:[]};
 db.prepare('INSERT INTO meetings(id,title,start_time,duration_ms,summary_json,edit_state_json) VALUES(?,?,?,?,?,?)').run('m','虚构会议',1,10000,JSON.stringify({detailedSummary:{overview:'旧摘要星州',actionItems:[],keyPoints:[]}}),JSON.stringify(initial));
 db.prepare('INSERT INTO transcripts(meeting_id,segment_id,raw_segment_ids_json,speaker,content,timestamp_ms,start_timestamp_ms,end_timestamp_ms,speaker_identity_correction_json) VALUES(?,?,?,?,?,?,?,?,?)').run('m','s','["raw-s"]','user','虚构星州接口需求',1000,900,1500,JSON.stringify({identity:'other',source:'user',correctedAt:1}));
 const dm=Object.create(DatabaseManager.prototype);dm.db=db;const previous=DatabaseManager.instance;DatabaseManager.instance=dm;
 const store=Object.create(VectorStore.prototype);Object.assign(store,{db,useNativeVec:false});
 const pipeline=new EmbeddingPipeline(db,store);
 const manager=Object.create(RAGManager.prototype);Object.assign(manager,{db,vectorStore:store,embeddingPipeline:pipeline,_reprocessInFlight:new Set(),meetingReindexTimers:new Map(),disposed:false});
 const edit=operation=>dm.applyMeetingEdit({meetingId:'m',expectedRevision:dm.getMeetingDetails('m').editState.meetingRevision,operation});
 t.after(()=>{for(const timer of manager.meetingReindexTimers.values())clearTimeout(timer);pipeline.dispose();DatabaseManager.instance=previous;db.close();});
 return {db,dm,store,pipeline,manager,edit};
}

test('text editing preserves stable identity, source, time and original only once in real SQLite',t=>{
 const h=harness(t);const before=h.dm.getMeetingDetails('m').transcript[0];
 assert.equal(h.edit({type:'text',segmentId:'raw-s',text:'虚构星舟接口需求'}).ok,true);
 assert.equal(h.edit({type:'text',segmentId:'s',text:'虚构星舟确认接口'}).ok,true);
 const after=h.dm.getMeetingDetails('m').transcript[0];
 assert.deepEqual({...after,text:before.text,originalContent:undefined,editRevision:0},before);
 assert.equal(after.originalContent,'虚构星州接口需求');assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
 assert.equal(h.dm.getMeetingDetails('m').detailedSummary.overview,'旧摘要星州');
});

test('dirty reprocess replaces old text, summary and queue, keeps dirty while embeddings unavailable',async t=>{
 const h=harness(t);h.store.saveChunks([{meetingId:'m',chunkIndex:0,speaker:'ME',text:'旧错词星州',startMs:1,endMs:1,tokenCount:4}]);h.store.saveSummary('m','旧摘要星州');
 h.db.prepare("INSERT INTO embedding_queue(meeting_id,chunk_id,status) VALUES('m',1,'failed')").run();
 h.edit({type:'text',segmentId:'s',text:'虚构星舟接口需求'});
 await h.manager.reprocessMeeting('m');
 assert.match(h.store.getChunksForMeeting('m')[0].text,/星舟/);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM chunk_summaries').get().n,0,'stale summary must not be indexed again');
 assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
 assert.ok(h.db.prepare("SELECT COUNT(*) AS n FROM embedding_queue WHERE status='pending'").get().n>0,'no provider still retains retryable queue');
 assert.deepEqual(await h.store.searchLexical('星舟'),[],'dirty index cannot pose as current evidence');
});

test('reindex recovery retries failures and revision changes during in-flight processing',async t=>{
 const h=harness(t);h.edit({type:'text',segmentId:'s',text:'虚构星舟第一版'});
 const save=h.store.saveChunks.bind(h.store);h.store.saveChunks=()=>{throw new Error('fixture unavailable');};
 await assert.rejects(h.manager.reprocessMeeting('m'),/fixture unavailable/);assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
 h.store.saveChunks=save;
 let release,entered;const waiting=new Promise(resolve=>entered=resolve);const queue=h.pipeline.queueMeeting.bind(h.pipeline);let calls=0;
 h.pipeline.queueMeeting=async id=>{calls++;if(calls===1){entered();await new Promise(resolve=>release=resolve);}await queue(id);};
 h.manager.recoverDirtyMeetingIndexes();
 await waiting;h.edit({type:'text',segmentId:'s',text:'虚构星舟第二版'});h.manager.scheduleMeetingReindex('m');release();
 await new Promise(resolve=>setTimeout(resolve,1400));
 assert.ok(calls>=2,'in-flight dedupe cannot drop later revision');assert.match(h.store.getChunksForMeeting('m')[0].text,/第二版/);
});

test('old chunk and summary embedding batches cannot write after edit or replacement',async t=>{
 const h=harness(t);const [id]=h.store.saveChunks([{meetingId:'m',chunkIndex:0,speaker:'其他参会者',text:'虚构旧词',startMs:1,endMs:1,tokenCount:4}]);h.store.saveSummary('m','虚构旧摘要');
 const gates=[];const provider={name:'fixture',dimensions:2,space:'fixture:2',embed:async()=>{await new Promise(resolve=>gates.push(resolve));return [1,0];}};
 const chunk=h.pipeline.embedChunk(id,provider);const summary=h.pipeline.embedMeetingSummary('m',provider);await tick();
 h.edit({type:'text',segmentId:'s',text:'虚构新词'});gates.splice(0).forEach(resolve=>resolve());await Promise.all([chunk,summary]);
 assert.equal(h.db.prepare('SELECT embedding FROM chunks WHERE id=?').get(id).embedding,null);
 assert.equal(h.db.prepare('SELECT embedding FROM chunk_summaries').get().embedding,null);
});

test('only the completed current queue clears dirty; failed embeddings stay dirty and retry',async t=>{
 const h=harness(t);h.edit({type:'summary',patch:{overview:'人工摘要'}});await h.manager.reprocessMeeting('m');
 assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
 h.pipeline.provider={name:'fixture',dimensions:2,space:'fixture:2',embed:async()=>[1,0]};
 await h.pipeline.processQueue();
 assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,false);
 assert.match(h.db.prepare('SELECT summary_text FROM chunk_summaries').get().summary_text,/人工摘要/);
 assert.ok((await h.store.searchLexical('星州')).length>0);
});

test('a dirty edit cannot be cleared by the old queue before its 600ms rebuild',async t=>{
 const h=harness(t);const [id]=h.store.saveChunks([{meetingId:'m',chunkIndex:0,speaker:'ME',text:'旧星州',startMs:1,endMs:1,tokenCount:4}]);h.store.storeEmbedding(id,[1,0]);h.store.saveSummary('m','旧摘要');h.store.storeSummaryEmbedding('m',[1,0]);
 h.db.prepare("INSERT INTO embedding_queue(meeting_id,status) VALUES('m','pending')").run();
 h.edit({type:'text',segmentId:'s',text:'虚构星舟最新内容'});h.pipeline.provider={name:'fixture',dimensions:2,space:'fixture:2',embed:async()=>[1,0]};
 await h.pipeline.processQueue();assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true,'stale queue cannot report current revision complete');
});

test('embedding failures and blocked cloud scopes retain dirty text and allow a later legal refresh',async t=>{
 const h=harness(t);h.edit({type:'text',segmentId:'s',text:'虚构星舟保留文本'});await h.manager.reprocessMeeting('m');
 let calls=0;h.pipeline.provider={name:'qcloud',dimensions:2,space:'qcloud:fixture:2',embed:async()=>{calls++;return [1,0];}};
 h.pipeline.pendingConfig={providerDataScopes:{embeddings:false}};h.pipeline.delay=async()=>{};
 await h.pipeline.processQueue();assert.equal(calls,0);assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
 assert.match(h.store.getChunksForMeeting('m')[0].text,/保留文本/);
 h.pipeline.pendingConfig={providerDataScopes:{embeddings:true}};h.pipeline.provider.embed=async()=>{throw new Error('fixture provider unavailable');};
 await h.manager.reprocessMeeting('m');while(h.pipeline.isProcessing)await tick();assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
 h.pipeline.provider.embed=async()=>[1,0];await h.manager.reprocessMeeting('m');while(h.pipeline.isProcessing)await tick();
 assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,false);
});

test('constructing RAGManager restores persisted dirty records before a provider is ready',async t=>{
 const h=harness(t);h.edit({type:'text',segmentId:'s',text:'虚构启动恢复星舟'});
 const manager=new RAGManager({db:h.db,dbPath:':memory:',extPath:''});
 try {
  await new Promise(resolve=>setTimeout(resolve,750));
  assert.match(h.store.getChunksForMeeting('m')[0].text,/启动恢复星舟/);
  assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
  assert.ok(h.db.prepare("SELECT COUNT(*) AS n FROM embedding_queue WHERE status='pending'").get().n>0);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM chunk_summaries').get().n,0);
 } finally {await manager.dispose();}
});

test('global record fallback excludes dirty meetings and never reintroduces outdated summary after clean indexing',async t=>{
 const h=harness(t);h.edit({type:'text',segmentId:'s',text:'虚构星舟接口需求'});
 assert.deepEqual(await h.store.searchLexicalMeetings('旧摘要星州'),[]);
 await h.manager.reprocessMeeting('m');h.pipeline.provider={name:'fixture',dimensions:2,space:'fixture:2',embed:async()=>[1,0]};await h.pipeline.processQueue();
 assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,false);
 assert.deepEqual(await h.store.searchLexicalMeetings('旧摘要星州'),[]);
 const result=await h.store.searchLexicalMeetings('星舟');assert.ok(result.length);assert.doesNotMatch(result[0].text,/旧摘要星州/);
});

test('a dirty pending rebuild cannot block embeddings of other meetings',async t=>{
 const h=harness(t);h.store.saveChunks([{meetingId:'m',chunkIndex:0,speaker:'ME',text:'旧星州',startMs:1,endMs:1,tokenCount:4}]);
 h.db.prepare("INSERT INTO embedding_queue(meeting_id,chunk_id,status) VALUES('m',1,'pending')").run();h.edit({type:'text',segmentId:'s',text:'新内容'});
 h.db.prepare("INSERT INTO meetings(id,title,edit_state_json) VALUES('other','虚构其他会议','{}')").run();
 const [id]=h.store.saveChunks([{meetingId:'other',chunkIndex:0,speaker:'其他参会者',text:'虚构其他会议内容',startMs:1,endMs:1,tokenCount:4}]);
 h.db.prepare("INSERT INTO embedding_queue(meeting_id,chunk_id,status) VALUES('other',?,'pending')").run(id);
 h.pipeline.provider={name:'fixture',dimensions:2,space:'fixture:2',embed:async()=>[1,0]};await h.pipeline.processQueue();
 assert.ok(h.db.prepare('SELECT embedding FROM chunks WHERE id=?').get(id).embedding);
 assert.equal(h.dm.getMeetingDetails('m').editState.indexDirty,true);
});
