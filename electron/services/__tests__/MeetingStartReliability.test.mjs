import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : -1;
  assert.ok(end > start, `missing end marker ${nextSignature}`);
  return source.slice(start, end);
}

test('startMeeting uses an in-flight guard and delegates to startMeetingInternal', () => {
  const source = read('electron/main.ts');
  assert.match(source, /private _meetingStartInFlight: Promise<void> \| null = null/);

  const body = methodBody(
    source,
    'public async startMeeting(metadata?: any): Promise<void>',
    'private async startMeetingInternal',
  );
  assert.match(body, /if \(this\.isMeetingActive\)/);
  assert.match(body, /if \(this\._meetingStartInFlight\)/);
  assert.match(body, /this\._meetingStartInFlight = this\.startMeetingInternal\(metadata\)/);
});

test('startMeetingInternal shows starting UI before preflight but does not mark meeting active early', () => {
  const source = read('electron/main.ts');
  const body = methodBody(
    source,
    'private async startMeetingInternal(metadata?: any): Promise<void>',
    'public async endMeeting',
  );

  const startingIndex = body.indexOf("meeting-start-status', { phase: 'starting'");
  const overlayIndex = body.indexOf("setWindowMode('overlay'");
  const teardownIndex = body.indexOf('await this._pendingTeardown');
  const micIndex = body.indexOf("ensureMacMicrophoneAccess('meeting start')");
  const activeIndex = body.indexOf('this.isMeetingActive = true');
  const readyIndex = body.indexOf("meeting-start-status', { phase: 'ready'");

  assert.ok(overlayIndex >= 0, 'overlay switch must exist');
  assert.ok(startingIndex >= 0, 'starting status must be broadcast');
  assert.ok(teardownIndex >= 0, 'pending teardown wait must remain');
  assert.ok(micIndex >= 0, 'mic permission check must remain');
  assert.ok(activeIndex >= 0, 'active state must still be set');
  assert.ok(readyIndex >= 0, 'ready status must be broadcast');
  assert.ok(overlayIndex < teardownIndex, 'overlay request should happen before teardown wait');
  assert.ok(startingIndex < teardownIndex, 'starting status should happen before teardown wait');
  assert.ok(teardownIndex < micIndex, 'teardown must complete before mic preflight');
  assert.ok(micIndex < activeIndex, 'meeting must not become active before mic permission passes');
  assert.ok(activeIndex < readyIndex, 'ready status should mean active UI state is established');
});

test('mic permission failure broadcasts failed status without active state in failure branch', () => {
  const source = read('electron/main.ts');
  const body = methodBody(
    source,
    'private async startMeetingInternal(metadata?: any): Promise<void>',
    'public async endMeeting',
  );
  const failBranchStart = body.indexOf("if (!(await ensureMacMicrophoneAccess('meeting start')))");
  assert.ok(failBranchStart >= 0, 'mic failure branch must exist');
  const failBranch = body.slice(
    failBranchStart,
    body.indexOf('// Check Screen Recording permission', failBranchStart),
  );
  assert.match(failBranch, /meeting-start-status', \{ phase: 'failed'/);
  assert.match(failBranch, /meeting-audio-error/);
  assert.doesNotMatch(failBranch, /this\.isMeetingActive = true/);
});

test('meeting start status and audio errors are bridged to renderer', () => {
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');
  const overlay = read('src/components/NativelyInterface.tsx');

  assert.match(preload, /onMeetingStartStatus/);
  assert.match(preload, /meeting-start-status/);
  assert.match(preload, /onMeetingAudioError/);
  assert.match(preload, /meeting-audio-error/);
  assert.match(types, /onMeetingStartStatus/);
  assert.match(types, /onMeetingAudioError/);
  assert.match(overlay, /meetingStartStatus/);
  assert.match(overlay, /setMeetingStartStatus\(null\)/);
});
