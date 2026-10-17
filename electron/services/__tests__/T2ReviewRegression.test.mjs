import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {LocalWhisperSTT}=require('../../../dist-electron/electron/audio/LocalWhisperSTT.js');
const {LocalSenseVoiceSTT}=require('../../../dist-electron/electron/audio/sensevoice/LocalSenseVoiceSTT.js');
const {SpeakerVerificationAnnotator}=require('../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js');
const voice={provider:'local-speaker-verification',profileId:'me',isMe:true,confidence:0.9,threshold:0.72};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function worker(){ const w=new EventEmitter();w.messages=[];w.postMessage=m=>w.messages.push(m);w.terminate=()=>{};return w; }

for(const provider of ['whisper','sensevoice']) for(const change of ['pause-resume','profile']) {
  test(`${provider}: completed final waiting for its predecessor drops ${change} stale identity`,async()=>{
    const w=worker();let stt;
    if(provider==='whisper') { stt=new LocalWhisperSTT('fake');stt.worker=w;stt.workerReady=true;stt._isActive=true;stt.attachWorkerListeners(); }
    else {stt=new LocalSenseVoiceSTT({workerFactory:()=>w});stt.start();w.emit('message',{type:'ready'});}
    let generation=1;let release;
    stt.setSpeakerVerificationAnnotator(new SpeakerVerificationAnnotator({timeoutMs:5000,getMode:()=> 'local',getGeneration:()=>generation,service:{verify:async samples=>{
      if(samples[0]<0.15)await new Promise(resolve=>release=resolve);
      return {status:'verified',speakerVerification:voice};
    }}}));
    const emitted=[];stt.on('transcript',x=>emitted.push(x));
    try {
      stt.dispatchFinal(new Float32Array(32000).fill(0.1));stt.dispatchFinal(new Float32Array(32000).fill(0.2));
      const a=w.messages.find(m=>m.type==='transcribe');
      w.emit('message',{type:'result',taskId:a.taskId,text:'first fictional final'});
      await tick();
      const b=w.messages.filter(m=>m.type==='transcribe')[1];
      w.emit('message',{type:'result',taskId:b.taskId,text:'second fictional final'});
      await tick();assert.equal(emitted.length,0);
      generation+=change==='pause-resume'?2:1;release();await stt.drainFinals(500);
      assert.deepEqual(emitted.map(x=>x.text),['first fictional final','second fictional final']);
      assert.ok(emitted.every(x=>x.speakerVerification===undefined),'already completed queue entries cannot retain stale positive metadata');
    } finally {stt.stop();}
  });
}

const {IntelligenceEngine}=require('../../../dist-electron/electron/IntelligenceEngine.js');
const {DynamicActionEngine}=require('../../../dist-electron/electron/services/dynamic-actions/DynamicActionEngine.js');
function action(id, evidence, confirmation){return {id,sessionId:'fixture',modeId:'fixture',modeTemplateType:'sales',type:'pricing_objection',label:'fixture',productContract:{outputType:'spoken_response',riskState:'normal',userAction:'fixture'},confidence:0.9,priority:0.8,evidenceRefs:evidence,status:'candidate',createdAt:Date.now(),promptInstruction:'',speakerConfirmation:confirmation};}
for(const pending of [true,false]) for(const correction of ['force_me','force_unknown','clear'])test(`canonical alias correction ${correction} retracts ${pending?'pending':'confirmed'} card in backend`,()=>{
  const dynamic=new DynamicActionEngine();
  const old=action('old-card',[{source:'transcript',segmentId:'raw-b',text:'请提供测试',timestamp:100}],pending?{segmentId:'raw-b',speaker:'user',text:'请提供测试',timestamp:100}:undefined);
  dynamic.getStore().addAction(old);
  // An unrelated stable-ID card with identical text must not be withdrawn by the legacy text fallback.
  dynamic.getStore().addAction(action('unrelated',[{source:'transcript',segmentId:'different',text:'请提供测试材料',timestamp:200}]));
  const engine=Object.create(IntelligenceEngine.prototype);const emitted=[];
  Object.assign(engine,{dynamicActionEngine:dynamic,currentSessionId:'fixture',emit:(_event,payload)=>emitted.push(payload)});
  engine.handleSpeakerVerificationSessionOverride({segmentId:'a',rawSegmentIds:['a','raw-b'],speaker:'user',timestamp:200,text:'请提供测试材料',final:true},correction);
  assert.equal(dynamic.getStore().getAction('old-card').status,'dismissed');
  assert.equal(dynamic.getStore().getAction('unrelated').status,'candidate');
  assert.deepEqual(emitted.map(x=>[x.id,x.status]),[['old-card','dismissed']]);
  assert.ok(!engine.getActiveDynamicActions().some(x=>x.id==='old-card'),'backend hydration cannot restore withdrawn card');
});

