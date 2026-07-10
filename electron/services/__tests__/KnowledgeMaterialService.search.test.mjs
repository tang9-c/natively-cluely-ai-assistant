import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KnowledgeMaterialService } = require('../../../dist-electron/electron/services/knowledge/KnowledgeMaterialService.js');

function createDbStub() {
  const materials = new Map();
  const chunks = new Map();
  const embeddingFailures = new Map();
  const queueStatusOverrides = { pending: 0, processing: 0, completed: 0, failed: 0 };
  let nextChunkId = 1;

  return {
    materials,
    chunks,
    embeddingFailures,
    queueStatusOverrides,
    upsertKnowledgeMaterial(input) {
      const now = new Date().toISOString();
      const row = {
        id: input.id,
        file_name: input.fileName,
        title: input.title ?? input.fileName,
        mime_or_ext: input.mimeOrExt,
        file_hash: input.fileHash,
        status: input.status ?? 'queued',
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null,
        created_at: now,
        updated_at: now,
      };
      materials.set(input.id, row);
      return row;
    },
    getKnowledgeMaterial(id) {
      const material = materials.get(id);
      return material && material.status !== 'deleted' ? { ...material } : null;
    },
    listKnowledgeMaterials() {
      return [...materials.values()].filter((m) => m.status !== 'deleted').map((m) => ({ ...m }));
    },
    updateKnowledgeMaterialStatus(id, status, error) {
      const material = materials.get(id);
      if (!material) return;
      if (material.status === 'deleted' && status !== 'deleted') return;
      material.status = status;
      material.error_code = error?.code ?? null;
      material.error_message = error?.message ?? null;
      material.updated_at = new Date().toISOString();
    },
    markKnowledgeMaterialEmbeddingsFailed(materialId, message) {
      embeddingFailures.set(materialId, message || 'embedding_failed');
    },
    replaceKnowledgeMaterialChunks(materialId, inputChunks) {
      for (const [id, chunk] of chunks) {
        if (chunk.material_id === materialId) chunks.delete(id);
      }
      const ids = [];
      for (const chunk of inputChunks) {
        const id = nextChunkId++;
        ids.push(id);
        chunks.set(id, {
          id,
          material_id: materialId,
          chunk_index: chunk.chunkIndex,
          cleaned_text: chunk.cleanedText,
          parent_text: chunk.parentText,
          token_count: chunk.tokenCount,
          embedding: null,
        });
      }
      return ids;
    },
    setKnowledgeMaterialChunkEmbedding(id, embedding) {
      const chunk = chunks.get(id);
      if (chunk) chunk.embedding = Buffer.from(new Float32Array(embedding).buffer);
    },
    getKnowledgeMaterialChunks() {
      return [...chunks.values()]
        .filter((chunk) => materials.get(chunk.material_id)?.status === 'complete')
        .map((chunk) => {
          const material = materials.get(chunk.material_id);
          return {
            ...chunk,
            file_name: material.file_name,
            title: material.title,
            file_hash: material.file_hash,
            material_updated_at: material.updated_at,
          };
        });
    },
    deleteKnowledgeMaterial(id) {
      const material = materials.get(id);
      if (!material) return;
      material.status = 'deleted';
      for (const [chunkId, chunk] of chunks) {
        if (chunk.material_id === id) chunks.delete(chunkId);
      }
    },
    getMaterialQueueStatus() {
      return { ...queueStatusOverrides };
    },
  };
}

async function waitFor(assertion, timeoutMs = 2000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError;
}

