import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MaterialRagRetriever } = require('../../../dist-electron/electron/services/knowledge/MaterialRagRetriever.js');
const { analyzeMaterialQuery } = require('../../../dist-electron/electron/services/knowledge/MaterialQueryAnalysis.js');

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
