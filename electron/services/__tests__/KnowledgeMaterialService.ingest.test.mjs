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

test('upload md with multi-paragraph content produces multiple chunks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-multipara-'));
  try {
    const longPath = path.join(tmpDir, 'long.md');
    const content = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}: some detailed content about topic ${i} and additional context.`).join('\n\n');
    fs.writeFileSync(longPath, content, 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([longPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    const chunks = [...db.chunks.values()].filter((c) => c.material_id === materialId);
    assert.ok(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('upload with embedding pipeline that succeeds sets chunk embeddings', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-embed-ok-'));
  try {
    const mdPath = path.join(tmpDir, 'data.md');
    fs.writeFileSync(mdPath, 'CueUp Enterprise includes SSO and audit log export.', 'utf8');
    const db = createDbStub();
    const embeddingPipeline = {
      isReady: () => true,
      getEmbeddingForQuery: async () => [0.1, 0.2, 0.3],
      getEmbeddings: async (texts) => texts.map((_, i) => [i * 0.1, 0.2, 0.3]),
    };
    const service = new KnowledgeMaterialService(db, embeddingPipeline);
    const result = await service.uploadFiles([mdPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    const chunks = [...db.chunks.values()].filter((c) => c.material_id === materialId);
    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      assert.ok(chunk.embedding instanceof Buffer, 'chunk should have embedding buffer');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createMaterialRecord computes fileHash from stat when file exists', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-hash-'));
  try {
    const mdPath = path.join(tmpDir, 'data.md');
    fs.writeFileSync(mdPath, 'Some content here.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const record = await service.createMaterialRecord(mdPath);
    assert.equal(record.status, 'queued');
    // Real file hash should not start with pending_
    const stored = db.getKnowledgeMaterial(record.id);
    assert.doesNotMatch(stored.file_hash, /^pending_/);
    assert.equal(stored.file_hash.length, 64); // SHA-256 hex
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFile with non-ppt extension is allowed without QCLOUD check', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-noppt-'));
  try {
    const txtPath = path.join(tmpDir, 'data.txt');
    fs.writeFileSync(txtPath, 'Plain text content.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const material = await service.uploadFile(txtPath);
    assert.equal(material.status, 'queued');
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(material.id).status, 'complete'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createMaterialRecord for a path with no extension records unknown mime', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-noext-'));
  try {
    const noExtPath = path.join(tmpDir, 'noext');
    fs.writeFileSync(noExtPath, 'data', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const record = await service.createMaterialRecord(noExtPath);
    // No extension -> not in SUPPORTED_EXTENSIONS -> failed
    assert.equal(record.status, 'failed');
    assert.equal(record.error_code, 'unsupported_file_type');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFiles processes multiple valid files independently', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-multi-'));
  try {
    const f1 = path.join(tmpDir, 'a.md');
    const f2 = path.join(tmpDir, 'b.md');
    const f3 = path.join(tmpDir, 'c.md');
    fs.writeFileSync(f1, 'First document about SSO and audit logs.', 'utf8');
    fs.writeFileSync(f2, 'Second document about pricing tiers.', 'utf8');
    fs.writeFileSync(f3, 'Third document about onboarding steps.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([f1, f2, f3]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.materials.length, 3);
    for (const m of result.materials) {
      await waitFor(() => assert.equal(db.getKnowledgeMaterial(m.id).status, 'complete'));
    }
    // Verify all chunks exist
    assert.equal(db.getKnowledgeMaterialChunks().length, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFiles with all invalid extensions returns only errors', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-allinvalid-'));
  try {
    const csvPath = path.join(tmpDir, 'a.csv');
    const zipPath = path.join(tmpDir, 'b.zip');
    fs.writeFileSync(csvPath, 'a,b', 'utf8');
    fs.writeFileSync(zipPath, 'pk', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([csvPath, zipPath]);
    assert.equal(result.materials.length, 2);
    assert.equal(result.errors.length, 0);
    // Both should be failed
    for (const m of result.materials) {
      assert.equal(m.status, 'failed');
      assert.equal(m.error_code, 'unsupported_file_type');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('search returns zero hits when query is unrelated to indexed content', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-nohit-'));
  try {
    const mdPath = path.join(tmpDir, 'data.md');
    fs.writeFileSync(mdPath, 'CueUp pricing is $20 monthly for Pro.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    await service.uploadFiles([mdPath]);
    await waitFor(() => assert.equal(db.listKnowledgeMaterials().filter((m) => m.status === 'complete').length, 1));

    const hits = await service.search('completely unrelated term xyz123abc', { limit: 3 });
    assert.equal(hits.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('embedding pipeline getEmbeddings returns one per chunk does not crash indexing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-short-embed-'));
  try {
    const mdPath = path.join(tmpDir, 'data.md');
    // Force multiple chunks by using long paragraphs
    const content = Array.from({ length: 10 }, (_, i) =>
      `Para ${i} ${'content text '.repeat(40)} more details.`
    ).join('\n\n');
    fs.writeFileSync(mdPath, content, 'utf8');
    const db = createDbStub();
    const embeddingPipeline = {
      isReady: () => true,
      getEmbeddingForQuery: async () => [0.1, 0.2, 0.3],
      getEmbeddings: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
    };
    const service = new KnowledgeMaterialService(db, embeddingPipeline);
    const result = await service.uploadFiles([mdPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));
    const chunks = [...db.chunks.values()].filter((c) => c.material_id === materialId);
    assert.ok(chunks.length >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reindexMaterial on a material with no prior chunks rethrows material_has_no_indexable_text', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-reindex-nochunks-'));
  try {
    const mdPath = path.join(tmpDir, 'data.md');
    fs.writeFileSync(mdPath, 'content', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const record = await service.createMaterialRecord(mdPath);
    // No chunks yet
    await assert.rejects(
      () => service.reindexMaterial(record.id),
      /material_has_no_indexable_text/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
