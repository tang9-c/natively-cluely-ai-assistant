import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('renderer treats microphone as the success anchor for overall STT state', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const summaryFn = ui.match(
    /const getSttSummary = \([\s\S]*?\n\};/
  );

  assert.ok(summaryFn, 'getSttSummary should exist');
  assert.match(
    summaryFn[0],
    /if \(userStatus === 'failed'\)/,
    'overall STT failure should only key off microphone failure'
  );
  assert.doesNotMatch(
    summaryFn[0],
    /userStatus === 'failed' \|\| interviewerStatus === 'failed'/,
    'system-audio failure alone should not mark the whole meeting as failed'
  );
});

test('renderer does not call STT normal when a provider label is not set', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const summaryFn = ui.match(
    /const getSttSummary = \([\s\S]*?\n\};/
  );

  assert.ok(summaryFn, 'getSttSummary should exist');
  assert.match(
    summaryFn[0],
    /!userProvider/,
    'missing microphone provider should not be reported as normal'
  );
  assert.match(
    summaryFn[0],
    /!interviewerProvider && !hasInterviewerTranscript/,
    'missing system provider should downgrade the label instead of saying transcription is normal'
  );
  assert.ok(
    summaryFn[0].indexOf('!interviewerProvider') < summaryFn[0].indexOf("label: '语音转写正常'"),
    'missing system provider branch should run before the normal label'
  );
  assert.match(summaryFn[0], /label:\s*'仅麦克风转写'/);
  assert.doesNotMatch(summaryFn[0], /label:\s*'麦克风转写正常'/);
});

test('renderer treats selected STT provider as startup state instead of unconfigured', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const summaryFn = ui.match(
    /const getSttSummary = \([\s\S]*?\n\};/
  );
  const providerLoadEffect = ui.match(
    /getSttProvider\?\.\(\)[\s\S]*?\.catch\(\(\) => \{\}\);/
  );

  assert.ok(summaryFn, 'getSttSummary should exist');
  assert.ok(providerLoadEffect, 'renderer should load the selected STT provider');
  assert.match(summaryFn[0], /configuredProvider: string \| null/);
  assert.match(
    summaryFn[0],
    /const selectedProvider = configuredProvider && configuredProvider !== 'none' \? configuredProvider : '';/,
    'a configured provider should be tracked independently from channel status packets'
  );
  assert.match(
    summaryFn[0],
    /label:\s*'语音转写启动中'/,
    'configured provider with no channel status yet should be shown as startup, not missing config'
  );
  assert.match(
    providerLoadEffect[0],
    /setSelectedSttProvider\(provider\);/,
    'getSttProvider should populate the summary fallback before the first STT status event'
  );
});

