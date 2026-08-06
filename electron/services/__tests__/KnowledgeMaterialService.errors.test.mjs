import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);
const {
  KnowledgeMaterialService,
  classifyMaterialIndexError,
  toUserFacingMaterialError,
} = require('../../../dist-electron/electron/services/knowledge/KnowledgeMaterialService.js');

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

// Helper to install a CredentialsManager stub via require.cache injection
test('checkPptxQCloudAvailability defaults: missing key + non-natively provider -> unavailable', async () => {
  // Stub the CredentialsManager by pre-populating require.cache for its resolved path.
  // The service does `require('../CredentialsManager')` lazily, so we resolve that
  // path from the service file and inject a fake module.
  const credsPath = require.resolve('../../../dist-electron/electron/services/CredentialsManager.js');
  const originalCacheEntry = require.cache[credsPath];
  const fakeModule = new Module(credsPath);
  fakeModule.filename = credsPath;
  fakeModule.loaded = true;
  fakeModule.exports = {
    CredentialsManager: class {
      static getInstance() { return new (class { getDefaultModel() { return 'openai'; } getNativelyApiKey() { return null; } })(); }
    },
  };
  require.cache[credsPath] = fakeModule;
  try {
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-qcloud-'));
    try {
      const pptxPath = path.join(tmpDir, 'deck.pptx');
      fs.writeFileSync(pptxPath, 'fake pptx', 'utf8');
      const result = await service.uploadFiles([pptxPath]);
      assert.equal(result.materials.length, 0);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].error, /PPTX 知识源需要先配置并选择 QCLOUD API/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    if (originalCacheEntry) require.cache[credsPath] = originalCacheEntry;
    else delete require.cache[credsPath];
  }
});

