import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import Module from 'node:module';

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

function installCredentialsManagerStub({ hasNativelyApiKey, activeProvider, getDefaultModelImpl }) {
  const credsPath = require.resolve('../../../dist-electron/electron/services/CredentialsManager.js');
  const originalCacheEntry = require.cache[credsPath];
  const fakeModule = new Module(credsPath);
  fakeModule.filename = credsPath;
  fakeModule.loaded = true;
  fakeModule.exports = {
    CredentialsManager: class {
      static getInstance() {
        return new (class {
          getDefaultModel() {
            if (getDefaultModelImpl) return getDefaultModelImpl();
            return activeProvider;
          }
          getNativelyApiKey() {
            return hasNativelyApiKey ? 'fake-key' : null;
          }
        })();
      }
    },
  };
  require.cache[credsPath] = fakeModule;
  return () => {
    if (originalCacheEntry) require.cache[credsPath] = originalCacheEntry;
    else delete require.cache[credsPath];
  };
}

test('checkPptxQCloudAvailability default: key present but provider is empty string -> unavailable', async () => {
  const restore = installCredentialsManagerStub({ hasNativelyApiKey: true, activeProvider: '' });
  try {
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-empty-'));
    try {
      const pptxPath = path.join(tmpDir, 'deck.pptx');
      fs.writeFileSync(pptxPath, 'fake', 'utf8');
      const result = await service.uploadFiles([pptxPath]);
      assert.equal(result.materials.length, 0);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0].error, /PPTX 知识源需要先配置并选择 QCLOUD API/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
});

test('checkPptxQCloudAvailability default: key missing, provider is natively -> unavailable', async () => {
  const restore = installCredentialsManagerStub({ hasNativelyApiKey: false, activeProvider: 'natively' });
  try {
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-nokey-'));
    try {
      const pptxPath = path.join(tmpDir, 'deck.pptx');
      fs.writeFileSync(pptxPath, 'fake', 'utf8');
      const result = await service.uploadFiles([pptxPath]);
      assert.equal(result.materials.length, 0);
      assert.equal(result.errors.length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
});

test('checkPptxQCloudAvailability default: provider has no getDefaultModel function -> defaults to empty', async () => {
  const restore = installCredentialsManagerStub({
    hasNativelyApiKey: true,
    activeProvider: 'natively',
    getDefaultModelImpl: () => undefined, // getDefaultModel?.() returns undefined
  });
  try {
    const db = createDbStub();
    const service = new KnowledgeMaterialService(db, null);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-undefined-'));
    try {
      const pptxPath = path.join(tmpDir, 'deck.pptx');
      fs.writeFileSync(pptxPath, 'fake', 'utf8');
      const result = await service.uploadFiles([pptxPath]);
      // activeProvider becomes '' because (undefined || '') === ''
      assert.equal(result.materials.length, 0);
      assert.equal(result.errors.length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    restore();
  }
});

test('checkPptxQCloudAvailability via options.getQCloudAvailability: key+provider ok', async () => {
  const db = createDbStub();
  let availabilityCalls = 0;
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => {
      availabilityCalls++;
      return { hasNativelyApiKey: true, activeProvider: 'natively', available: true };
    },
    createPptxIngestionService: (indexPreparedChunks) => ({
      ingest: async (materialId) => {
        await indexPreparedChunks(materialId, [
          {
            materialId,
            chunkIndex: 0,
            parentChunkIndex: 0,
            cleanedText: 'Sample slide text',
            parentText: 'Sample slide text',
            tokenCount: 3,
            metadata: { source_format: 'pptx', slide_index: 1 },
          },
        ]);
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-options-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake pptx', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.materials.length, 1);
    assert.equal(availabilityCalls, 1);
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(result.materials[0].id).status, 'complete'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PPTX background processing is marked indexing before slide analysis completes', async () => {
  const db = createDbStub();
  let releaseIngestion;
  let markIngestionStarted;
  const ingestionStarted = new Promise((resolve) => {
    markIngestionStarted = resolve;
  });
  const ingestionReleased = new Promise((resolve) => {
    releaseIngestion = resolve;
  });
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: (indexPreparedChunks) => ({
      ingest: async (materialId) => {
        markIngestionStarted();
        await ingestionReleased;
        await indexPreparedChunks(materialId, [
          {
            materialId,
            chunkIndex: 0,
            parentChunkIndex: 0,
            cleanedText: 'Sample slide text',
            parentText: 'Sample slide text',
            tokenCount: 3,
            metadata: { source_format: 'pptx', slide_index: 1 },
          },
        ]);
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-processing-status-'));

  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake pptx', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    const materialId = result.materials[0].id;
    await ingestionStarted;

    assert.equal(db.getKnowledgeMaterial(materialId).status, 'indexing');

    releaseIngestion();
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'complete'));
  } finally {
    releaseIngestion?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uploadFiles rejects pptx with localized error from getQCloudAvailability', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'openai', available: false }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-fail-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    assert.equal(result.materials.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error, /PPTX 知识源需要先配置并选择 QCLOUD API/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createPptxIngestionService default: full PPTX flow with stubbed createPptxIngestionService throws and is caught', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: (indexPreparedChunks) => ({
      ingest: async (materialId) => {
        // Simulate a pptx_enhance_invalid_json error
        const error = new Error('pptx_enhance_xyz invalid');
        throw error;
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-throw-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake pptx', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.materials.length, 1);
    const materialId = result.materials[0].id;
    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'failed');
      assert.equal(material.error_code, 'pptx_enhance_invalid_json');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pptx_markdown_empty error from ingestion maps to user-facing message', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: () => ({
      ingest: async () => {
        throw new Error('pptx_markdown_empty: no text');
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-empty-md-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'failed');
      assert.match(material.error_message, /PPTX 内容提取失败/);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pptx_too_many_slides error maps to user-facing slide count message', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: () => ({
      ingest: async () => {
        throw new Error('pptx_too_many_slides: too many');
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-slides-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'failed');
      assert.equal(material.error_code, 'pptx_too_many_slides');
      assert.match(material.error_message, /PPTX 页数超过 200/);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pptx_invalid_file error maps to user-facing damaged file message', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: () => ({
      ingest: async () => {
        throw new Error('pptx_invalid_file corrupt zip');
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-invalid-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'failed');
      assert.equal(material.error_code, 'pptx_invalid_file');
      assert.match(material.error_message, /PPTX 文件已损坏/);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('pptx_renderer_asset_missing error maps to user-facing message', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: () => ({
      ingest: async () => {
        throw new Error('pptx_renderer_asset_missing: createPptxFontMapping.js not found');
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-asset-'));
  try {
    const pptxPath = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(pptxPath, 'fake', 'utf8');
    const result = await service.uploadFiles([pptxPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => {
      const material = db.getKnowledgeMaterial(materialId);
      assert.equal(material.status, 'failed');
      assert.equal(material.error_code, 'pptx_renderer_asset_missing');
      assert.match(material.error_message, /PPTX 渲染组件缺失/);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PPTX indexing failure logs only privacy-safe stage diagnostics', async () => {
  const db = createDbStub();
  const service = new KnowledgeMaterialService(db, null, {
    getQCloudAvailability: async () => ({ hasNativelyApiKey: true, activeProvider: 'natively', available: true }),
    createPptxIngestionService: () => ({
      ingest: async () => {
        const error = new Error('sensitive child stderr /private/customer/acme-secret.pptx');
        error.code = 'pptx_render_child_failed';
        error.stage = 'render_child_exit';
        error.retryable = true;
        throw error;
      },
    }),
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-safe-log-'));
  const pptxPath = path.join(tmpDir, 'acme-secret.pptx');
  fs.writeFileSync(pptxPath, 'fake', 'utf8');
  const logCalls = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logCalls.push(args);
  try {
    const result = await service.uploadFiles([pptxPath]);
    const materialId = result.materials[0].id;
    await waitFor(() => assert.equal(db.getKnowledgeMaterial(materialId).status, 'failed'));
  } finally {
    console.error = originalConsoleError;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const serialized = JSON.stringify(logCalls);
  assert.match(serialized, /pptx_render_child_failed/);
  assert.match(serialized, /render_child_exit/);
  assert.match(serialized, /\.pptx/);
  assert.doesNotMatch(serialized, /acme-secret|private\/customer|sensitive child stderr/);
});
