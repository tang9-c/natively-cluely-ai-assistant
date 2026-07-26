import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const embeddingSpacePath = path.resolve(
  'dist-electron/electron/rag/embeddingSpace.js',
);

test('QCLOUD embedding space uses the canonical backing model', async () => {
  const { embeddingSpaceKey } = await import(pathToFileURL(embeddingSpacePath).href);

  assert.equal(
    embeddingSpaceKey({
      name: 'qcloud',
      model: 'doubao-embedding-vision-251215',
      dimensions: 4096,
    }),
    'qcloud:doubao-embedding-vision-251215:4096',
  );
});

test('QCLOUD and direct Doubao remain separate spaces at equal dimensions', async () => {
  const { embeddingSpaceKey } = await import(pathToFileURL(embeddingSpacePath).href);
  const qcloud = embeddingSpaceKey({
    name: 'qcloud',
    model: 'doubao-embedding-vision-251215',
    dimensions: 4096,
  });
  const doubao = embeddingSpaceKey({
    name: 'doubao',
    model: 'doubao-embedding-vision-251215',
    dimensions: 4096,
  });

  assert.notEqual(qcloud, doubao);
});
