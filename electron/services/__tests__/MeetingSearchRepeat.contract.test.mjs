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

test('meeting search can submit the same query more than once', () => {
  const details = read('src/components/MeetingDetails.tsx');
  const overlay = read('src/components/MeetingChatOverlay.tsx');

  assert.match(details, /submittedQueryNonce/);
  assert.match(details, /setSubmittedQueryNonce\(\(prev\) => prev \+ 1\)/);
  assert.match(details, /queryNonce=\{submittedQueryNonce\}/);
  assert.match(overlay, /queryNonce\?: number/);
  assert.match(overlay, /\[isOpen, initialQuery, queryNonce\]/);
  assert.match(overlay, /\[initialQuery, queryNonce\]/);
});

test('meeting search fallback stream completion returns chat state to idle', () => {
  const source = read('src/components/MeetingChatOverlay.tsx');
  const fallbackStart = source.indexOf('const oldDoneCleanup = window.electronAPI?.onGeminiStreamDone(() => {');
  assert.notEqual(fallbackStart, -1, 'fallback done cleanup should exist');

  const fallbackDoneBlock = source.slice(fallbackStart, source.indexOf('const oldErrorCleanup', fallbackStart));
  assert.match(fallbackDoneBlock, /setChatState\('idle'\)/);
});
