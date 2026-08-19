import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');

test('main does not feed merged transcript prefixes into live RAG twice', () => {
  const anchor = mainSource.indexOf('private routeTranscriptPayload');
  assert.ok(anchor >= 0, 'shared transcript route should feed live RAG');
  const block = mainSource.slice(anchor, anchor + 1_500);

  assert.match(block, /mergedIntoPrevious/);
  assert.match(block, /routedPayload\.final[\s\S]*!transcriptResult\?\.mergedIntoPrevious/);
  assert.match(block, /feedLiveTranscript/);
});
