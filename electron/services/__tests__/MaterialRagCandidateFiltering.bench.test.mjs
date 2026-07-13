import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const { DatabaseManager } = require('../../../dist-electron/electron/db/DatabaseManager.js');
const { KnowledgeMaterialService } = require('../../../dist-electron/electron/services/knowledge/KnowledgeMaterialService.js');
const {
  analyzeMaterialQuery,
  termsForCandidateFiltering,
} = require('../../../dist-electron/electron/services/knowledge/MaterialQueryAnalysis.js');

const STRUCTURED_QUERY = `mode:sales
intent:case_study_request
language:zh
latestTurn:我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例`;
const PLAIN_QUERY = '我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例';

function row(index) {
  const relevant = index % 37 === 0;
  return {
    id: index + 1,
    material_id: relevant ? `force_${index}` : `generic_${index}`,
    chunk_index: 0,
    cleaned_text: relevant
      ? `力学仿真模块支持结构分析、CAE 验证和产品适配评估。样本 ${index}`
      : `通用产品资料、案例、功能和介绍。样本 ${index}`,
    parent_text: relevant
      ? `力学仿真模块支持结构分析、CAE 验证和产品适配评估。样本 ${index}`
      : `通用产品资料、案例、功能和介绍。样本 ${index}`,
    token_count: 30,
    embedding: null,
    file_name: relevant ? `force-${index}.md` : `generic-${index}.md`,
    title: relevant ? `力学仿真模块 ${index}` : `通用资料 ${index}`,
    file_hash: `hash_${index}`,
    material_updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function createDbStub(count, options = {}) {
  const rows = Array.from({ length: count }, (_, index) => row(index));
  let lastCandidateReadMs = 0;
  let fallbackFillUsed = false;
  return {
    get lastCandidateReadMs() {
      return lastCandidateReadMs;
    },
    get fallbackFillUsed() {
      return fallbackFillUsed;
    },
    getKnowledgeMaterialCandidateChunks() {
      const startedAt = performance.now();
      if (options.sparseStructuredFirstPass && rows.length > 1) {
        fallbackFillUsed = true;
        const structuredRows = rows.slice(0, 1);
        const fillRows = rows.slice(1, Math.min(rows.length, 25));
        lastCandidateReadMs = performance.now() - startedAt;
        return [...structuredRows, ...fillRows];
      }
      lastCandidateReadMs = performance.now() - startedAt;
      return rows;
    },
    getMaterialQueueStatus() {
      return { pending: 0, processing: 0, completed: rows.length, failed: 0 };
    },
  };
}

function createEmbeddingPipelineStub() {
  return {
    isReady() {
      return true;
    },
    async getEmbeddingForQuery() {
      return [1, 0, 0, 0];
    },
    async getEmbedding(text) {
      return text.includes('力学仿真模块') ? [1, 0, 0, 0] : [0, 1, 0, 0];
    },
    async getEmbeddings(texts) {
      return texts.map((text) => (text.includes('力学仿真模块') ? [1, 0, 0, 0] : [0, 1, 0, 0]));
    },
  };
}

function createKnowledgeSchema(db) {
  db.exec(`
    CREATE TABLE knowledge_materials (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      title TEXT,
      mime_or_ext TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'indexing', 'complete', 'failed', 'deleted')),
      error_code TEXT,
      error_message TEXT,
      source_type TEXT NOT NULL DEFAULT 'upload',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE knowledge_material_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      parent_chunk_index INTEGER,
      cleaned_text TEXT NOT NULL,
      parent_text TEXT,
      token_count INTEGER NOT NULL,
      embedding BLOB,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(material_id, chunk_index),
      FOREIGN KEY(material_id) REFERENCES knowledge_materials(id) ON DELETE CASCADE
    );

    CREATE TABLE material_embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_chunk_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      FOREIGN KEY(material_chunk_id) REFERENCES knowledge_material_chunks(id) ON DELETE CASCADE
    );
  `);
}

function createDatabaseManagerWithRows(count) {
  const db = new Database(':memory:');
  createKnowledgeSchema(db);
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.ensuredDims = new Map();
  for (let index = 0; index < count; index++) {
    const materialRow = row(index);
    manager.upsertKnowledgeMaterial({
      id: materialRow.material_id,
      fileName: materialRow.file_name,
      title: materialRow.title,
      mimeOrExt: 'md',
      fileHash: materialRow.file_hash,
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks(materialRow.material_id, [{
      chunkIndex: 0,
      cleanedText: materialRow.cleaned_text,
      parentText: materialRow.parent_text,
      tokenCount: materialRow.token_count,
    }]);
  }
  return { db, manager };
}

async function measureScenario({ count, query, embeddingReady, sparseStructuredFirstPass }) {
  const db = createDbStub(count, { sparseStructuredFirstPass });
  const embeddingPipeline = embeddingReady ? createEmbeddingPipelineStub() : null;
  const service = new KnowledgeMaterialService(db, embeddingPipeline);
  const analysisStartedAt = performance.now();
  const analysis = analyzeMaterialQuery(query);
  const candidateTerms = termsForCandidateFiltering(analysis);
  const analysisMs = performance.now() - analysisStartedAt;
  assert.ok(Array.isArray(candidateTerms));
  const startedAt = performance.now();
  const result = await service.searchWithDiagnostics(query, {
    limit: 4,
    candidateLimit: Math.max(1, count),
  });
  const totalMs = performance.now() - startedAt;
  return {
    analysisMs,
    candidateReadMs: db.lastCandidateReadMs,
    totalMs,
    hits: result.hits.length,
    embeddingReady,
    sparseStructuredFirstPass,
    fallbackFillUsed: db.fallbackFillUsed,
  };
}

function measureRealDatabaseCandidateRead({ count, query }) {
  const { db, manager } = createDatabaseManagerWithRows(count);
  try {
    const analysis = analyzeMaterialQuery(query);
    const candidateTerms = termsForCandidateFiltering(analysis);
    const candidateLimit = Math.max(1, count);
    const samples = [];
    for (let index = 0; index < 15; index++) {
      const startedAt = performance.now();
      const rows = manager.getKnowledgeMaterialCandidateChunks(query, {
        candidateLimit,
        candidateTerms,
        minStructuredRows: analysis.strongTerms.length > 0 ? Math.min(20, candidateLimit) : 1,
      });
      samples.push({
        durationMs: performance.now() - startedAt,
        rows: rows.length,
      });
    }
    const sorted = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return {
      candidateReadP95Ms: sorted[p95Index] ?? 0,
      rowsReturned: samples.at(-1)?.rows ?? 0,
    };
  } finally {
    db.close();
  }
}

async function sampleP95(input) {
  const samples = [];
  for (let i = 0; i < 15; i++) {
    samples.push(await measureScenario(input));
  }
  const sortedTotal = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
  const sortedAnalysis = samples.map((sample) => sample.analysisMs).sort((a, b) => a - b);
  const sortedCandidate = samples.map((sample) => sample.candidateReadMs).sort((a, b) => a - b);
  const index = Math.min(sortedTotal.length - 1, Math.ceil(sortedTotal.length * 0.95) - 1);
  return {
    totalP95Ms: sortedTotal[index] ?? 0,
    analysisP95Ms: sortedAnalysis[index] ?? 0,
    candidateReadP95Ms: sortedCandidate[index] ?? 0,
    fallbackFillUsed: samples.some((sample) => sample.fallbackFillUsed),
  };
}

for (const count of [0, 50, 200, 1000]) {
  test(`material candidate filtering real sqlite benchmark ${count} chunks`, () => {
    const result = measureRealDatabaseCandidateRead({
      count,
      query: STRUCTURED_QUERY,
    });
    console.log(JSON.stringify({
      benchmark: 'material-rag-candidates',
      source: 'database-manager-sqlite',
      count,
      candidateReadP95Ms: Number(result.candidateReadP95Ms.toFixed(2)),
      rowsReturned: result.rowsReturned,
    }));
    assert.ok(
      result.candidateReadP95Ms < 20,
      `real SQLite candidate retrieval P95 must be <20ms, got ${result.candidateReadP95Ms}`,
    );
  });
}

for (const count of [0, 50, 200, 1000]) {
  for (const embeddingReady of [false, true]) {
    test(`material candidate filtering benchmark ${count} chunks embeddingReady=${embeddingReady}`, async () => {
      const optimized = await sampleP95({
        count,
        query: STRUCTURED_QUERY,
        embeddingReady,
        sparseStructuredFirstPass: false,
      });
      const baseline = await sampleP95({
        count,
        query: PLAIN_QUERY,
        embeddingReady,
        sparseStructuredFirstPass: false,
      });
      const clientPrepP95Ms = optimized.analysisP95Ms + optimized.candidateReadP95Ms;
      console.log(JSON.stringify({
        benchmark: 'material-rag-candidates',
        count,
        embeddingReady,
        analysisP95Ms: Number(optimized.analysisP95Ms.toFixed(2)),
        candidateReadP95Ms: Number(optimized.candidateReadP95Ms.toFixed(2)),
        clientPrepP95Ms: Number(clientPrepP95Ms.toFixed(2)),
        totalP95Ms: Number(optimized.totalP95Ms.toFixed(2)),
        baselineTotalP95Ms: Number(baseline.totalP95Ms.toFixed(2)),
        slowestSegment: optimized.analysisP95Ms >= optimized.candidateReadP95Ms ? 'query_analysis' : 'candidate_retrieval',
      }));
      assert.ok(clientPrepP95Ms < 20, `query analysis + candidate retrieval P95 must be <20ms, got ${clientPrepP95Ms}`);
      assert.equal(Number.isFinite(optimized.totalP95Ms), true);
      assert.equal(Number.isFinite(baseline.totalP95Ms), true);
    });
  }
}

test('material candidate filtering benchmark records fallback fill segment', async () => {
  const result = await sampleP95({
    count: 50,
    query: STRUCTURED_QUERY,
    embeddingReady: false,
    sparseStructuredFirstPass: true,
  });
  console.log(JSON.stringify({
    benchmark: 'material-rag-candidates',
    count: 50,
    segment: 'fallback_fill',
    fallbackFillUsed: result.fallbackFillUsed,
    totalP95Ms: Number(result.totalP95Ms.toFixed(2)),
  }));
  assert.equal(result.fallbackFillUsed, true);
});

test('material candidate filtering benchmark exposes no-result diagnostic timing', async () => {
  const result = await sampleP95({
    count: 0,
    query: STRUCTURED_QUERY,
    embeddingReady: false,
    sparseStructuredFirstPass: false,
  });
  console.log(JSON.stringify({
    benchmark: 'material-rag-candidates',
    count: 0,
    segment: 'no_relevant_uploaded_material',
    totalP95Ms: Number(result.totalP95Ms.toFixed(2)),
  }));
  assert.equal(Number.isFinite(result.totalP95Ms), true);
});