function audioHandler(name) {
  const source = read('src/components/NativelyInterface.tsx');
  const tree = ts.createSourceFile('NativelyInterface.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree).endsWith(name)) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(callback, `${name} callback should exist`);
  const state = { issue: null, warning: null, expanded: false };
  const context = {
    captureWarningsRef: { current: {} }, sttWarningsRef: { current: {} }, micCaptureFailureRef: { current: false },
    setSystemAudioIssue: value => { state.issue = value; }, setSystemAudioWarning: value => { state.warning = value; },
    setIsExpanded: value => { state.expanded = value; }, clearAudioWarning() {},
  };
  vm.runInNewContext(ts.transpileModule(`globalThis.handler = ${callback.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { handler: context.handler, state, context };
}

test('permission denial and system capture degradation update the summary with the microphone available', () => {
  const permission = audioHandler('onSystemAudioPermissionDenied');
  permission.handler('fixture permission denied');
  assert.equal(permission.state.issue, 'fixture permission denied');
  assert.equal(permission.state.warning.kind, 'screen-recording-permission');
  const capture = audioHandler('onAudioCaptureFailed');
  capture.handler({ channel: 'system', state: 'failed', message: 'fixture transient', terminal: false });
  assert.equal(capture.state.issue, 'fixture transient');
  assert.equal(capture.state.warning, null);
});

test('renderer does not report STT as unconfigured after live transcript arrives', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const summaryFn = ui.match(
    /const getSttSummary = \([\s\S]*?\n\};/
  );
  const transcriptHandler = ui.match(
    /onNativeAudioTranscriptBatch\(\(batch\) => \{[\s\S]*?\n\s*\}\),/
  );

  assert.ok(summaryFn, 'getSttSummary should exist');
  assert.ok(transcriptHandler, 'native-audio-transcript batch handler should exist');
  assert.match(transcriptHandler[0], /for \(const transcript of batch\.items\)/);
  assert.match(summaryFn[0], /hasUserTranscript: boolean/);
  assert.match(
    summaryFn[0],
    /if \(notConfigured && !hasUserTranscript\)/,
    'a working microphone transcript should override stale not-configured state'
  );
  assert.match(
    transcriptHandler[0],
    /setSttNotConfigured\(false\);/,
    'incoming transcripts prove STT is configured enough to work'
  );
  assert.match(
    transcriptHandler[0],
    /if \(transcript\.speaker === 'user'\) \{\s*setHasUserTranscript\(true\);/,
    'microphone transcripts should feed the summary fallback'
  );
});

test('native audio transcript handler keeps user text without treating audio source as identity', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const transcriptHandler = ui.match(
    /onNativeAudioTranscriptBatch\(\(batch\) => \{[\s\S]*?\n\s*\}\),/
  );

  assert.ok(transcriptHandler, 'native-audio-transcript batch handler should exist');
  assert.doesNotMatch(
    transcriptHandler[0],
    /if \(transcript\.speaker === 'user'\) \{\s*return;/,
    'user microphone transcripts should no longer be dropped from live transcript rendering'
  );
  const require = createRequire(import.meta.url);
  const { resolveSpeakerIdentity } = require(path.join(root, 'dist-electron/shared/speakerIdentity.js'));
  assert.equal(resolveSpeakerIdentity({ speaker: 'user' }).identity, 'unknown');
  assert.equal(resolveSpeakerIdentity({ speaker: 'interviewer' }).identity, 'unknown');
  assert.equal(resolveSpeakerIdentity({ speaker: 'user', speakerIdentityCorrection: { identity: 'me', source: 'user', correctedAt: 1 } }).identity, 'me');

});

test('terminal channel failures surface independently while automatic recovery stays quiet', () => {
  for (const channel of ['system', 'mic']) {
    const capture = audioHandler('onAudioCaptureFailed');
    capture.handler({ channel, state: 'recovering', message: 'fixture recovering' });
    assert.equal(capture.state.warning, null); assert.equal(capture.state.expanded, false);
    capture.handler({ channel, state: 'failed', terminal: true, message: 'fixture terminal' });
    assert.equal(capture.state.warning.kind, channel === 'mic' ? 'microphone-capture-failure' : 'audio-capture-failure');
    assert.equal(capture.state.warning.message, 'fixture terminal'); assert.equal(capture.state.expanded, true);
  }
});

test('rolling transcript chrome stays normal when only system audio is degraded', () => {
  const rolling = read('src/components/ui/RollingTranscript.tsx');

  assert.match(
    rolling,
    /const anyFailed = micStatus === 'failed';/,
    'system-audio failures alone should not flip the rolling transcript into a failed state'
  );
  assert.match(
    rolling,
    /const anyReconnecting = micStatus === 'reconnecting';/,
    'system-audio reconnecting alone should not displace normal mic-only meetings'
  );
});

test('overlay exposes a clickable selective screenshot entry for cropper testing', () => {
  const ui = read('src/components/NativelyInterface.tsx');

  assert.match(ui, /aria-label="进行区域截图"/);
  assert.match(ui, /generalHandlersRef\.current\.selectiveScreenshot\(\)/);
  assert.match(ui, /<Image className="w-3\.5 h-3\.5 opacity-70" \/>/);
});

test('main tracks microphone transcript presence as meeting usability', () => {
  const main = read('electron/main.ts');

  assert.match(
    main,
    /private _meetingHasMicTranscript: boolean = false;/,
    'main process should track whether the meeting has usable microphone transcript'
  );
  assert.match(
    main,
    /if \(routedPayload\.final && routedPayload\.text\.trim\(\)\) \{\s*this\._meetingHasAnyTranscript = true;\s*if \(speaker === 'user'\) this\._meetingHasMicTranscript = true;/,
    'final user transcripts should mark the meeting as usable even when system audio is absent'
  );
});

test('main announces the configured STT provider before waiting for final transcript', () => {
  const main = read('electron/main.ts');

  assert.match(
    main,
    /this\.broadcast\('stt-status',\s*\{\s*state: 'connected',\s*provider: sttProvider,\s*channel: speaker,\s*\} as SttStatusPayload\);\s*\n\s*\/\/ Consecutive failure counter/,
    'renderer needs an initial provider status so a configured STT route is not shown as unconfigured'
  );
  assert.match(
    main,
    /let _lastState: 'connected' \| 'reconnecting' \| 'failed' = 'connected';/,
    'the initial connected broadcast should not be duplicated by the first final transcript'
  );
});

test('renderer clears stale not-configured state when STT status carries a provider', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const listener = ui.match(
    /onSttStatusChanged\(\(data\) => \{[\s\S]*?\n\s*\}\);/
  );

  assert.ok(listener, 'STT status listener should exist');
  assert.match(
    listener[0],
    /if \(data\.provider && data\.provider !== 'none'\) \{[\s\S]*?setSttNotConfigured\(false\);[\s\S]*?\}/,
    'a real provider status should clear any stale not-configured UI summary'
  );
});
