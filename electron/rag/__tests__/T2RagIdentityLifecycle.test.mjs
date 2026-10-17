import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {LiveRAGIndexer}=require('../../../dist-electron/electron/rag/LiveRAGIndexer.js');
const {RAGManager}=require('../../../dist-electron/electron/rag/RAGManager.js');
const {RAGRetriever}=require('../../../dist-electron/electron/rag/RAGRetriever.js');
const {VectorStore}=require('../../../dist-electron/electron/rag/VectorStore.js');
const {SessionTracker}=require('../../../dist-electron/electron/SessionTracker.js');
const {fingerprintTranscript}=require('../../../dist-electron/electron/rag/MeetingTranscriptFingerprint.js');
const voice={provider:'local-speaker-verification',profileId:'me',isMe:true,confidence:0.9,threshold:0.72};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE meetings(id TEXT PRIMARY KEY,title TEXT,start_time INTEGER,created_at TEXT,summary_json TEXT,rag_transcript_hash TEXT,rag_index_state TEXT DEFAULT 'missing',embedding_provider TEXT,embedding_dimensions INTEGER,embedding_space TEXT);
    CREATE TABLE transcripts(id INTEGER PRIMARY KEY,meeting_id TEXT,speaker TEXT,content TEXT,timestamp_ms INTEGER,speaker_identity_correction_json TEXT,speaker_verification_json TEXT,provider_speaker_id TEXT,diarization_provider TEXT,raw_segment_ids_json TEXT);
    CREATE TABLE chunks(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT,chunk_index INTEGER,speaker TEXT,start_timestamp_ms INTEGER,end_timestamp_ms INTEGER,cleaned_text TEXT,token_count INTEGER,embedding BLOB);
    CREATE TABLE chunk_summaries(id INTEGER PRIMARY KEY,meeting_id TEXT,embedding BLOB);
    CREATE TABLE embedding_queue(id INTEGER PRIMARY KEY,meeting_id TEXT,chunk_id INTEGER,status TEXT);`);
  db.prepare('INSERT INTO meetings(id,title,start_time,created_at,summary_json) VALUES(?,?,?,?,?)').run('fixture','fixture',Date.now(),new Date().toISOString(),'{}');
  const store=Object.create(VectorStore.prototype);store.db=db;store.useNativeVec=false;
  const pipeline={isReady:()=>true,getEmbedding:async()=>[1,0],getEmbeddingForQuery:async()=>{throw new Error('fixture semantic unavailable');},getActiveProviderName:()=> 'fixture',getActiveSpaceKey:()=> 'fixture:2',getActiveDimensions:()=>2};
  const indexer=new LiveRAGIndexer(store,pipeline);
  const manager=Object.create(RAGManager.prototype);const prompts=[];
  Object.assign(manager,{db,vectorStore:store,embeddingPipeline:pipeline,liveIndexer:indexer,pendingLiveSegments:[],retriever:new RAGRetriever(store,pipeline),llmHelper:{streamChatWithGemini:async function*(prompt){prompts.push(prompt);yield 'fixture answer';}}});
  return {db,store,pipeline,indexer,manager,prompts};
}
const collect=async stream=>{const output=[];for await(const text of stream)output.push(text);return output.join('');};

for(const indexedBefore of [false,true]) test(`live correction ${indexedBefore?'after':'before'} tick replaces canonical and alias evidence`,async()=>{
  const h=harness();const session=new SessionTracker();
  const raw={segmentId:'a',speaker:'user',text:'我会提供虚构测试资料。',timestamp:1000,final:true,speakerVerification:voice};
  session.addTranscript(raw);
  await h.indexer.start('fixture');h.manager.feedLiveTranscript([{...raw}]);
  try {
    if(indexedBefore)await h.indexer.tick(true);
    session.setSpeakerVerificationOverride({segmentId:'a',sessionGeneration:session.getSessionGeneration(),action:'force_unknown'});
    h.manager.correctLiveSpeakerIdentity?.(session.findEffectiveSpeakerVerificationSegment({segmentId:'a'}));
    await h.indexer.tick(true);await tick();
    assert.deepEqual(h.store.getChunksForMeeting('fixture').map(x=>x.speaker),['身份未确认']);
    await collect(h.manager.queryMeeting('fixture','测试资料'));
    assert.match(h.prompts.at(-1),/身份未确认/);assert.doesNotMatch(h.prompts.at(-1),/\bME\b|\bYou\b/);
  } finally {await h.indexer.stop();h.db.close();}
});

test('correction during live embedding cannot restore stale chunks or release a stale query',async()=>{
  const h=harness();let release;let first=true;
  h.pipeline.getEmbedding=async()=>{if(first){first=false;await new Promise(resolve=>release=resolve);}return [1,0];};
  await h.indexer.start('fixture');h.manager.feedLiveTranscript([{segmentId:'raw-b',rawSegmentIds:['a','raw-b'],speaker:'user',text:'虚构测试资料待发送',timestamp:1,speakerIdentityCorrection:{identity:'me',source:'user',correctedAt:1}}]);
  try {
    const pending=h.indexer.tick(true);await tick();
    h.manager.correctLiveSpeakerIdentity?.({segmentId:'a',rawSegmentIds:['a','raw-b'],speaker:'user',text:'虚构测试资料待发送',timestamp:1,speakerIdentityCorrection:{identity:'other',source:'user',correctedAt:2}});
    assert.ok(h.store.getChunksForMeeting('fixture').every(x=>x.speaker!=='ME'),'old saved chunks are invalidated synchronously');
    release();await pending;await h.indexer.tick(true);await tick();
    await collect(h.manager.queryMeeting('fixture','测试资料'));
    assert.match(h.prompts.at(-1),/其他参会者/);assert.doesNotMatch(h.prompts.at(-1),/\bME\b/);
  } finally {release?.();await h.indexer.stop();h.db.close();}
});

for(const kind of ['legacy-policy','manual-correction']) test(`global retrieval excludes ${kind} stale identity index`,async()=>{
  const h=harness();h.pipeline.isReady=()=>false;
  h.db.prepare('INSERT INTO transcripts(id,meeting_id,speaker,content,timestamp_ms) VALUES(1,?,?,?,?)').run('fixture','user','测试资料我来发送',1);
  const rows=()=>h.db.prepare('SELECT *,timestamp_ms AS timestampMs FROM transcripts').all();
  const oldHash=kind==='legacy-policy'?'old-source-only-policy':fingerprintTranscript(rows());
  h.db.prepare("UPDATE meetings SET rag_index_state='complete',rag_transcript_hash=? WHERE id='fixture'").run(oldHash);
  h.store.saveChunks([{meetingId:'fixture',chunkIndex:0,speaker:'You',startMs:1,endMs:1,text:'测试资料我来发送',tokenCount:8}]);
  if(kind==='manual-correction')h.db.prepare('UPDATE transcripts SET speaker_identity_correction_json=? WHERE id=1').run(JSON.stringify({identity:'unknown',source:'user',correctedAt:2}));
  await collect(h.manager.queryGlobal('测试资料'));
  assert.equal(h.prompts.length,0,'unvalidated identity evidence must not reach LLM');
  assert.deepEqual(await h.manager.searchGlobalMeetings('测试资料'),[],'structured search cannot surface stale identity snippets');
  h.db.close();
});

test('current global index remains queryable with its resolved identity',async()=>{
  const h=harness();h.pipeline.isReady=()=>false;
  h.db.prepare('INSERT INTO transcripts(id,meeting_id,speaker,content,timestamp_ms) VALUES(1,?,?,?,?)').run('fixture','user','测试资料我来发送',1);
  const hash=fingerprintTranscript(h.db.prepare('SELECT *,timestamp_ms AS timestampMs FROM transcripts').all());
  h.db.prepare("UPDATE meetings SET rag_index_state='complete',rag_transcript_hash=? WHERE id='fixture'").run(hash);
  h.store.saveChunks([{meetingId:'fixture',chunkIndex:0,speaker:'身份未确认',startMs:1,endMs:1,text:'测试资料我来发送',tokenCount:8}]);
  await collect(h.manager.queryGlobal('测试资料'));
  assert.match(h.prompts[0],/身份未确认/);
  h.db.close();
});

test('global mixed current and stale meetings only expose current evidence and snippets',async()=>{
  const h=harness();h.pipeline.isReady=()=>false;
  h.db.prepare('INSERT INTO transcripts(id,meeting_id,speaker,content,timestamp_ms) VALUES(1,?,?,?,?)').run('fixture','user','测试资料旧承诺',1);
  h.store.saveChunks([{meetingId:'fixture',chunkIndex:0,speaker:'You',startMs:1,endMs:1,text:'测试资料旧承诺',tokenCount:8}]);
  h.db.prepare("UPDATE meetings SET rag_index_state='complete',rag_transcript_hash='legacy' WHERE id='fixture'").run();
  h.db.prepare('INSERT INTO meetings(id,title,start_time,created_at,summary_json) VALUES(?,?,?,?,?)').run('current','current',Date.now(),new Date().toISOString(),'{}');
  h.db.prepare('INSERT INTO transcripts(id,meeting_id,speaker,content,timestamp_ms) VALUES(2,?,?,?,?)').run('current','user','测试资料当前承诺',2);
  const hash=fingerprintTranscript(h.db.prepare("SELECT *,timestamp_ms AS timestampMs FROM transcripts WHERE meeting_id='current'").all());
  h.db.prepare("UPDATE meetings SET rag_index_state='complete',rag_transcript_hash=? WHERE id='current'").run(hash);
  h.store.saveChunks([{meetingId:'current',chunkIndex:0,speaker:'身份未确认',startMs:2,endMs:2,text:'测试资料当前承诺',tokenCount:8}]);
  await collect(h.manager.queryGlobal('测试资料'));
  assert.match(h.prompts[0],/测试资料当前承诺/);assert.doesNotMatch(h.prompts[0],/旧承诺|\] You:/);
  assert.deepEqual((await h.manager.searchGlobalMeetings('测试资料')).map(x=>x.meetingId),['current']);h.db.close();
});

test('live correction while retrieval waits rejects its previously captured identity evidence',async()=>{
  const h=harness();await h.indexer.start('fixture');
  h.manager.feedLiveTranscript([{segmentId:'a',speaker:'user',text:'虚构测试资料由我发送',timestamp:1,speakerVerification:voice}]);
  let release;
  try {
    await h.indexer.tick(true);
    h.pipeline.getEmbeddingForQuery=async()=>{await new Promise(resolve=>release=resolve);throw new Error('fixture offline');};
    const query=collect(h.manager.queryMeeting('fixture','测试资料'));
    await tick();
    h.manager.correctLiveSpeakerIdentity({segmentId:'a',speaker:'user',text:'虚构测试资料由我发送',timestamp:1,speakerIdentityCorrection:{identity:'unknown',source:'user',correctedAt:1}});
    release();await assert.rejects(query,/LIVE_TRANSCRIPT_CHANGED/);assert.equal(h.prompts.length,0);
  } finally {release?.();await h.indexer.stop();h.db.close();}
});

test('identity correction during deferred live startup updates the queued source snapshot',async()=>{
  const h=harness();let release;
  h.db.exec('ALTER TABLE meetings ADD COLUMN duration_ms INTEGER;ALTER TABLE meetings ADD COLUMN source TEXT;ALTER TABLE meetings ADD COLUMN is_processed INTEGER;');
  h.pipeline.ensureInitialized=()=>new Promise(resolve=>release=resolve);
  const starting=h.manager.startLiveIndexing('fixture');
  h.manager.feedLiveTranscript([{segmentId:'a',speaker:'user',text:'虚构测试资料由我发送',timestamp:1,speakerVerification:voice}]);
  h.manager.correctLiveSpeakerIdentity({segmentId:'a',speaker:'user',text:'虚构测试资料由我发送',timestamp:1,speakerIdentityCorrection:{identity:'unknown',source:'user',correctedAt:1}});
  release();await starting;
  try{await h.indexer.tick(true);assert.deepEqual(h.store.getChunksForMeeting('fixture').map(x=>x.speaker),['身份未确认']);}
  finally{await h.indexer.stop();h.db.close();}
});
