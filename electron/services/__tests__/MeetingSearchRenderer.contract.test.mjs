import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('src/components/MeetingChatOverlay.tsx', 'utf8');
const preload = fs.readFileSync('electron/preload.ts', 'utf8');
const rendererTypes = fs.readFileSync('src/types/electron.d.ts', 'utf8');

test('meeting overlay has no generic chat fallback or truncated transcript context', () => {
  assert.doesNotMatch(overlay, /streamGeminiChat/);
  assert.doesNotMatch(overlay, /buildMeetingFallbackSystemPrompt/);
  assert.doesNotMatch(overlay, /buildContextString/);
  assert.doesNotMatch(overlay, /slice\(\s*-20\s*\)/);
  assert.doesNotMatch(overlay, /onGeminiStream/);
});

test('meeting overlay submits request objects and filters stale or cross-scope events', () => {
  assert.match(overlay, /activeRequestIdRef/);
  assert.match(overlay, /ragQueryMeeting\(\s*\{\s*meetingId,\s*query:\s*question,\s*requestId/s);
  assert.match(overlay, /data\.requestId\s*!==\s*activeRequestIdRef\.current/);
  assert.match(overlay, /data\.meetingId\s*!==\s*meetingId/);
  assert.match(overlay, /data\.global\s*===\s*true/);
  assert.match(overlay, /activeRequestIdRef\.current\s*!==\s*requestId/);
});

test('meeting overlay cancels the exact request and replaces partial output on failure', () => {
  assert.match(overlay, /ragCancelQuery\(\{\s*meetingId,\s*requestId/s);
  assert.match(overlay, /activeRequestIdRef\.current\s*=\s*null/);
  assert.match(overlay, /replaceAssistant\(message\)/);
  assert.match(overlay, /result\.status\s*===\s*'cancelled'/);
});

test('preload and renderer use the shared strict meeting search protocol', () => {
  assert.match(preload, /shared\/meetingSearch/);
  assert.match(rendererTypes, /shared\/meetingSearch/);
  assert.match(preload, /ragQueryMeeting:\s*\(\s*request:\s*MeetingSearchRequest/);
  assert.match(preload, /requestId\?:\s*string/);
  assert.match(rendererTypes, /ragQueryMeeting:\s*\(\s*request:\s*MeetingSearchRequest/);
  assert.match(rendererTypes, /requestId\?:\s*string/);
});
