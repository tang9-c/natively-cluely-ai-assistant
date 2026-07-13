import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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
      if (count === 200) {
        assert.ok(
          optimized.totalP95Ms <= baseline.totalP95Ms * 1.10 + 1,
          `200-candidate total local retrieval must not regress >10%; baseline=${baseline.totalP95Ms}, optimized=${optimized.totalP95Ms}`,
        );
      }
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