test('checkPptxQCloudAvailability defaults: key present + natively provider -> allows upload', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: (indexPreparedChunks) => ({
      ingest: async (materialId) => {
        await indexPreparedChunks(materialId, [
          {
            materialId,
            chunkIndex: 0,
            parentChunkIndex: 0,
            cleanedText: 'Slide 1 text',
            parentText: 'Slide 1 text',
            tokenCount: 3,
            metadata: { source_format: 'pptx', slide_index: 1 },
          },
        ]);
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-qcloud-ok-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake pptx', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.materials.length, 1);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('indexMaterialFromFile records failed status when extraction throws on non-existent file', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null);
  // Use a non-existent file path -> DocumentTextExtractor throws "not a regular file"
  const fakePath = path.join(os.tmpdir(), `kms-not-real-${Date.now()}-${Math.random()}.md`);
  const record = await service.createMaterialRecord(fakePath);
  // Manually drive the index queue; the path doesn't exist so extraction should fail
  await service.indexMaterialFromFile(record.id, fakePath);
  const after = db.getKnowledgeMaterial(record.id);
  assert.equal(after.status, 'failed');
  assert.ok(after.error_code, 'should set an error code');
  service.deleteMaterial(record.id);
});

test('PDF native canvas failures are classified as a missing parser component', () => {
  const error = new Error('Could not parse document. DOMMatrix is not defined');
  assert.equal(classifyMaterialIndexError(error), 'pdf_parser_component_missing');
  assert.equal(toUserFacingMaterialError(error), 'PDF 解析组件缺失，请更新或重新安装 CueUp 后重试。');
});

test('PDF runtime failures preserve actionable timeout, worker, and access error codes', () => {
  const cases = [
    [{ code: 'pdf_parse_timeout' }, 'PDF 解析超时，请重试；如果仍失败，请拆分文件后重新上传。'],
    [{ code: 'pdf_worker_failed' }, 'PDF 解析进程异常，请重试上传。'],
    [{ code: 'pdf_access_failed' }, 'CueUp 无法继续读取该 PDF，请重新选择文件后上传。'],
  ];
  for (const [error, expectedMessage] of cases) {
    assert.equal(classifyMaterialIndexError(error), error.code);
    assert.equal(toUserFacingMaterialError(error), expectedMessage);
  }
});

test('PPTX render stages preserve actionable process error codes without blaming the file', () => {
  const cases = [
    [{ code: 'pptx_render_timeout' }, 'PPTX 渲染超时，请重试；如果仍失败，请拆分文件后重新上传。'],
    [{ code: 'pptx_render_process_start_failed' }, 'PPTX 渲染进程无法启动，请重启 CueUp 后重试。'],
    [{ code: 'pptx_render_process_crashed' }, 'PPTX 渲染进程异常退出，请重试上传。'],
    [{ code: 'pptx_render_child_failed' }, 'PPTX 渲染失败，请重试上传。'],
    [{ code: 'pptx_render_failed' }, 'PPTX 渲染失败，请重试上传。'],
  ];
  for (const [error, expectedMessage] of cases) {
    assert.equal(classifyMaterialIndexError(error), error.code);
    assert.equal(toUserFacingMaterialError(error), expectedMessage);
    assert.doesNotMatch(expectedMessage, /另存为标准/);
  }
});

test('searchWithDiagnostics uses candidateReader when present and reports degradedReason', async () => {
  const db = createDbStub();
  db.getKnowledgeMaterialCandidateChunks = (query, options) => {
    assert.equal(query, 'pricing');
    return [{
      id: 1,
      material_id: 'mat-x',
      chunk_index: 0,
      cleaned_text: 'CueUp pricing starts at $20 per user per month.',
      parent_text: 'CueUp pricing starts at $20 per user per month.',
      token_count: 10,
      embedding: null,
      file_name: 'p.md',
      title: 'P',
      file_hash: 'h',
      material_updated_at: 'now',
    }];
  };
  const embeddingPipeline = {
    isReady: () => true,
    getEmbeddingForQuery: async () => {
      throw new Error('embedding unavailable');
    },
    getEmbeddings: async () => [],
  };
  const service = new KnowledgeMaterialService(db, embeddingPipeline);
  const result = await service.searchWithDiagnostics('pricing', { limit: 5 });
  assert.equal(result.hits.length, 1);
  // Embedding pipeline throws -> degradedReason expected
  assert.ok(result.degradedReason === 'embedding_unavailable' || result.degradedReason === 'hybrid_threw',
    `expected degradedReason, got ${result.degradedReason}`);
});

test('createDefaultPptxIngestionService path: missing options.createPptxIngestionService fails with module not found gracefully', async () => {
  const db = createDbStub();
  // Provide getQCloudAvailability so assertUploadAllowed passes
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    // No createPptxIngestionService -> falls through to createDefaultPptxIngestionService
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-default-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake pptx', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    // Material record is created and queue starts
    assert.equal(result.errors.length, 0);
    assert.equal(result.materials.length, 1);
    // Wait for it to enter indexing or fail (default service may try to load native modules)
    await waitFor(() => {
      const material = db.getKnowledgeMaterial(result.materials[0].id);
      assert.ok(material.status === 'complete' || material.status === 'failed',
        `expected terminal status, got ${material.status}`);
    }, 5000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('embedding pipeline getEmbeddings throws mid-batch is captured and material still completes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-fail-'));
  try {
    const faqPath = path.join(tmpDir, 'faq.md');
    fs.writeFileSync(faqPath, 'CueUp Enterprise includes SSO and audit log export.\n\nRefund 14 days.', 'utf8');
    const db = createDbStub();
    const embeddingPipeline = {
      isReady: () => true,
      getEmbeddingForQuery: async () => [1, 0, 0],
      getEmbeddings: async () => {
        throw new Error('rate limit exceeded');
      },
    };
    const service = new KnowledgeMaterialService(db, embeddingPipeline);
    const result = await service.uploadFiles([faqPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'complete');
    });
    // Embedding failure should be recorded
    assert.equal(db.embeddingFailures.get(materialId), 'rate limit exceeded');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('searchWithDiagnostics with candidateReader returning empty -> empty hits', async () => {
  const db = createDbStub();
  db.getKnowledgeMaterialCandidateChunks = () => [];
  const service = new KnowledgeMaterialService(db, null);
  const result = await service.searchWithDiagnostics('anything', { limit: 5 });
  assert.deepEqual(result.hits, []);
});

test('search with default options when no options provided uses defaults', async () => {
  const db = createDbStub();
  db.getKnowledgeMaterialCandidateChunks = (query, options) => {
    assert.equal(options.limit, 6);
    assert.equal(options.candidateLimit, 200);
    return [];
  };
  const service = new KnowledgeMaterialService(db, null);
  const result = await service.searchWithDiagnostics('test');
  assert.deepEqual(result.hits, []);
});