test('canonical retraction includes cards outside the three visible candidates and supports legacy fallback',()=>{
  const dynamic=new DynamicActionEngine();
  for(let i=0;i<5;i++)dynamic.getStore().addAction({...action(`card-${i}`,[{source:'transcript',segmentId:i===4?'alias':'other-'+i,text:'older text'}]),priority:1-i/10});
  dynamic.getStore().addAction(action('legacy',[{source:'transcript',text:'当前完整段'}]));
  const engine=Object.create(IntelligenceEngine.prototype);Object.assign(engine,{dynamicActionEngine:dynamic,currentSessionId:'fixture',emit:()=>{}});
  engine.handleSpeakerVerificationSessionOverride({segmentId:'canonical',rawSegmentIds:['canonical','alias'],speaker:'user',timestamp:200,text:'当前完整段',final:true},'force_me');
  assert.equal(dynamic.getStore().getAction('card-4').status,'dismissed');
  assert.equal(dynamic.getStore().getAction('legacy').status,'dismissed');
});

test('semantic gate carries stable segment evidence after speaker confirmation is cleared',async()=>{
  const dynamic=new DynamicActionEngine();
  const actions=await dynamic.assessSignals({transcript:'这个价格太高了，我们预算不够',speaker:'interviewer',segmentId:'first-raw',rawSegmentIds:['first-raw'],modeTemplateType:'sales',modeId:'fixture',sessionId:'fixture',cloudClassifier:async({candidates})=>candidates.map(candidate=>({actionType:candidate.actionType,decision:'pass',confidence:0.99,reasons:['fixture_external_model_boundary']}))});
  assert.ok(actions.length>0);
  assert.equal(actions[0].evidenceRefs[0].segmentId,'first-raw');
  const engine=Object.create(IntelligenceEngine.prototype);Object.assign(engine,{dynamicActionEngine:dynamic,currentSessionId:'fixture',emit:()=>{}});
  actions[0].speakerConfirmation={segmentId:'first-raw',speaker:'interviewer',text:'这个价格太高了，我们预算不够',timestamp:1};
  engine.confirmDynamicActionSpeaker(actions[0].speakerConfirmation);
  assert.equal(actions[0].speakerConfirmation,undefined);
  engine.handleSpeakerVerificationSessionOverride({segmentId:'canonical',rawSegmentIds:['canonical','first-raw'],speaker:'user',timestamp:2,text:'合并后的其他文字',final:true},'force_unknown');
  assert.equal(dynamic.getStore().getAction(actions[0].id).status,'dismissed');
});

test('continuation derived card retains the latest turn ID for canonical alias retraction',async()=>{
  const {DynamicActionContinuationService}=require('../../../dist-electron/electron/services/dynamic-actions/DynamicActionContinuationService.js');
  const dynamic=new DynamicActionEngine();
  const service=new DynamicActionContinuationService({planner:{decide:async()=>({decision:'trigger_grounded_answer',confidence:0.95,reasonCode:'fixture_grounded',extractedSlots:{}})}});
  const parent={...action('parent',[{source:'transcript',segmentId:'parent-raw',text:'你们支持流体仿真吗'}]),type:'discovery_question',status:'completed',sourceIntent:'sales_capability_fit',latestTurn:'你们支持流体仿真吗',keyEntities:['测试'],language:'zh'};
  const record=service.registerCompletedAction(parent);assert.ok(record);
  const engine=Object.create(IntelligenceEngine.prototype);
  Object.assign(engine,{dynamicActionEngine:dynamic,dynamicActionContinuationService:service,currentSessionId:'fixture',currentDynamicActionModeId:'fixture',currentDynamicActionTemplateType:'sales',emit:()=>{}});
  await engine.observeDynamicActionContinuation({segmentId:'detail-raw',rawSegmentIds:['detail-raw'],speaker:'interviewer',text:'对象是测试系统，指标是耗时。',timestamp:Date.now(),final:true});
  const derived=dynamic.getStore().getAllActions('fixture')[0];assert.ok(derived);
  assert.equal(derived.evidenceRefs.at(-1).segmentId,'detail-raw');
  assert.equal(record.collectedCustomerTurns[0].segmentId,'detail-raw');
  engine.handleSpeakerVerificationSessionOverride({segmentId:'detail-canonical',rawSegmentIds:['detail-canonical','detail-raw'],speaker:'user',text:'合并后的测试详情',timestamp:Date.now(),final:true},'force_unknown');
  assert.equal(dynamic.getStore().getAction(derived.id).status,'dismissed');
});
