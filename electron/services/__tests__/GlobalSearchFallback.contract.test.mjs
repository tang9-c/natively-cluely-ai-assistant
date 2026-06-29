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
