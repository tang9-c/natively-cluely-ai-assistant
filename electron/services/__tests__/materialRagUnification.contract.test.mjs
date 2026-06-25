import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('global materials and mode reference files share a scope-aware Material RAG retriever', () => {
  const unified = read('electron/services/knowledge/MaterialRagRetriever.ts');
  const knowledge = read('electron/services/knowledge/KnowledgeMaterialService.ts');
  const modeContext = read('electron/services/ModeContextRetriever.ts');
  const modeHybrid = read('electron/services/modes/ModeHybridRetriever.ts');

  assert.match(unified, /export class MaterialRagRetriever/);
  assert.match(unified, /MaterialRagScope/);
  assert.match(unified, /scope:\s*'global' \| 'mode' \| 'scenario' \| 'meeting'/);
  assert.match(unified, /modeId\??:/);
  assert.match(unified, /scenarioType\??:/);
  assert.match(unified, /speaker\??:/);
  assert.match(unified, /timeRange\??:/);
  assert.match(unified, /sourcePriority/);
  assert.match(unified, /usedFallback/);
  assert.match(unified, /rag_lexical_fallback/);

  assert.match(knowledge, /MaterialRagRetriever/);
  assert.match(knowledge, /scope:\s*'global'/);
  assert.match(modeContext, /MaterialRagRetriever/);
  assert.match(modeContext, /scope:\s*'mode'/);
  assert.match(modeHybrid, /MaterialRagRetriever/);
});

test('old ModeHybridRetriever remains as a compatibility adapter, not a second scoring implementation', () => {
  const modeHybrid = read('electron/services/modes/ModeHybridRetriever.ts');

  assert.match(modeHybrid, /compatibility adapter/i);
  assert.doesNotMatch(modeHybrid, /private computeFtsScore/);
  assert.doesNotMatch(modeHybrid, /private performHybridRetrieval/);
  assert.doesNotMatch(modeHybrid, /private performLexicalRetrieval/);
});
