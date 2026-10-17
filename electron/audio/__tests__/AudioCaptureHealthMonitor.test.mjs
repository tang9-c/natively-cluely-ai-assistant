import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('../../../', import.meta.url);
function load(file, names, scope = {}) {
  const source = fs.readFileSync(new URL(file, root), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const { require: customRequire, ...bindings } = scope;
  new Function('exports', 'require', ...Object.keys(bindings), output)(exports, customRequire ?? require, ...Object.values(bindings));
  return exports[names];
}
function clock() {
  let now = 10000, seq = 0; const timers = new Map();
  return { now: () => now, timers,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async tick(ms) { for(let i=0;i<10;i++) await Promise.resolve(); const end = now + ms; for (;;) { const pair = [...timers].sort((a,b)=>a[1].at-b[1].at)[0]; if (!pair || pair[1].at > end) break; now = pair[1].at; timers.delete(pair[0]); pair[1].fn(); for(let i=0;i<10;i++) await Promise.resolve(); } now = end; for(let i=0;i<10;i++) await Promise.resolve(); },
  };
}
const monitorPath = new URL('electron/audio/AudioCaptureHealthMonitor.ts', root);
function monitorFixture(continuous = true) {
  assert.ok(fs.existsSync(monitorPath), 'capture health monitoring must exist');
  const c = clock(), states = [], failures = [];
  const Monitor = load('electron/audio/AudioCaptureHealthMonitor.ts', 'AudioCaptureHealthMonitor');
  const m = new Monitor({ clock: c, onState: state => states.push(state), onFailure: () => failures.push(c.now()) });
  const token = m.bind(); m.start(token, continuous);
  return { c, states, failures, m, token };
}
test('continuous raw callbacks detect startup and mid-meeting stalls after eight seconds', async () => {
  const {m,c,token,failures} = monitorFixture();
  m.observeHeartbeat(token,c.now()); m.recordData(token,640);
  await c.tick(7999); assert.equal(failures.length,0);
  await c.tick(1); assert.equal(failures.length,1);
  assert.equal(m.state,'recovering'); m.stop(); assert.equal(c.timers.size,0);
  const f = monitorFixture(); await f.c.tick(8000); assert.equal(f.failures.length,1); f.m.stop();
});
test('silence and backends without guaranteed raw callbacks never fail for missing data', async () => {
  const f = monitorFixture(false); await f.c.tick(60000); assert.equal(f.failures.length,0); f.m.stop();
  const g = monitorFixture();
  for(let i=0;i<20;i++) { g.m.observeHeartbeat(g.token,g.c.now()); g.m.recordData(g.token,640); await g.c.tick(1000); }
  assert.equal(g.failures.length,0); assert.equal(g.m.state,'healthy'); g.m.stop();
});
test('old data, error, start and post-stop timers cannot revive a capture', async () => {
  const f = monitorFixture(); const old = f.token; const current = f.m.bind();
  f.m.start(old,true); f.m.recordData(old,640); assert.equal(f.m.beginRecovery(old),false);
  f.m.start(current,true); f.m.stop(); f.m.recordData(current,640);
  await f.c.tick(60000); assert.equal(f.failures.length,0); assert.equal(f.c.timers.size,0);
});
test('three consecutive attempts survive immediate errors and reset only after five seconds of valid data', async () => {
  const f = monitorFixture(); let token = f.token;
  for(let i=1;i<=3;i++) { assert.equal(f.m.beginRecovery(token),true); assert.equal(f.m.attempts,i); token=f.m.bind(); f.m.start(token,true); f.m.recordData(token,640); await f.c.tick(100); }
  assert.equal(f.m.beginRecovery(token),false); assert.equal(f.m.state,'failed'); assert.equal(f.m.attempts,3); f.m.stop();
  const g = monitorFixture(); assert.equal(g.m.beginRecovery(g.token),true); token=g.m.bind(); g.m.start(token,true);
  g.m.recordData(token,0); assert.equal(g.m.state,'recovering');
  for(let i=0;i<=5;i++) { g.m.observeHeartbeat(token,g.c.now()); g.m.recordData(token,640); await g.c.tick(1000); }
  assert.equal(g.m.attempts,0); g.m.stop();
});
test('permission failure is terminal without consuming retries or accepting late audio', () => {
  const f=monitorFixture(); assert.equal(f.m.beginRecovery(f.token,true),false);
  f.m.recordData(f.token,640); assert.equal(f.m.state,'failed'); assert.equal(f.m.attempts,0); f.m.stop();
});
// Execute the production recovery and wire methods with fake native boundaries.
function mainFixture() {
  const c=clock(), instances=[], broadcasts=[], constructions=[];
  const control={failPreferred:null,failAll:false,permissionAwait:null,sttFail:false,actualUnknown:false,releaseGate:null};
  class Capture extends EventEmitter {
    constructor(device) { super(); constructions.push(device); if(control.failAll || (control.failPreferred && device===control.failPreferred)) throw new Error('device unavailable'); this.device=device; this.destroyCalls=0; this.nativeStops=0; this.nativeStarted=false; instances.push(this); }
    start(){this.nativeStarted=true;this.emit('start');}
    async stop(){if(this.nativeStarted){this.nativeStops++;this.nativeStarted=false;this.emit('stop');}}
    async destroy(){this.destroyCalls++;await this.stop();if(control.releaseGate)await control.releaseGate;this.removeAllListeners();}
    getBackendName(){return 'coreaudio';} getSampleRate(){return 16000;} getNativeSampleRate(){return 48000;}
    supportsContinuousHeartbeat(){return true;} getActualDeviceId(){return control.actualUnknown ? null : this.device || 'fictional-default';}
  }
  const main=fs.readFileSync(new URL('electron/main.ts',root),'utf8');
  const ast=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
  const cls=ast.statements.find(s=>ts.isClassDeclaration(s)&&s.name.text==='AppState');
  const selected = ['setupAudioRecoveryHandler','setupMicRecoveryHandler','recoverAudioCapture','waitForAudioRelease','cancelAudioRecovery','wireMicCapture','wireSystemCapture','wireCaptureHealth','restartCapturesAfterResume','handleDefaultOutputChanged','reconfigureAudio','normalizeDeviceId','setupSystemAudioPipeline','_doReconfigureSttProvider','releaseAudioCapture'];
  const methods=cls.members.filter(m=>selected.includes(m.name?.getText(ast))).map(m=>m.getText(ast)).join('\n');
  const code=ts.transpileModule(`class Main { ${methods} }`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const Monitor=fs.existsSync(monitorPath)?load('electron/audio/AudioCaptureHealthMonitor.ts','AudioCaptureHealthMonitor',{Date:{now:c.now},setTimeout:c.setTimeout,clearTimeout:c.clearTimeout}):class {};
  const scope={require:id=>id==='./services/CredentialsManager'?{CredentialsManager:{getInstance:()=>({getSttProvider:()=> 'fictional-local'})}}:require(id),SystemAudioCapture:Capture,MicrophoneCapture:Capture,AudioCaptureHealthMonitor:Monitor,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,Date:{now:c.now},console:{log(){},warn(){},error(){}},isNativeAudioModuleUnavailable:()=>false,resolveMacScreenCaptureCapability:()=>control.permissionAwait ?? Promise.resolve({effectiveDenied:false}),isAudioCapturePermissionError:e=>/permission denied/i.test(e.message),redactForLog:x=>x};
  const Main=new Function(...Object.keys(scope),`${code};return Main;`)(...Object.values(scope));
  const app=new Main(); Object.assign(app,{isMeetingActive:true,_audioCaptureEpoch:0,_systemAudioRecoveryAttempts:0,_micRecoveryAttempts:0,_systemAudioRecoveryInProgress:false,_micRecoveryInProgress:false,_systemAudioConsecutiveFailures:0,_systemAudioSuccessfulRestarts:0,_audioRecoveryWaits:new Map(),_audioRecoveryOwners:{},_audioCaptureReleases:new Set(),_captureHealth:{},broadcast:(...args)=>broadcasts.push(args),broadcastDeviceSelection:p=>broadcasts.push(['device-selection-applied',p]),maybeBroadcastSckOutputRouteIgnored(){},checkSameInputOutputDevice:()=>null,recordMeetingAudioPeak(){},getOutputRouteDiagnostics:()=>({}),detectSameInputOutputDevice:()=>null});
  app.scheduleAdaptiveLocalSttPreload=()=>{};
  app.createSTTProvider=()=>{if(control.sttFail)throw new Error('fictional STT init failure');const stt=new EventEmitter();Object.assign(stt,{start(){},stop(){},setSampleRate(){},setAudioChannelCount(){},write(){}});return stt;};
  app.systemAudioCapture=new Capture(); app.microphoneCapture=new Capture();
  app.wireSystemCapture(app.systemAudioCapture); app.wireMicCapture(app.microphoneCapture);
  app.systemAudioCapture.start(); app.microphoneCapture.start();
  return {app,c,instances,broadcasts,control,constructions};
}
test('production recovery discards release work after meeting stop and settles its promise', async () => {
  const {app,c,instances}=mainFixture(); app.microphoneCapture.emit('error',new Error('unplugged'));
  await c.tick(0);
  assert.equal(app._audioRecoveryWaits.size,1);
  app.isMeetingActive=false; app._audioCaptureEpoch++; app.cancelAudioRecovery?.();
  await c.tick(1500); assert.equal(instances.length,2,'stop must not construct a new mic');
  Object.values(app._captureHealth).forEach(m=>m.stop()); assert.equal(c.timers.size,0);
});
test('production recovery wires fresh mic health, isolates channels and broadcasts actual fallback', async () => {
  const {app,c,instances,broadcasts}=mainFixture(); const system=app.systemAudioCapture;
  const old=app.microphoneCapture; old.emit('error',new Error('unplugged')); old.emit('error',new Error('duplicate'));
  await c.tick(1500); assert.equal(instances.length,3); assert.equal(app.systemAudioCapture,system);
  assert.ok(app.microphoneCapture.listenerCount('start')>0,'recovered mic must use shared wire');
  assert.equal(broadcasts.filter(([,p])=>p?.terminal).length,0);
  const current=app.microphoneCapture; current.emit('data',Buffer.alloc(640));
  assert.ok(broadcasts.some(([,p])=>p?.channel==='mic'&&p.state==='healthy'));
  Object.values(app._captureHealth).forEach(m=>m.stop()); app.cancelAudioRecovery?.();
});
test('production capture reuse monitors the next meeting and old callbacks do not write STT', async () => {
  const {app,c}=mainFixture(); const mic=app.microphoneCapture; let writes=0;
  app.googleSTT_User={write(){writes++;},setSampleRate(){},setAudioChannelCount(){}};
  app.isMeetingActive=false; app._audioCaptureEpoch++; app.cancelAudioRecovery();
  for(const m of Object.values(app._captureHealth)) m.resetSession?.();
  app.isMeetingActive=true; mic.start(); mic.emit('data',Buffer.alloc(640));
  assert.equal(app._captureHealth.mic.state,'healthy');
  mic.emit('error',new Error('unplugged')); mic.emit('data',Buffer.alloc(640));
  assert.equal(writes,1,'failed capture late data cannot reach STT');
  app.isMeetingActive=false; app._audioCaptureEpoch++; app.cancelAudioRecovery(); await c.tick(2000);
});
test('production startup errors exhaust three retries without callbacks or concurrent reconstruction', async () => {
  const {app,c,instances,broadcasts}=mainFixture();
  app.microphoneCapture.emit('error',new Error('unplugged'));
  for(let i=0;i<3;i++) { await c.tick(1500); app.microphoneCapture.emit('error',new Error('immediate fail')); }
  app._captureHealth.system.stop();
  await c.tick(60000);
  assert.equal(instances.length,5); assert.equal(app._captureHealth.mic.attempts,3);
  assert.equal(app._captureHealth.mic.state,'failed');
  assert.equal(broadcasts.filter(([,p])=>p?.channel==='mic'&&p.terminal).length,1);
  Object.values(app._captureHealth).forEach(m=>m.stop());
});
test('raw counter support appears late, missing fields stay conservative, reset does not reset retry budget', async () => {
  const f=monitorFixture(false); f.m.observeHeartbeat(f.token,undefined); await f.c.tick(7000);
  f.m.observeHeartbeat(f.token,0); await f.c.tick(1000); assert.equal(f.failures.length,1); f.m.stop();
  const g=monitorFixture(); g.m.observeHeartbeat(g.token,100); await g.c.tick(7000);
  g.m.observeHeartbeat(g.token,2); await g.c.tick(7999); assert.equal(g.failures.length,0);
  await g.c.tick(1); assert.equal(g.failures.length,1); g.m.stop();
});
test('production confirmed permission errors do not retry or let the other channel clear them', async () => {
  const {app,c,instances,broadcasts}=mainFixture();
  app.microphoneCapture.emit('error',new Error('Microphone permission denied'));
  app.systemAudioCapture.emit('data',Buffer.alloc(640));
  assert.equal(app._captureHealth.mic.state,'failed'); assert.equal(app._captureHealth.mic.attempts,0);
  assert.equal(broadcasts.filter(([,p])=>p?.channel==='mic'&&p.terminal).length,1);
  app._captureHealth.system.stop(); await c.tick(60000); assert.equal(instances.length,2);
  app.cancelAudioRecovery(); assert.equal(c.timers.size,0);
});
test('production mic fallback reports the device actually opened after valid current data', async () => {
  const {app,c,broadcasts,control}=mainFixture();
  app._lastRequestedInputDeviceId='disconnected-fictional'; control.failPreferred=app._lastRequestedInputDeviceId;
  app.microphoneCapture.emit('error',new Error('unplugged')); await c.tick(1500);
  assert.equal(app._captureHealth.mic.state,'recovering');
  app.microphoneCapture.emit('data',Buffer.alloc(640));
  const applied=broadcasts.find(([event,p])=>event==='device-selection-applied'&&p.kind==='input');
  assert.deepEqual(applied[1],{kind:'input',requested:'disconnected-fictional',actual:'fictional-default',fellBack:true,reason:'capture-confirmed'});
  app.cancelAudioRecovery();
});
test('production constructor failures stop after the same three attempts and leave no waits', async () => {
  const {app,c,broadcasts,control,constructions}=mainFixture(); control.failAll=true;
  app._captureHealth.system.stop(); app.microphoneCapture.emit('error',new Error('unplugged'));
  await c.tick(60000);
  assert.equal(app._captureHealth.mic.attempts,3); assert.equal(app._captureHealth.mic.state,'failed');
  assert.equal(constructions.length,8); assert.equal(app._audioRecoveryWaits.size,0);
  assert.equal(broadcasts.filter(([,p])=>p?.channel==='mic'&&p.terminal).length,1);
  app.cancelAudioRecovery(); assert.equal(c.timers.size,0);
});
function wrapperFixture(channel, options={}) {
  const c=clock(), natives=[], diagnostics=[];
  class Native {
    constructor(){ this.stops=0; if(options.constructorError) throw new Error('device unavailable'); natives.push(this); }
    start(data,speech){ this.data=data; this.speech=speech; if(options.startError) data(new Error('device failed')); }
    stop(){this.stops++;} getBackendName(){return options.backend ?? 'coreaudio';}
    getSampleRate(){return 16000;} getNativeSampleRate(){return 48000;}
    getBufferDiagnostics(){if(options.diagnosticsError) throw new Error('disposed'); return options.snapshot ?? {droppedSamples:0,dropEvents:0};}
  }
  class Diagnostics {
    constructor(opts){this.options=opts; this.starts=0; diagnostics.push(this);}
    start(){this.starts++;} stop(){} recordChunk(){}
  }
  const name=channel==='mic'?'MicrophoneCapture':'SystemAudioCapture';
  const Capture=load(`electron/audio/${name}.ts`,name,{
    require: id=>id.endsWith('nativeModuleLoader')?{loadNativeModule:()=>({MicrophoneCapture:Native,SystemAudioCapture:Native})}:id.endsWith('AudioBufferDiagnosticsMonitor')?{AudioBufferDiagnosticsMonitor:Diagnostics}:id.endsWith('verboseLog')?{isVerboseLogging:()=>false}:require(id),
    setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,setImmediate:fn=>queueMicrotask(fn),console:{log(){},warn(){},error(){}},
  });
  const capture=new Capture(); return {capture,natives,diagnostics,c};
}
test('real wrappers reject late native data/errors/speech across stop and restart generations', async () => {
  for(const channel of ['mic','system']) {
    const {capture,natives,c}=wrapperFixture(channel); let data=0,errors=0,speech=0;
    capture.on('data',()=>data++); capture.on('error',()=>errors++); capture.on('speech_ended',()=>speech++);
    capture.start(); const old=natives[0]; await capture.stop(); capture.start();
    old.data(null,Buffer.alloc(640)); old.data(new Error('late')); old.speech(null,true);
    assert.deepEqual([data,errors,speech],[0,0,0]);
    natives.at(-1).data(null,Buffer.alloc(640)); assert.equal(data,1);
    await capture.destroy(); assert.equal(c.timers.size,0);
  }
});
test('wrappers keep old native fields and silence-gated backends conservative', async () => {
  for(const channel of ['mic','system']) {
    const legacy=wrapperFixture(channel); legacy.capture.on('error',()=>{}); legacy.capture.start();
    assert.equal(legacy.capture.supportsContinuousHeartbeat(),false); assert.equal(legacy.capture.getActualDeviceId(),null); await legacy.capture.destroy();
    const current=wrapperFixture(channel,{snapshot:{droppedSamples:0,dropEvents:0,receivedSamples:123,actualDeviceId:'fictional-actual'}});
    current.capture.on('error',()=>{}); current.capture.start(); assert.equal(current.capture.supportsContinuousHeartbeat(),true); assert.equal(current.capture.getActualDeviceId(),'fictional-actual'); await current.capture.destroy();
  }
  for(const backend of ['sck','wasapi','unknown']) {
    const f=wrapperFixture('system',{backend,snapshot:{receivedSamples:0,actualDeviceId:'attempted-endpoint'}}); f.capture.start(); assert.equal(f.capture.supportsContinuousHeartbeat(),false); if(backend==='sck') assert.equal(f.capture.getActualDeviceId(),null); await f.capture.destroy();
  }
});
test('synchronous native start errors do not restart diagnostics after recovery already stopped the instance', async () => {
  for(const channel of ['mic','system']) {
    const f=wrapperFixture(channel,{startError:true}); f.capture.on('error',()=>{}); f.capture.start();
    assert.equal(f.diagnostics[0].starts,0); await f.capture.destroy();
  }
});
test('system lazy-init failure still announces an attempt before its error; disposed diagnostics are conservative', async () => {
  const f=wrapperFixture('system',{constructorError:true}); const events=[];
  f.capture.on('start',()=>events.push('start')); f.capture.on('error',()=>events.push('error')); f.capture.start();
  assert.deepEqual(events,['start','error']); await f.capture.destroy();
  const g=wrapperFixture('mic',{diagnosticsError:true});
  assert.equal(g.capture.supportsContinuousHeartbeat(),false); assert.equal(g.capture.getActualDeviceId(),null); await g.capture.destroy();
});
test('production resume and output-route changes share one rebuild per channel', async () => {
  const {app,c,instances}=mainFixture();
  await app.restartCapturesAfterResume(); await app.handleDefaultOutputChanged();
  await c.tick(1500); assert.equal(instances.length,4);
  assert.equal(app._captureHealth.mic.attempts,1); assert.equal(app._captureHealth.system.attempts,1);
  app.cancelAudioRecovery(); assert.equal(c.timers.size,0);
});
test('production reconfigure invalidates old release work and ignores stop during permission await', async () => {
  const {app,c,instances}=mainFixture();
  app.microphoneCapture.emit('error',new Error('unplugged')); await c.tick(0);
  await app.reconfigureAudio('fictional-mic','fictional-output');
  app.systemAudioCapture.start(); app.microphoneCapture.start();
  await c.tick(1500); assert.equal(instances.length,4,'old recovery must not replace the newly selected mic');
  app.cancelAudioRecovery(); assert.equal(c.timers.size,0);
  const g=mainFixture(); let release;
  g.control.permissionAwait=new Promise(resolve=>{release=resolve;});
  const pending=g.app.reconfigureAudio('changed','changed'); await g.c.tick(0);
  g.app.isMeetingActive=false; g.app._audioCaptureEpoch++; g.app.cancelAudioRecovery();
  release({effectiveDenied:false}); await pending;
  assert.equal(g.instances.length,2); assert.equal(g.c.timers.size,0);
});
test('diagnostics polls raw counters only and missing or invalid native fields never become zero-heartbeats', () => {
  const Diagnostics=load('electron/audio/AudioBufferDiagnosticsMonitor.ts','AudioBufferDiagnosticsMonitor');
  let snapshot={droppedSamples:0,dropEvents:0}; const observations=[];
  const monitor=new Diagnostics({channel:'mic',getNativeDiagnostics:()=>snapshot,getContext:()=>({backend:'cpal',nativeSampleRate:48000,emittedSampleRate:16000}),isVerbose:()=>false,onHeartbeat:n=>observations.push(n)});
  monitor.start(); monitor.recordChunk(640); monitor.poll(); assert.deepEqual(observations,[]);
  for(const receivedSamples of [undefined,NaN,-1,Number.MAX_SAFE_INTEGER+1]) {snapshot={...snapshot,receivedSamples};monitor.poll();}
  assert.deepEqual(observations,[]);
  snapshot={...snapshot,receivedSamples:100}; monitor.poll(); monitor.poll();
  snapshot={...snapshot,receivedSamples:2}; monitor.poll(); assert.deepEqual(observations,[100,100,2]);
  monitor.stop(); monitor.poll(); assert.equal(observations.length,3);
});
test('native errors still release the original device exactly once when destroy follows isRecording=false', async () => {
  for(const channel of ['mic','system']) {
    const f=wrapperFixture(channel); f.capture.on('error',()=>{}); f.capture.start();
    const native=f.natives[0]; native.data(new Error('device disappeared'));
    await Promise.all([f.capture.destroy(),f.capture.destroy()]);
    assert.equal(native.stops,1,'native teardown must not be skipped after a callback error');
    assert.equal(f.c.timers.size,0);
  }
});
test('fix I1: destroyed recovery capture leaves reusable fields before cancellation and next meeting rebuilds listeners', async () => {
  const {app,c}=mainFixture(); const old=app.microphoneCapture;
  old.emit('error',new Error('unplugged')); await c.tick(0);
  assert.equal(old.listenerCount('start'),0,'fake destroy must remove all listeners like the real wrapper');
  assert.equal(app.microphoneCapture,null,'destroyed capture cannot stay reusable');
  app.isMeetingActive=false; app._audioCaptureEpoch++; app.cancelAudioRecovery();
  Object.values(app._captureHealth).forEach(h=>h.resetSession()); app.isMeetingActive=true;
  await app.setupSystemAudioPipeline(); app.microphoneCapture.start(); app.microphoneCapture.emit('data',Buffer.alloc(640));
  assert.notEqual(app.microphoneCapture,old); assert.equal(app._captureHealth.mic.state,'healthy');
  await c.tick(1500); assert.equal(old.destroyCalls,1); app.cancelAudioRecovery();
});
test('fix I1: changing STT during a release wait rebuilds capture wiring instead of restarting a disposed wrapper', async () => {
  const {app,c}=mainFixture(); const old=app.microphoneCapture;
  old.emit('error',new Error('unplugged')); await c.tick(0);
  await app._doReconfigureSttProvider();
  assert.notEqual(app.microphoneCapture,old); assert.ok(app.microphoneCapture.listenerCount('data')>0);
  app.microphoneCapture.emit('data',Buffer.alloc(640)); assert.equal(app._captureHealth.mic.state,'healthy');
  app.cancelAudioRecovery(); await c.tick(1500); assert.equal(old.destroyCalls,1);
});
test('fix I2: terminal permission and retry exhaustion release only the failed native device once', async () => {
  for(const channel of ['mic','system']) for(const permanent of [true,false]) {
    const {app,c,instances,broadcasts}=mainFixture();
    const field=channel==='mic'?'microphoneCapture':'systemAudioCapture';
    const healthy=channel==='mic'?app.systemAudioCapture:app.microphoneCapture;
    if(!permanent) {
      for(let i=0;i<3;i++){app[field].emit('error',new Error('unplugged'));await c.tick(1500);}
    }
    const failed=app[field]; failed.emit('error',new Error(permanent?'Permission denied':'retry exhausted')); await c.tick(0);
    assert.equal(app[field],null); assert.equal(failed.nativeStops,1); assert.equal(failed.destroyCalls,1);
    assert.equal(healthy.nativeStops,0); healthy.emit('data',Buffer.alloc(640));
    assert.equal(app._captureHealth[channel==='mic'?'system':'mic'].state,'healthy');
    assert.equal(broadcasts.filter(([,p])=>p?.channel===channel&&p.terminal).length,1);
    const count=instances.length; app.cancelAudioRecovery(); await c.tick(60000); assert.equal(instances.length,count);
  }
});
test('fix I3: production STT initialization failures carry recognition origin independently of capture healthy', async () => {
  const {app,broadcasts,control}=mainFixture();control.sttFail=true;
  await app.setupSystemAudioPipeline();
  for(const channel of ['system','mic']) {
    const failure=broadcasts.find(([event,p])=>event==='audio-capture-failed'&&p.channel===channel&&p.terminal);
    assert.equal(failure[1].source,'stt');
    (channel==='system'?app.systemAudioCapture:app.microphoneCapture).emit('data',Buffer.alloc(640));
    assert.ok(broadcasts.some(([,p])=>p?.channel===channel&&p.state==='healthy'&&p.source==='capture'));
  }
  assert.equal(app.googleSTT,null); assert.equal(app.googleSTT_User,null); app.cancelAudioRecovery();
});
test('fix I4: setup and reconfigure do not claim actual devices before valid current data, including legacy natives', async () => {
  const f=mainFixture();await f.app.systemAudioCapture.destroy();await f.app.microphoneCapture.destroy();
  f.app.systemAudioCapture=null;f.app.microphoneCapture=null;await f.app.setupSystemAudioPipeline();
  assert.ok(f.broadcasts.filter(([e])=>e==='device-selection-applied').every(([,p])=>p.actual===null));f.app.cancelAudioRecovery();
  for(const legacy of [false,true]) {
    const {app,control,broadcasts}=mainFixture();control.actualUnknown=legacy;
    await app.reconfigureAudio('requested-mic','requested-output');
    const initial=broadcasts.filter(([e])=>e==='device-selection-applied');
    assert.ok(initial.length>=2);assert.ok(initial.every(([,p])=>p.actual===null));
    assert.equal(initial.find(([,p])=>p.kind==='input')[1].requested,'requested-mic');
    assert.equal(initial.find(([,p])=>p.kind==='output')[1].requested,'requested-output');
    app.microphoneCapture.start();app.systemAudioCapture.start();
    app.microphoneCapture.emit('data',Buffer.alloc(640));app.systemAudioCapture.emit('data',Buffer.alloc(640));
    for(const kind of ['input','output']) {
      const p=broadcasts.filter(([e,p])=>e==='device-selection-applied'&&p.kind===kind).at(-1)[1];
      assert.equal(p.actual,legacy?null:kind==='input'?'requested-mic':'requested-output');
    }
    app.cancelAudioRecovery();
  }
});
test('fix I1: canceled recovery still awaits original native teardown before constructing replacement', async () => {
  const {app,c,control,instances}=mainFixture();let release;
  control.releaseGate=new Promise(resolve=>{release=resolve;});
  app.microphoneCapture.emit('error',new Error('unplugged'));await c.tick(0);
  const switching=app._doReconfigureSttProvider();await c.tick(0);
  assert.equal(instances.length,2,'new native capture cannot race a pending destroy');
  control.releaseGate=null;release();await switching;
  assert.equal(instances.length,3);assert.ok(app.microphoneCapture.listenerCount('data')>0);app.cancelAudioRecovery();
});
test('fix I4: automatic conflict fallback preserves the original requested input until actual data confirms fallback', async () => {
  const {app,broadcasts}=mainFixture();
  app.checkSameInputOutputDevice=()=> 'fictional conflict';
  app.pickFallbackInputDevice=()=>({id:'fallback-mic',name:'fictional fallback'});
  await app.reconfigureAudio('requested-mic','requested-output');
  const initial=broadcasts.find(([e,p])=>e==='device-selection-applied'&&p.kind==='input')[1];
  assert.equal(initial.requested,'requested-mic');assert.equal(initial.actual,null);
  app.microphoneCapture.start();app.microphoneCapture.emit('data',Buffer.alloc(640));
  const confirmed=broadcasts.filter(([e,p])=>e==='device-selection-applied'&&p.kind==='input').at(-1)[1];
  assert.equal(confirmed.requested,'requested-mic');assert.equal(confirmed.actual,'fallback-mic');assert.equal(confirmed.fellBack,true);
  app.cancelAudioRecovery();
});
