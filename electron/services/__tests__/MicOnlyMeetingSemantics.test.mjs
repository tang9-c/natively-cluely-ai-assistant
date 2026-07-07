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
    /!interviewerProvider/,
    'missing system provider should downgrade the label instead of saying transcription is normal'
  );
  assert.ok(
    summaryFn[0].indexOf('!interviewerProvider') < summaryFn[0].indexOf("label: '语音转写正常'"),
    'missing system provider branch should run before the normal label'
  );
});

test('native audio transcript handler no longer drops user transcripts outside Answer recording mode', () => {
  const ui = read('src/components/NativelyInterface.tsx');
  const transcriptHandler = ui.match(
    /onNativeAudioTranscript\(\(transcript\) => \{[\s\S]*?\n\s*\}\),/
  );

  assert.ok(transcriptHandler, 'native-audio-transcript handler should exist');
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
    /if \(payload\.channel === 'mic'\) \{[\s\S]*micCaptureFailureRef\.current = true;[\s\S]*return;/,
    'audio-capture-failed handler should track microphone capture failures separately'
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
