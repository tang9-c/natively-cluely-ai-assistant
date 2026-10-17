import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('BaseSTT exposes async drainFinals hook that preserves the existing grace wait', () => {
  const src = read('electron/audio/BaseSTT.ts');
  assert.match(src, /drainFinals\(timeoutMs\?: number\): Promise<void>/);
  assert.match(src, /this\.finalize\(\)/);
  assert.match(src, /setTimeout\(resolve, timeoutMs\)/);
});

test('LocalWhisperSTT implements bounded drainFinals for pending final tasks', () => {
  const src = read('electron/audio/LocalWhisperSTT.ts');
  assert.match(src, /async drainFinals\(timeoutMs: number = 5000\): Promise<void>/);
  assert.match(src, /this\.isDrainingFinals = true/);
  assert.match(src, /this\.finalize\(\)/);
  assert.match(src, /this\.pendingAudio\.length === 0/);
  assert.match(src, /this\.drainingFinalsInFlight === 0/);
  assert.match(src, /Date\.now\(\) - started >= timeoutMs/);
});

test('main endMeeting drains STT providers before stopMeeting snapshot', () => {
  const src = read('electron/main.ts');
  const drainIdx = src.indexOf('await this.drainSttFinalsForMeetingStop()');
  const snapshotIdx = src.indexOf('const meetingId = await this.intelligenceManager.stopMeeting()');
  assert.ok(drainIdx > 0, 'endMeeting should call drainSttFinalsForMeetingStop');
  assert.ok(snapshotIdx > drainIdx, 'meeting snapshot must happen after STT drain');
  assert.doesNotMatch(src, /Grace window for STT trailing finals[\s\S]{0,300}setTimeout\(resolve, 250\)/);
});

import { EventEmitter } from 'node:events';
test('Whisper binds final audio by task and drains accepted finals in order through annotation', async () => {
  const { LocalWhisperSTT } = await import('../../../dist-electron/electron/audio/LocalWhisperSTT.js');
  const worker = new EventEmitter();
  worker.messages=[]; worker.postMessage=m=>worker.messages.push(m); worker.terminate=()=>{};
  const stt = new LocalWhisperSTT('fake-whisper');
  stt.worker=worker; stt.workerReady=true; stt._isActive=true; stt.attachWorkerListeners();
  const annotated=[]; const emitted=[]; let release;
  stt.setSpeakerVerificationAnnotator({annotate:async samples=>{annotated.push(samples[0]); if(samples[0]===1) await new Promise(r=>release=r); return {provider:'local-speaker-verification',profileId:'me',isMe:true,confidence:0.9,threshold:0.72};}});
  stt.on('transcript',x=>emitted.push(x));
  stt.dispatchFinal(new Float32Array([1,1])); stt.dispatchFinal(new Float32Array([2,2]));
  const [a,b]=worker.messages.filter(m=>m.type==='transcribe');
  worker.emit('message',{type:'result',taskId:b.taskId,text:'second final'});
  worker.emit('message',{type:'result',taskId:a.taskId,text:'first final'});
  let drained=false; const drain=stt.drainFinals(500).then(()=>drained=true);
  await new Promise(r=>setTimeout(r,25));
  assert.equal(drained,false,'accepted tasks and annotation must keep drain pending');
  assert.deepEqual(emitted,[],'later finals cannot overtake earlier annotation');
  assert.deepEqual(annotated,[2,1]);
  release(); await drain;
  assert.deepEqual(emitted.map(x=>x.text),['first final','second final']);
  assert.ok(emitted.every(x=>x.speakerVerification.isMe));
  assert.equal(stt.pendingAudioByTaskId.size,0);
  stt.stop();
});

test('Whisper drops stale accepted generation, preserves text on annotation failure, and cleans failed tasks', async()=>{
  const {LocalWhisperSTT}=await import('../../../dist-electron/electron/audio/LocalWhisperSTT.js');
  const {SpeakerVerificationAnnotator}=await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js');
  let generation=1; let calls=0;
  const worker=new EventEmitter(); worker.messages=[];worker.postMessage=m=>worker.messages.push(m);worker.terminate=()=>{};
  const stt=new LocalWhisperSTT('fake-whisper'); stt.worker=worker;stt.workerReady=true;stt._isActive=true;stt.attachWorkerListeners();
  stt.setSpeakerVerificationAnnotator(new SpeakerVerificationAnnotator({getMode:()=> 'local',getGeneration:()=>generation,service:{verify:async()=>{calls++;return {status:'verified',speakerVerification:{provider:'local-speaker-verification',profileId:'me',isMe:true,confidence:0.9,threshold:0.72}};}}}));
  const emitted=[];stt.on('transcript',x=>emitted.push(x));
  const samples=new Float32Array(32000).fill(0.2);
  stt.dispatchFinal(samples);generation+=2;
  worker.emit('message',{type:'result',taskId:worker.messages.at(-1).taskId,text:'stale configuration text'});
  await stt.drainFinals(500);
  assert.equal(emitted[0].speakerVerification,undefined);assert.equal(calls,0);
  stt.setSpeakerVerificationAnnotator({annotate:async()=>{throw new Error('optional identity error');}});
  stt.dispatchFinal(samples);
  worker.emit('message',{type:'result',taskId:worker.messages.at(-1).taskId,text:'text survives identity error'});
  await stt.drainFinals(500);
  assert.equal(emitted[1].text,'text survives identity error');
  stt.dispatchFinal(samples);
  worker.emit('message',{type:'error',taskId:worker.messages.at(-1).taskId,message:'fixture worker error'});
  await stt.drainFinals(500);
  assert.equal(stt.pendingAudioByTaskId.size,0);assert.equal(stt.drainingFinalsInFlight,0);
  stt.stop();
});
