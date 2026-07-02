import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadResolver() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/context/AnswerCitationResolver.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function createDbStub(overrides = {}) {
  return {
    getKnowledgeMaterial: () => ({
      id: 'mat_security',
      title: 'security.md',
      file_hash: 'file_hash_v1',
      updated_at: '2026-07-01T00:00:00.000Z',
    }),
    getKnowledgeMaterialChunkById: () => ({
      id: 42,
      material_id: 'mat_security',
      cleaned_text: 'SOC2 Type II completed in 2025.',
      parent_text: 'SOC2 Type II completed in 2025. GDPR supported.',
      title: 'security.md',
      file_hash: 'file_hash_v1',
      material_updated_at: '2026-07-01T00:00:00.000Z',
    }),
    ...overrides,
  };
}

test('uploaded material citation resolves only when chunk hash still matches', async () => {
  const { buildUploadedMaterialCitation, resolveAnswerCitation } = await loadResolver();
  const citation = buildUploadedMaterialCitation({
    sourceType: 'uploaded_material',
    sourceId: 'mat_security',
    chunkId: 42,
    score: 0.91,
    title: 'security.md',
    text: 'SOC2 Type II completed in 2025.',
    parentText: 'SOC2 Type II completed in 2025. GDPR supported.',
    fileHash: 'file_hash_v1',
    materialUpdatedAt: '2026-07-01T00:00:00.000Z',
  });

  const resolved = resolveAnswerCitation(createDbStub(), citation);

  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.chunk.id, 42);
  assert.match(resolved.previewText, /SOC2 Type II completed/);
});

test('uploaded material citation becomes stale when chunk text changes', async () => {
  const { buildUploadedMaterialCitation, resolveAnswerCitation } = await loadResolver();
  const citation = buildUploadedMaterialCitation({
    sourceType: 'uploaded_material',
    sourceId: 'mat_security',
    chunkId: 42,
    score: 0.91,
    title: 'security.md',
    text: 'SOC2 Type II completed in 2025.',
    parentText: 'SOC2 Type II completed in 2025. GDPR supported.',
    fileHash: 'file_hash_v1',
    materialUpdatedAt: '2026-07-01T00:00:00.000Z',
  });

  const resolved = resolveAnswerCitation(
    createDbStub({
      getKnowledgeMaterialChunkById: () => ({
        id: 42,
        material_id: 'mat_security',
        cleaned_text: 'SOC2 Type II is planned but not complete.',
        parent_text: 'SOC2 Type II is planned but not complete.',
        title: 'security.md',
        file_hash: 'file_hash_v1',
        material_updated_at: '2026-07-01T00:00:00.000Z',
      }),
    }),
    citation,
  );

  assert.equal(resolved.status, 'stale-citation');
  assert.equal(resolved.chunk, null);
});

test('uploaded material citation becomes missing when chunk was deleted', async () => {
  const { buildUploadedMaterialCitation, resolveAnswerCitation } = await loadResolver();
  const citation = buildUploadedMaterialCitation({
    sourceType: 'uploaded_material',
    sourceId: 'mat_security',
    chunkId: 42,
    score: 0.91,
    title: 'security.md',
    text: 'SOC2 Type II completed in 2025.',
    parentText: 'SOC2 Type II completed in 2025.',
    fileHash: 'file_hash_v1',
    materialUpdatedAt: '2026-07-01T00:00:00.000Z',
  });

  const resolved = resolveAnswerCitation(
    createDbStub({
      getKnowledgeMaterialChunkById: () => null,
    }),
    citation,
  );

  assert.equal(resolved.status, 'missing-citation');
  assert.equal(resolved.chunk, null);
});
