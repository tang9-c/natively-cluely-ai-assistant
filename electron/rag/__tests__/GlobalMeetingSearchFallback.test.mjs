import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('global RAG search falls back to lexical meeting title/summary/transcript matches', () => {
  const retriever = read('electron/rag/RAGRetriever.ts');
  const vectorStore = read('electron/rag/VectorStore.ts');

  assert.match(retriever, /searchLexicalMeetings\(retrievalQuery/);
  assert.match(retriever, /mergeHybridCandidates\(chunkResults,\s*meetingFallbackResults/);
  assert.doesNotMatch(retriever, /chunkResults\.length\s*===\s*0[\s\S]{0,120}searchLexicalMeetings/);

  assert.match(vectorStore, /async searchLexicalMeetings\(/);
  assert.match(vectorStore, /m\.title/);
  assert.match(vectorStore, /m\.summary_json/);
  assert.match(vectorStore, /transcripts/);
  assert.match(vectorStore, /Product Price And Case Discussion|meeting title/i);
});