test('listMaterials includes failed and complete materials together', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-list-'));
  try {
    const goodPath = path.join(tmpDir, 'good.md');
    const rtfPath = path.join(tmpDir, 'bad.rtf');
    fs.writeFileSync(goodPath, 'CueUp Enterprise includes SSO.', 'utf8');
    fs.writeFileSync(rtfPath, 'unsupported', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([goodPath, rtfPath]);
    assert.equal(result.materials.length, 2);
    const goodMaterial = result.materials.find((m) => m.status === 'queued');
    const badMaterial = result.materials.find((m) => m.status === 'failed');
    assert.ok(goodMaterial);
    assert.ok(badMaterial);
    assert.equal(badMaterial.error_code, 'unsupported_file_type');

    await waitFor(() => assert.equal(db.getKnowledgeMaterial(goodMaterial.id).status, 'complete'));

    const all = service.listMaterials();
    assert.equal(all.length, 2);
    const statuses = all.map((m) => m.status).sort();
    assert.deepEqual(statuses, ['complete', 'failed']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('listMaterials returns empty array when no materials exist', () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  assert.deepEqual(service.listMaterials(), []);
});

test('searchWithDiagnostics returns hit with sourceId as materialId prefix when chunk is matched', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-sourceid-'));
  try {
    const pricingPath = path.join(tmpDir, 'pricing.md');
    fs.writeFileSync(pricingPath, 'CueUp pricing is $20 per user per month for Pro plan.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([pricingPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    const searchResult = await service.searchWithDiagnostics('CueUp pricing', { limit: 3 });
    assert.equal(searchResult.hits.length > 0, true);
    assert.equal(searchResult.hits[0].sourceId, materialId);
    assert.equal(typeof searchResult.hits[0].chunkId, 'number');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('searchWithDiagnostics falls back gracefully when no candidateReader and rows missing', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  const result = await service.searchWithDiagnostics('absent', { limit: 1 });
  assert.deepEqual(result.hits, []);
  assert.equal(result.degradedReason, undefined);
});

test('searchWithDiagnostics with options.limit > candidateLimit still works', async () => {
  const db = createDbStub();
  db.getKnowledgeMaterialCandidateChunks = (query, options) => {
    assert.equal(options.limit, 10);
    assert.equal(options.candidateLimit, 5);
    return [];
  };
  const service = new KnowledgeMaterialService(db, null);
  const result = await service.searchWithDiagnostics('test', { limit: 10, candidateLimit: 5 });
  assert.deepEqual(result.hits, []);
});

test('createMaterialRecord returns __filePath for queued records but not failed ones', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-rec-'));
  try {
    const mdPath = path.join(tmpDir, 'a.md');
    const zipPath = path.join(tmpDir, 'b.zip');
    fs.writeFileSync(mdPath, 'Some content.', 'utf8');
    fs.writeFileSync(zipPath, 'pk', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const mdRecord = await service.createMaterialRecord(mdPath);
    assert.equal(mdRecord.status, 'queued');
    assert.equal(mdRecord.__filePath, mdPath);

    const zipRecord = await service.createMaterialRecord(zipPath);
    assert.equal(zipRecord.status, 'failed');
    assert.equal(zipRecord.__filePath, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createMaterialRecord records errorMessage for unsupported extension', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-err-msg-'));
  try {
    const csvPath = path.join(tmpDir, 'data.csv');
    fs.writeFileSync(csvPath, 'a,b,c', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const record = await service.createMaterialRecord(csvPath);
    assert.equal(record.status, 'failed');
    assert.equal(record.error_code, 'unsupported_file_type');
    assert.match(record.error_message, /PDF|DOCX|Markdown|TXT/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFiles with empty array returns empty results', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  const result = await service.uploadFiles([]);
  assert.deepEqual(result.materials, []);
  assert.deepEqual(result.errors, []);
});

test('searchWithDiagnostics reports degradedReason when embedding pipeline throws mid-search', async () => {
  const db = createDbStub();
  db.materials.set('m1', {
    id: 'm1', file_name: 'a.md', title: 'A', mime_or_ext: '.md', file_hash: 'h',
    status: 'complete', error_code: null, error_message: null,
    created_at: 't', updated_at: 't',
  });
  db.chunks.set(1, {
    id: 1,
    material_id: 'm1',
    chunk_index: 0,
    cleaned_text: 'Pricing is $20 monthly',
    parent_text: 'Pricing is $20 monthly',
    token_count: 4,
    embedding: null,
  });
  const embeddingPipeline = {
    isReady: () => true,
    getEmbeddingForQuery: async () => {
      throw new Error('provider exploded');
    },
    getEmbeddings: async () => [],
  };
  const service = new KnowledgeMaterialService(db, embeddingPipeline);
  const result = await service.searchWithDiagnostics('pricing', { limit: 3 });
  assert.equal(result.hits.length > 0, true);
  // Either embedding_unavailable or hybrid_threw depending on retriever path
  assert.ok(result.degradedReason);
});

test('searchWithDiagnostics includes fileHash and materialUpdatedAt in hit', async () => {
  const db = createDbStub();
  db.materials.set('m1', {
    id: 'm1', file_name: 'a.md', title: 'A', mime_or_ext: '.md', file_hash: 'h-unique-123',
    status: 'complete', error_code: null, error_message: null,
    created_at: 't', updated_at: '2024-06-15T00:00:00Z',
  });
  db.chunks.set(1, {
    id: 1,
    material_id: 'm1',
    chunk_index: 0,
    cleaned_text: 'CueUp supports SSO enterprise',
    parent_text: 'CueUp supports SSO enterprise',
    token_count: 4,
    embedding: null,
  });
  const service = new KnowledgeMaterialService(db, null);
  const result = await service.searchWithDiagnostics('SSO', { limit: 1 });
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].fileHash, 'h-unique-123');
  assert.equal(result.hits[0].materialUpdatedAt, '2024-06-15T00:00:00Z');
});
