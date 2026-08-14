import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MaterialRagRetriever } = require('../../../dist-electron/electron/services/knowledge/MaterialRagRetriever.js');
const { analyzeMaterialQuery } = require('../../../dist-electron/electron/services/knowledge/MaterialQueryAnalysis.js');
const { chunkReferenceText } = require('../../../dist-electron/electron/services/knowledge/ReferenceTextChunker.js');

test('weighted lexical scoring ranks force simulation above bare case material', async () => {
  const query = `mode:sales
intent:case_study_request
entities:今天, 价格, 案例
language:zh
latestTurn:我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例`;
  const analysis = analyzeMaterialQuery(query);
  const retriever = new MaterialRagRetriever(null);

  const result = await retriever.retrieve({
    query,
    weightedTerms: analysis.weightedTerms,
    sources: [
      {
        id: 'generic-case',
        scope: 'global',
        title: '案例合集',
        text: '这里是很多客户案例和产品介绍，但没有任何仿真或结构分析内容。',
        parentText: '这里是很多客户案例和产品介绍，但没有任何仿真或结构分析内容。',
        sourcePriority: 1,
      },
      {
        id: 'force-simulation',
        scope: 'global',
        title: '力学仿真模块说明',
        text: '力学仿真模块支持结构分析、CAE 验证和产品适配评估，并包含实施案例。',
        parentText: '力学仿真模块支持结构分析、CAE 验证和产品适配评估，并包含实施案例。',
        sourcePriority: 1,
      },
    ],
    filters: { scopes: ['global'] },
    topK: 2,
    format: 'none',
  });

  assert.equal(result.chunks[0].sourceId, 'force-simulation');
});

test('hybrid retrieval budget falls back to lexical scoring before a slow embedding finishes', async () => {
  const embeddingPipeline = {
    isReady: () => true,
    getEmbeddingForQuery: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return [1, 0];
    },
  };
  const retriever = new MaterialRagRetriever(embeddingPipeline);
  const startedAt = Date.now();

  const result = await retriever.retrieve({
    query: '预算价格',
    sources: [{
      id: 'pricing',
      scope: 'global',
      title: '价格说明',
      text: '预算价格和报价说明',
      parentText: '预算价格和报价说明',
      sourcePriority: 1,
      embedding: [1, 0],
    }],
    topK: 1,
    format: 'none',
    hybridTimeoutMs: 10,
  });

  assert.ok(Date.now() - startedAt < 80);
  assert.equal(result.usedFallback, true);
  assert.equal(result.degradedReason, 'hybrid_threw');
  assert.equal(result.chunks[0]?.sourceId, 'pricing');
});

test('material retrieval uses semanticQuery for embeddings while lexical scoring keeps the raw query', async () => {
  const embeddingQueries = [];
  const embeddingPipeline = {
    isReady: () => true,
    getEmbeddingForQuery: async (query) => {
      embeddingQueries.push(query);
      return [1, 0];
    },
  };
  const retriever = new MaterialRagRetriever(embeddingPipeline);

  const result = await retriever.retrieve({
    query: '手术机器人',
    semanticQuery: '手术机器人\n一段用于语义增强的会议转录',
    sources: [{
      id: 'robotics',
      scope: 'mode',
      title: '机器人资料',
      text: '手术机器人包含约 15000 个零件',
      parentText: '手术机器人包含约 15000 个零件',
      embedding: [1, 0],
    }],
    topK: 1,
    format: 'none',
  });

  assert.deepEqual(embeddingQueries, ['手术机器人\n一段用于语义增强的会议转录']);
  assert.equal(result.chunks[0]?.sourceId, 'robotics');
});

test('mode reference retrieval splits long Chinese text without spaces into bounded overlapping chunks', async () => {
  const retriever = new MaterialRagRetriever(null);
  const longChinese = `${'中'.repeat(895)}数字化移交${'文'.repeat(1000)}`;
  const chunks = chunkReferenceText(longChinese);

  const result = await retriever.retrieve({
    query: '数字化移交',
    sources: [{
      id: 'long-chinese',
      scope: 'mode',
      title: '长中文资料',
      text: longChinese,
    }],
    topK: 5,
    tokenBudget: 5000,
    format: 'none',
  });

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((item) => item.length <= 900));
  assert.ok(chunks.some((item) => item.includes('数字化移交')));
  assert.ok(result.chunks.some((item) => item.text.includes('数字化移交')));
});
