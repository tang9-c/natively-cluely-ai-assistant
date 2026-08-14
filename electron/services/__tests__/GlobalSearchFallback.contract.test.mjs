import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('global search falls back when RAG has no relevant context', () => {
  const source = read('electron/ipcHandlers.ts');
  const handlerStart = source.indexOf("safeHandle('rag:query-global'");
  assert.notEqual(handlerStart, -1, 'global RAG handler should exist');

  const handlerEnd = source.indexOf('// Cancel active RAG query', handlerStart);
  assert.notEqual(handlerEnd, -1, 'global RAG handler boundary should exist');
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /isRecoverableLiveRagError\(msg\)/);
  assert.match(handler, /return \{ fallback: true \}/);
  assert.match(handler, /event\.sender\.send\('rag:stream-error', \{ global: true, error: msg \}\)/);
  assert.ok(
    handler.indexOf('return { fallback: true }') < handler.indexOf("event.sender.send('rag:stream-error'"),
    'recoverable RAG misses should fallback before emitting a stream error',
  );
});

test('top global search can submit the same query more than once', () => {
  const launcher = read('src/components/Launcher.tsx');
  const overlay = read('src/components/GlobalChatOverlay.tsx');

  assert.match(launcher, /submittedGlobalQueryNonce/);
  assert.match(launcher, /setSubmittedGlobalQueryNonce\(\(prev\) => prev \+ 1\)/);
  assert.match(launcher, /queryNonce=\{submittedGlobalQueryNonce\}/);
  assert.match(overlay, /queryNonce\?: number/);
  assert.match(overlay, /\[isOpen, initialQuery, queryNonce\]/);
  assert.match(overlay, /\[initialQuery, queryNonce\]/);
});

test('top search uses debounced structured global meeting search without a duplicate literal action', () => {
  const component = read('src/components/TopSearchPill.tsx');
  const launcher = read('src/components/Launcher.tsx');
  const handlers = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(handlers, /safeHandle\('rag:search-global-meetings'/);
  assert.match(preload, /ragSearchGlobalMeetings:/);
  assert.match(types, /ragSearchGlobalMeetings:/);
  assert.match(component, /TOP_SEARCH_DEBOUNCE_MS\s*=\s*250/);
  assert.match(component, /TOP_SEARCH_MIN_QUERY_LENGTH\s*=\s*2/);
  assert.match(component, /requestSequenceRef/);
  assert.match(component, /closeTimerRef/);
  assert.match(component, /window\.clearTimeout\(closeTimerRef\.current\)/);
  assert.match(component, /isSearching/);
  assert.match(component, /没有找到匹配的会议/);
  assert.match(launcher, /ragSearchGlobalMeetings/);
  assert.doesNotMatch(component, /onLiteralSearch/);
  assert.doesNotMatch(launcher, /onLiteralSearch=/);
  assert.match(handlers, /Number\.isFinite\(requestedLimit\)/);
});

test('global meeting hits open by id even when they are outside the recent meeting cache', () => {
  const launcher = read('src/components/Launcher.tsx');
  const callbackStart = launcher.indexOf('onOpenMeeting={(meetingId) =>');
  assert.notEqual(callbackStart, -1);
  const callback = launcher.slice(callbackStart, launcher.indexOf('}}', callbackStart) + 2);

  assert.match(launcher, /handleOpenMeeting\s*=\s*async\s*\(meeting:\s*Meeting\s*\|\s*string\)/);
  assert.match(callback, /handleOpenMeeting\(meetingId\)/);
  assert.doesNotMatch(callback, /meetings\.find/);
  assert.doesNotMatch(launcher, /Got meeting details/);
});
