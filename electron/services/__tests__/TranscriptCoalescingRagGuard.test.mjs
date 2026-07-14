import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');

test('main does not feed merged transcript prefixes into live RAG twice', () => {
  const anchor = mainSource.indexOf('// Feed final transcript to JIT RAG indexer');
  assert.ok(anchor >= 0, 'main transcript handler should feed live RAG');
  const block = mainSource.slice(anchor, anchor + 600);

  assert.match(block, /mergedIntoPrevious/);
  assert.match(block, /if\s*\(\s*!transcriptResult\?\.mergedIntoPrevious\s*\)/);
  assert.match(block, /feedLiveTranscript/);
});

