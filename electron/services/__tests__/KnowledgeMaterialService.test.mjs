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
  let nextChunkId = 1;

  return {
    materials,
    chunks,
    embeddingFailures,
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
      return [...materials.values()].filter((material) => material.status !== 'deleted').map((material) => ({ ...material }));
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
      return { pending: 0, processing: 0, completed: 0, failed: embeddingFailures.size };
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

test('uploadFiles returns queued records before background indexing completes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-service-'));
  try {
    const faqPath = path.join(tmpDir, 'cueup-faq.md');
    fs.writeFileSync(
      faqPath,
      'CueUp Enterprise includes SSO and audit log export.\n\nThe refund window is 14 days.',
      'utf8',
    );
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([faqPath]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.materials.length, 1);
    assert.equal(result.materials[0].status, 'queued');

    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));

    const hits = await service.search('SSO audit log refund', { limit: 2 });
    assert.equal(hits.length > 0, true);
    assert.match(hits[0].text, /SSO|refund|audit/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parse failure leaves a failed material record with a readable error', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-service-'));
  try {
    const binaryPath = path.join(tmpDir, 'broken.txt');
    fs.writeFileSync(binaryPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([binaryPath]);
    assert.equal(result.errors.length, 0);
    const materialId = result.materials[0].id;

    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'failed');
      assert.equal(material.error_code, 'binary_text_file');
      assert.match(material.error_message, /二进制内容/);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('unsupported files are recorded as failed without entering the index queue', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-service-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'not supported', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const result = await service.uploadFiles([pptxPath]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.materials.length, 1);
    assert.equal(result.materials[0].status, 'failed');
    assert.equal(result.materials[0].error_code, 'unsupported_file_type');
    assert.equal(db.getKnowledgeMaterialChunks().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('embedding failure still completes text indexing for lexical fallback', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-service-'));
  try {
    const faqPath = path.join(tmpDir, 'cueup-faq.txt');
    fs.writeFileSync(faqPath, 'CueUp Enterprise includes SSO and audit log export.', 'utf8');
    const db = createDbStub();
    const embeddingPipeline = {
      isReady: () => true,
      getEmbeddingForQuery: async () => [1, 0, 0],
      getEmbeddings: async () => {
        throw new Error('embedding provider unavailable');
      },
    };
    const service = new KnowledgeMaterialService(db, embeddingPipeline);

    const result = await service.uploadFiles([faqPath]);
    const materialId = result.materials[0].id;

    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'complete');
      assert.equal(material.error_code, null);
    });
    assert.equal(db.getMaterialQueueStatus().failed, 1);
    const searchResult = await service.searchWithDiagnostics('SSO audit log', { limit: 1 });
    assert.equal(searchResult.degradedReason, 'hybrid_threw');
    assert.equal(searchResult.hits.length, 1);
    assert.match(searchResult.hits[0].text, /SSO and audit log/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('deleted material is not revived by a later background index task', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-service-'));
  try {
    const faqPath = path.join(tmpDir, 'cueup-faq.md');
    fs.writeFileSync(faqPath, 'CueUp Enterprise includes SSO and audit log export.', 'utf8');
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);

    const material = await service.createMaterialRecord(faqPath);
    service.deleteMaterial(material.id);
    await service.indexMaterialFromFile(material.id, faqPath);

    assert.equal(db.getKnowledgeMaterial(material.id), null);
    assert.equal(db.getKnowledgeMaterialChunks().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
