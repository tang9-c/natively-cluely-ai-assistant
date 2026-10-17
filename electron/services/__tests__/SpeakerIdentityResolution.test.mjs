import { test } from 'node:test';
import assert from 'node:assert/strict';
import identityModule from '../../../dist-electron/shared/speakerIdentity.js';
const voice = {provider:'local-speaker-verification',profileId:'me',isMe:true,confidence:0.9,threshold:0.72};
const resolve = segment => identityModule.resolveSpeakerIdentity(segment);
test('audio source alone never identifies a person, including legacy mic records', () => {
  for (const speaker of ['user','interviewer']) assert.equal(resolve({speaker}).identity,'unknown');
});
test('only valid positive local evidence identifies me', () => {
  assert.equal(resolve({speaker:'interviewer',speakerVerification:voice}).identity,'me');
  for (const patch of [{isMe:false},{confidence:NaN},{threshold:NaN},{profileId:'other'},{provider:'fake'},{confidence:0.71}]) {
    assert.equal(resolve({speaker:'user',speakerVerification:{...voice,...patch}}).identity,'unknown');
  }
});
test('provider evidence survives failed verification but untrusted speaker labels do not', () => {
  assert.equal(resolve({speaker:'user',speakerVerification:{...voice,isMe:false},diarizationProvider:'doubao-auc',providerSpeakerId:'2'}).label,'说话人 2');
  assert.equal(resolve({speaker:'user',speakerLabel:'ME',speakerId:'1'}).identity,'unknown');
});
test('explicit unknown and other outrank positive voice without equating other participants', () => {
  for(const identity of ['me','other','unknown']) assert.equal(resolve({speaker:'user',speakerVerification:voice,speakerIdentityCorrection:{identity,source:'user',correctedAt:1}}).identity,identity);
  assert.equal(resolve({speaker:'interviewer',speakerIdentityCorrection:{isMe:true,source:'user',correctedAt:1}}).source,'manual');
});
test('coalesced and multiple raw audio units cannot inherit one positive verification', () => {
  for(const risk of [{coalescedFromCount:2},{rawSegmentIds:['a','b']},{multipleSpeakers:true}]) assert.equal(resolve({speaker:'user',speakerVerification:voice,...risk}).identity,'unknown');
});

test('LLM transcript and session context never turn source-only speech into ME', async () => {
  const { formatTranscriptForLLM } = await import('../../../dist-electron/electron/llm/transcriptCleaner.js');
  const { SessionTracker } = await import('../../../dist-electron/electron/SessionTracker.js');
  assert.match(formatTranscriptForLLM([{role:'user',text:'我来提供资料',timestamp:1}]),/身份未确认/);
  const session = new SessionTracker();
  session.addTranscript({speaker:'user',text:'我来提供资料。',timestamp:Date.now(),final:true});
  assert.match(session.getFullSessionContext(),/身份未确认/);
  assert.doesNotMatch(session.getFullSessionContext(),/\[ME\]/);
});

test('live manual unknown preserves original source, voice evidence, and canonical merged scope', async () => {
  const { SessionTracker } = await import('../../../dist-electron/electron/SessionTracker.js');
  const session = new SessionTracker();
  const now=Date.now();
  session.addTranscript({segmentId:'a',speaker:'user',text:'我来提供',timestamp:now,final:true,speakerVerification:voice});
  session.addTranscript({segmentId:'b',speaker:'user',text:'资料',timestamp:now+100,final:true,speakerVerification:voice});
  assert.equal(session.setSpeakerVerificationOverride({segmentId:'b',sessionGeneration:session.getSessionGeneration(),action:'force_unknown'}),true);
  const result=session.findEffectiveSpeakerVerificationSegment({segmentId:'b'});
  assert.equal(result.segmentId,'a');
  assert.equal(result.speaker,'user');
  assert.deepEqual(result.speakerVerification,voice);
  assert.equal(resolve(result).identity,'unknown');
  assert.equal(resolve(result).source,'manual');
  assert.equal(session.setSpeakerVerificationOverride({segmentId:'a',sessionGeneration:session.getSessionGeneration(),action:'clear'}),true);
  assert.equal(resolve(session.findEffectiveSpeakerVerificationSegment({segmentId:'a'})).source,'unknown');
});

test('unknown source-only turns count as unknown and cannot become personal metrics', async () => {
  const { evaluateSpeakerContextForAnswer }=await import('../../../dist-electron/electron/services/context/SpeakerContextPolicy.js');
  const result=evaluateSpeakerContextForAnswer([{role:'user',text:'我来提供资料',timestamp:1}]);
  assert.equal(result.trace.confidenceSummary.verifiedMeCount,0);
  assert.equal(result.trace.confidenceSummary.unknownCount,1);
});

test('LLM session context explicitly leaves unknown first-person owners pending',async()=>{
  const { SessionTracker }=await import('../../../dist-electron/electron/SessionTracker.js');
  const session=new SessionTracker();
  session.addTranscript({speaker:'user',text:'我来提供测试资料。',timestamp:Date.now(),final:true});
  assert.match(session.getFullSessionContext(),/负责人必须待确认/);
  assert.match(session.getFormattedContext(),/负责人必须待确认/);
});
