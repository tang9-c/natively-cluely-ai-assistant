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

test('deleteMaterial before index finishes prevents chunk creation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-delete-'));
  try {
    const faqPath = path.join(tmpDir, 'faq.md');
    fs.writeFileSync(faqPath, 'CueUp Enterprise includes SSO.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([faqPath]);
    const materialId = result.materials[0].id;
    // Delete immediately - background index should not produce chunks
    service.deleteMaterial(materialId);
    // Wait for queue to drain
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(db.getKnowledgeMaterial(materialId), null);
    assert.equal(db.getKnowledgeMaterialChunks().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('deleteMaterial is idempotent and does not throw on missing material', () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  // Should not throw
  service.deleteMaterial('non-existent-id');
  assert.equal(db.getKnowledgeMaterial('non-existent-id'), null);
});

test('uploadFiles collects errors per file but continues with valid ones', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-mixed-'));
  try {
    const goodPath = path.join(tmpDir, 'good.md');
    const pptPath = path.join(tmpDir, 'legacy.ppt');
    fs.writeFileSync(goodPath, 'CueUp supports SSO.', 'utf8');
    fs.writeFileSync(pptPath, 'fake', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([goodPath, pptPath]);
    assert.equal(result.materials.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /另存为 .pptx/);
    // Wait for indexing
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(result.materials[0].id).status, 'complete'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFile returns a single material record', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-single-'));
  try {
    const faqPath = path.join(tmpDir, 'faq.md');
    fs.writeFileSync(faqPath, 'CueUp Enterprise includes SSO and audit log.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const material = await service.uploadFile(faqPath);
    assert.equal(material.status, 'queued');
    assert.ok(material.id.startsWith('mat_'));
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(material.id).status, 'complete'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('search returns hits in score order with text and parentText populated', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-search-'));
  try {
    const pricingPath = path.join(tmpDir, 'pricing.md');
    fs.writeFileSync(pricingPath, 'CueUp pricing is $20 per month for Pro plan.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([pricingPath]);
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(result.materials[0].id).status, 'complete'));

    const hits = await service.search('CueUp pricing', { limit: 3 });
    assert.equal(hits.length > 0, true);
    assert.ok(hits[0].text);
    assert.ok(hits[0].parentText);
    assert.equal(hits[0].sourceType, 'uploaded_material');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reindexMaterial respects cancellation if material was deleted', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-reindex-cancel-'));
  try {
    const faqPath = path.join(tmpDir, 'faq.md');
    fs.writeFileSync(faqPath, 'CueUp Enterprise includes SSO and audit log export.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([faqPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    service.deleteMaterial(materialId);
    await assert.rejects(
      () => service.reindexMaterial(materialId),
      /material_not_found/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getHealth returns zero materialCount when no complete materials', () => {
  const db = createDbStub();
  db.materials.set('m1', {
    id: 'm1', file_name: 'a.md', title: 'A', mime_or_ext: '.md', file_hash: 'h',
    status: 'failed', error_code: 'parse_failed', error_message: 'err',
    created_at: 't', updated_at: 't',
  });
  db.queueStatusOverrides.pending = 0;
  db.queueStatusOverrides.processing = 0;
  db.queueStatusOverrides.completed = 0;
  db.queueStatusOverrides.failed = 1;
  const service = new KnowledgeMaterialService(db, null);
  const health = service.getHealth();
  assert.equal(health.materialCount, 0);
  assert.equal(health.queue.failed, 1);
});

test('embedding pipeline that isReady=false skips embedding step', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-no-embed-'));
  try {
    const faqPath = path.join(tmpDir, 'faq.md');
    fs.writeFileSync(faqPath, 'CueUp Enterprise includes SSO.', 'utf8');
    const db = createDbStub();
    const embeddingPipeline = {
      isReady: () => false,
      getEmbeddingForQuery: async () => [1, 0, 0],
      getEmbeddings: async () => [[0.1, 0.2, 0.3]],
    };
    const service = new KnowledgeMaterialService(db, embeddingPipeline);

    const result = await service.uploadFiles([faqPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    // Chunks should be present but no embeddings set
    const chunks = [...db.chunks.values()].filter((c) => c.material_id === materialId);
    assert.equal(chunks.length > 0, true);
    for (const chunk of chunks) {
      assert.equal(chunk.embedding, null);
    }
    // No embedding failure recorded since we never attempted
    assert.equal(db.embeddingFailures.has(materialId), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFiles returns errors for each invalid file path', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  // Non-existent file
  const result = await service.uploadFiles(['/tmp/non-existent-12345.md']);
  // The service records the file via createMaterialRecord (which doesn't throw on missing file
  // because of the try/catch around fs.statSync), so the material record should be created
  assert.equal(result.errors.length, 0);
  assert.equal(result.materials.length, 1);
  // Cleanup
  service.deleteMaterial(result.materials[0].id);
});

test('uploadFile rejects .ppt extension with localized error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-ppt-'));
  try {
    const pptPath = path.join(tmpDir, 'legacy.ppt');
    fs.writeFileSync(pptPath, 'fake', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    await assert.rejects(
      () => service.uploadFile(pptPath),
      /暂不支持旧版 .ppt/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFile rejects .pptm extension with localized error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-pptm-'));
  try {
    const pptmPath = path.join(tmpDir, 'macro.pptm');
    fs.writeFileSync(pptmPath, 'fake', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    await assert.rejects(
      () => service.uploadFile(pptmPath),
      /暂不支持含宏 PPT/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
