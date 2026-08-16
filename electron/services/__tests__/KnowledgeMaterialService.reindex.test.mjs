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

test('reindexMaterial throws when material does not exist', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);

  await assert.rejects(
    () => service.reindexMaterial('mat_does_not_exist'),
    /material_not_found/,
  );
});

test('reindexMaterial throws when there is no indexable text from prior chunks', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  const filePath = path.join(os.tmpdir(), `kms-empty-${Date.now()}.md`);
  fs.writeFileSync(filePath, 'placeholder', 'utf8');
  try {
    const record = await service.createMaterialRecord(filePath);
    await assert.rejects(
      () => service.reindexMaterial(record.id),
      /material_has_no_indexable_text/,
    );
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

test('reindexMaterial rebuilds material from previously indexed chunks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-reindex-'));
  try {
    const faqPath = path.join(tmpDir, 'faq.md');
    fs.writeFileSync(
      faqPath,
      'CueUp Enterprise includes SSO and audit log export.\n\nThe refund window is 14 days.',
      'utf8',
    );
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([faqPath]);
    const materialId = result.materials[0].id;

    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    const reindexed = await service.reindexMaterial(materialId);
    assert.equal(reindexed.id, materialId);
    assert.equal(reindexed.status, 'complete');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reindexMaterial is idempotent for overlapping multi-chunk Chinese text', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-reindex-idempotent-'));
  try {
    const filePath = path.join(tmpDir, 'long.md');
    const content = Array.from(
      { length: 80 },
      (_, index) => `第${index}段介绍知识源索引的唯一业务事实${String(index).padStart(3, '0')}，用于验证连续重建不会复制重叠文本。`,
    ).join('\n\n');
    fs.writeFileSync(filePath, content, 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([filePath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    const snapshot = () => [...db.chunks.values()]
      .filter((chunk) => chunk.material_id === materialId)
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map((chunk) => chunk.cleaned_text);
    const initial = snapshot();
    assert.ok(initial.length > 1);

    await service.reindexMaterial(materialId);
    const afterFirst = snapshot();
    await service.reindexMaterial(materialId);
    const afterSecond = snapshot();

    assert.deepEqual(afterFirst, initial);
    assert.deepEqual(afterSecond, initial);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reindexMaterial does not collapse a short coincidental boundary match', async () => {
  const db = createDbStub();
  db.materials.set('mat-boundary', {
    id: 'mat-boundary',
    file_name: 'boundary.md',
    title: 'boundary.md',
    mime_or_ext: '.md',
    file_hash: 'boundary-hash',
    status: 'complete',
    created_at: '2026-08-16T00:00:00Z',
    updated_at: '2026-08-16T00:00:00Z',
  });
  db.chunks.set(1, {
    id: 1,
    material_id: 'mat-boundary',
    chunk_index: 0,
    cleaned_text: '第一部分以共同',
    parent_text: '第一部分以共同',
    token_count: 4,
    embedding: null,
  });
  db.chunks.set(2, {
    id: 2,
    material_id: 'mat-boundary',
    chunk_index: 1,
    cleaned_text: '共同开始第二部分',
    parent_text: '共同开始第二部分',
    token_count: 4,
    embedding: null,
  });
  const service = new KnowledgeMaterialService(db, null);

  await service.reindexMaterial('mat-boundary');

  const rebuilt = [...db.chunks.values()].find((chunk) => chunk.material_id === 'mat-boundary');
  assert.equal(rebuilt.cleaned_text, '第一部分以共同\n\n共同开始第二部分');
});

test('searchWithDiagnostics falls back to full chunk scan when candidateReader is missing', async () => {
  const db = createDbStub();
  // pre-existing chunks: include some non-matching and one matching
  db.materials.set('mat-existing', {
    id: 'mat-existing',
    file_name: 'pricing.md',
    title: 'Pricing',
    mime_or_ext: '.md',
    file_hash: 'h1',
    status: 'complete',
    error_code: null,
    error_message: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  });
  db.chunks.set(1, {
    id: 1,
    material_id: 'mat-existing',
    chunk_index: 0,
    cleaned_text: 'CueUp pricing is $20 per user per month for Pro plan.',
    parent_text: 'CueUp pricing is $20 per user per month for Pro plan.',
    token_count: 10,
    embedding: null,
  });
  db.chunks.set(2, {
    id: 2,
    material_id: 'mat-existing',
    chunk_index: 1,
    cleaned_text: 'Marketing tagline: meetings made easy.',
    parent_text: 'Marketing tagline: meetings made easy.',
    token_count: 5,
    embedding: null,
  });

  // Make sure no candidate reader exists
  assert.equal(typeof db.getKnowledgeMaterialCandidateChunks, 'undefined');

  const service = new KnowledgeMaterialService(db, null);
  const result = await service.searchWithDiagnostics('pricing', { limit: 5, candidateLimit: 50 });

  assert.equal(result.hits.length > 0, true);
  // The first hit should mention pricing
  assert.match(result.hits[0].text, /pricing|20|user/i);
});

test('searchWithDiagnostics returns empty hits when no rows are available', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  const result = await service.searchWithDiagnostics('anything', { limit: 5 });
  assert.deepEqual(result.hits, []);
});

test('getHealth returns materialCount based on complete materials only', () => {
  const db = createDbStub();
  db.materials.set('mat-1', {
    id: 'mat-1', file_name: 'a.md', title: 'A', mime_or_ext: '.md', file_hash: 'h',
    status: 'complete', error_code: null, error_message: null,
    created_at: 't', updated_at: 't',
  });
  db.materials.set('mat-2', {
    id: 'mat-2', file_name: 'b.md', title: 'B', mime_or_ext: '.md', file_hash: 'h',
    status: 'failed', error_code: 'parse_failed', error_message: 'err',
    created_at: 't', updated_at: 't',
  });
  db.materials.set('mat-3', {
    id: 'mat-3', file_name: 'c.md', title: 'C', mime_or_ext: '.md', file_hash: 'h',
    status: 'queued', error_code: null, error_message: null,
    created_at: 't', updated_at: 't',
  });
  db.queueStatusOverrides.pending = 1;
  db.queueStatusOverrides.processing = 0;
  db.queueStatusOverrides.completed = 1;
  db.queueStatusOverrides.failed = 1;

  const service = new KnowledgeMaterialService(db, null);
  const health = service.getHealth();
  assert.equal(health.materialCount, 1);
  assert.equal(health.queue.pending, 1);
  assert.equal(health.queue.completed, 1);
  assert.equal(health.queue.failed, 1);
});

test('listMaterials returns non-deleted materials in stub order', () => {
  const db = createDbStub();
  db.materials.set('a', {
    id: 'a', file_name: 'a.md', title: 'A', mime_or_ext: '.md', file_hash: 'h',
    status: 'complete', error_code: null, error_message: null,
    created_at: 't', updated_at: 't',
  });
  db.materials.set('b', {
    id: 'b', file_name: 'b.md', title: 'B', mime_or_ext: '.md', file_hash: 'h',
    status: 'deleted', error_code: null, error_message: null,
    created_at: 't', updated_at: 't',
  });

  const service = new KnowledgeMaterialService(db, null);
  const materials = service.listMaterials();
  assert.equal(materials.length, 1);
  assert.equal(materials[0].id, 'a');
});

test('createMaterialRecord falls back to pending hash when file stat fails', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  const missingPath = path.join(os.tmpdir(), `kms-missing-${Date.now()}-${Math.random()}.md`);
  // file does not exist
  const record = await service.createMaterialRecord(missingPath);
  assert.equal(record.status, 'queued');
  // fileHash should start with "pending_"
  const stored = db.getKnowledgeMaterial(record.id);
  assert.match(stored.file_hash, /^pending_/);
  // Cleanup: mark as deleted to not pollute other tests
  service.deleteMaterial(record.id);
});

test('createMaterialRecord returns a failed record with unsupported_file_type for .zip', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  const zipPath = path.join(os.tmpdir(), `kms-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, 'pk', 'utf8');
  try {
    const record = await service.createMaterialRecord(zipPath);
    assert.equal(record.status, 'failed');
    assert.equal(record.error_code, 'unsupported_file_type');
    assert.match(record.error_message, /不支持的文件类型/);
  } finally {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }
});
