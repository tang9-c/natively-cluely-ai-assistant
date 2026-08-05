import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalEmbeddingProvider } from '../../../dist-electron/electron/rag/providers/LocalEmbeddingProvider.js';

test('embedBatch bounds local inference batches and preserves vector order', async () => {
  const provider = new LocalEmbeddingProvider();
  const calls = [];

  provider.pipe = async (input) => {
    const texts = Array.isArray(input) ? input : [input];
    calls.push([...texts]);
    const data = new Float32Array(texts.length * provider.dimensions);
    texts.forEach((text, index) => {
      data[index * provider.dimensions] = Number(text.slice('chunk-'.length));
    });
    return { data };
  };

  const texts = Array.from({ length: 48 }, (_, index) => `chunk-${index}`);
  const vectors = await provider.embedBatch(texts);

  assert.equal(calls.length, 48);
  assert.ok(calls.every((batch) => batch.length <= 1));
  assert.equal(vectors.length, 48);
  assert.ok(vectors.every((vector) => vector.length === 384));
  assert.deepEqual(vectors.map((vector) => vector[0]), texts.map((_, index) => index));
});

test('embedBatch returns an empty result without invoking the local pipeline', async () => {
  const provider = new LocalEmbeddingProvider();
  let callCount = 0;
  provider.pipe = async () => {
    callCount += 1;
    return { data: new Float32Array() };
  };

  assert.deepEqual(await provider.embedBatch([]), []);
  assert.equal(callCount, 0);
});
