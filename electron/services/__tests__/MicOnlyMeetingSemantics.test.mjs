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

test('renderer keeps system-audio degradation visible in the summary while suppressing disruptive banners', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const summaryFn = ui.match(
    /const getSttSummary = \([\s\S]*?\n\};/
  );

  assert.ok(summaryFn, 'getSttSummary should exist');
  assert.match(summaryFn[0], /systemAudioIssue: string \| null/);
  assert.match(
    summaryFn[0],
    /if \(systemAudioIssue \|\| \(!interviewerProvider && !hasInterviewerTranscript\)\) \{/,
    'system-audio failures should keep the top-level summary in mic-only state'
  );
  assert.match(
    ui,
    /onSystemAudioPermissionDenied\?\.\(\(message: string\) => \{\s*setSystemAudioIssue\(message \|\| '系统音频未捕获'\);[\s\S]*?if \(!micCaptureFailureRef\.current && sttUserStatusRef\.current !== 'failed'\) return;/,
    'permission-denied events should update the summary even when the banner is gated'
  );
  assert.match(
    ui,
    /if \(payload\.channel === 'mic'\) \{[\s\S]*?return;[\s\S]*?\}\s*setSystemAudioIssue\(payload\.message \|\| '系统音频未捕获'\);[\s\S]*?if \(!micCaptureFailureRef\.current && sttUserStatusRef\.current !== 'failed'\) return;/,
    'system capture failures should update the summary even when the banner is gated'
  );
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

test('native audio transcript handler no longer drops user transcripts outside Answer recording mode', () => {
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
  assert.match(
    transcriptHandler[0],
    /const speakerLabel = transcript\.speaker === 'user' \? 'Me' : 'Interviewer';/,
    'live transcript should preserve the Me / Interviewer role model'
  );
});

test('system-audio warnings are gated behind microphone unavailability in renderer', () => {
  const ui = read('src/components/NativelyInterface.tsx');

  assert.match(
    ui,
    /if \(payload\.channel === 'mic'\) \{[\s\S]*micCaptureFailureRef\.current = true;[\s\S]*kind:\s*'microphone-capture-failure'[\s\S]*setIsExpanded\(true\);[\s\S]*return;/,
    'microphone capture failures should be surfaced immediately instead of being silently tracked'
  );
  assert.match(
    ui,
    /if \(!micCaptureFailureRef\.current && sttUserStatusRef\.current !== 'failed'\) return;/,
    'system-only diagnostics should stay in the background while the microphone remains usable'
  );
  assert.match(
    ui,
    /onSystemAudioPermissionDenied[\s\S]*if \(!micCaptureFailureRef\.current && sttUserStatusRef\.current !== 'failed'\) return;/,
    'screen recording permission banners should also stay suppressed during mic-only meetings'
  );
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
    /if \(segment\.isFinal && segment\.text\.trim\(\)\) \{\s*this\._meetingHasAnyTranscript = true;\s*if \(speaker === 'user'\) this\._meetingHasMicTranscript = true;/,
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
