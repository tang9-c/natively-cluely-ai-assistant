import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

test('embedding and RAG runtime stats count batches without retaining input text', () => {
  const pipeline = fs.readFileSync(path.join(root, 'electron/rag/EmbeddingPipeline.ts'), 'utf8');
  const rag = fs.readFileSync(path.join(root, 'electron/rag/RAGManager.ts'), 'utf8');
  assert.match(pipeline, /private embeddingBatchCalls = 0/);
  assert.match(pipeline, /this\.embeddingBatchCalls \+= 1/);
  assert.match(pipeline, /getRuntimeStats\(\): \{ embeddingBatches: number \}/);
  assert.match(rag, /getRuntimeStats\(\)/);
  assert.match(rag, /embeddingBatches/);
});
