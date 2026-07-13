import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KnowledgeMaterialService } = require('../../../dist-electron/electron/services/knowledge/KnowledgeMaterialService.js');

function createDbStub(rows) {
  return {
    getKnowledgeMaterialCandidateChunks(query, options) {
      assert.ok(Array.isArray(options.candidateTerms));
      return rows;
    },
    getMaterialQueueStatus() {
      return { pending: 0, processing: 0, completed: rows.length, failed: 0 };
    },
  };
}

function createEmptyDbStub() {
  return {
    getKnowledgeMaterialCandidateChunks(query, options) {
      assert.ok(Array.isArray(options.candidateTerms));
      return [];
    },
    getMaterialQueueStatus() {
      return { pending: 0, processing: 0, completed: 0, failed: 0 };
    },
  };
}

function row(id, title, text) {
  return {
    id: Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    material_id: id,
    chunk_index: 0,
    cleaned_text: text,
    parent_text: text,
    token_count: Math.max(1, Math.ceil(text.length / 4)),
    embedding: null,
    file_name: `${id}.md`,
    title,
    file_hash: `hash_${id}`,
    material_updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function computeRetrievalMetrics(result, relevantSourceIds) {
  const hitSourceIds = result.hits.map((hit) => hit.sourceId);
  const top20 = hitSourceIds.slice(0, 20);
  const top5 = hitSourceIds.slice(0, 5);
  const relevantInTop20 = top20.filter((sourceId) => relevantSourceIds.has(sourceId)).length;
  const relevantInTop5 = top5.filter((sourceId) => relevantSourceIds.has(sourceId)).length;
  return {
    recallAt20: relevantSourceIds.size === 0 ? 1 : relevantInTop20 / relevantSourceIds.size,
    precisionAt5: top5.length === 0 ? 0 : relevantInTop5 / top5.length,
    noRelevantUploadedMaterial: result.hits.length === 0,
  };
}

const fixtures = [
  {
    mode: 'general',
    query: `mode:general
intent:general_explain
language:zh
latestTurn:能不能根据文档解释一下数据保留策略和删除流程？`,
    positive: row('general-positive', '数据保留策略', '数据保留策略说明：用户可以删除会议记录，系统会清理相关索引和资料引用。'),
    generic: row('general-generic', '产品功能介绍', '这是一份产品功能和资料说明，覆盖很多常见问题但没有数据保留策略。'),
    unrelated: row('general-unrelated', '销售案例', '客户案例和报价流程。'),
  },
  {
    mode: 'looking-for-work',
    query: `mode:looking-for-work
intent:behavioral
language:zh
latestTurn:面试官问我一次解决线上事故的经历，能不能结合我的项目资料组织回答？`,
    positive: row('work-positive', '候选人项目经历', '项目经历：负责线上事故排查，定位缓存击穿并推动限流和回滚预案。'),
    generic: row('work-generic', '简历通用介绍', '简历材料包含项目、作品集、经验和自我介绍。'),
    unrelated: row('work-unrelated', '讲座笔记', '贝叶斯公式和阅读材料。'),
  },
  {
    mode: 'sales',
    query: `mode:sales
intent:case_study_request
entities:今天, 价格, 案例
language:zh
latestTurn:我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例？`,
    positive: row('sales-positive', '力学仿真模块案例', '力学仿真模块支持结构分析、CAE 验证、产品适配评估，并包含客户实施案例。'),
    generic: row('sales-generic', '客户案例合集', '客户案例、产品功能、报价和资料汇总，但没有力学仿真模块内容。'),
    unrelated: row('sales-unrelated', '招聘评分表', '候选人面试评分标准。'),
  },
  {
    mode: 'fde',
    query: `mode:fde
intent:fde_integration
entities:Windchill, QMS, BOM
language:zh
latestTurn:Windchill BOM 变更能不能只读同步到 QMS CAPA 流程里？权限边界怎么验证？`,
    positive: row('fde-positive', 'Windchill QMS 只读集成', 'Windchill BOM 变更通过只读接口同步到 QMS CAPA，验证权限边界和人工确认点。'),
    generic: row('fde-generic', 'FDE 交付方法', '需求、流程、资料、系统边界和上线计划的通用交付材料。'),
    unrelated: row('fde-unrelated', '价格表', '报价、折扣和采购合同。'),
  },
  {
    mode: 'recruiting',
    query: `mode:recruiting
intent:request_example
language:zh
latestTurn:候选人说自己带过模型评测项目，能不能根据 JD 和简历资料追问证据？`,
    positive: row('recruiting-positive', 'JD 模型评测要求', '岗位要求：候选人需要设计模型评测指标、分析误差案例、推动上线质量门禁。'),
    generic: row('recruiting-generic', '招聘流程材料', '候选人、岗位、简历、经验和面试官通用流程。'),
    unrelated: row('recruiting-unrelated', '团队行动项', '负责人和截止时间。'),
  },
  {
    mode: 'team-meet',
    query: `mode:team-meet
intent:capture_risk
language:zh
latestTurn:这次发布的风险是 sqlite-vec 索引重建太慢，能不能找一下之前的决策和行动项？`,
    positive: row('team-positive', 'sqlite-vec 发布风险决策', '决策：sqlite-vec 索引重建要放到后台队列，行动项由 Alex 周五前验证回滚方案。'),
    generic: row('team-generic', '会议纪要模板', '行动项、负责人、截止时间、风险和决策的通用模板。'),
    unrelated: row('team-unrelated', '销售 ROI 案例', '客户案例和投资回报。'),
  },
  {
    mode: 'lecture',
    query: `mode:lecture
intent:concept_explanation
language:zh
latestTurn:老师刚讲的贝叶斯定理公式我没跟上，能不能根据阅读材料解释一下？`,
    positive: row('lecture-positive', '贝叶斯定理阅读材料', '贝叶斯定理公式：P(A|B)=P(B|A)P(A)/P(B)，用于根据证据更新概率。'),
    generic: row('lecture-generic', '课程资料目录', '概念、定义、公式、例题、作业和阅读材料目录。'),
    unrelated: row('lecture-unrelated', 'Windchill 集成', 'PLM 和 QMS 权限边界。'),
  },
  {
    mode: 'technical-interview',
    query: `mode:technical-interview
intent:coding
language:zh
latestTurn:这道题要实现 LRU Cache，能不能根据我上传的 API 约束说明一下复杂度？`,
    positive: row('tech-positive', 'LRU Cache API 约束', 'LRU Cache 需要 get 和 put 都是 O(1)，使用哈希表加双向链表维护最近使用顺序。'),
    generic: row('tech-generic', '算法资料合集', '算法、复杂度、数据结构、系统设计和 API 的通用资料。'),
    unrelated: row('tech-unrelated', '候选人薪资沟通', '薪资、offer 和入职时间。'),
  },
];

for (const fixture of fixtures) {
  test(`material retrieval ranks positive fixture first and records metrics for ${fixture.mode}`, async () => {
    const service = new KnowledgeMaterialService(
      createDbStub([fixture.generic, fixture.unrelated, fixture.positive]),
      null,
    );

    const result = await service.searchWithDiagnostics(fixture.query, { limit: 3, candidateLimit: 25 });
    const metrics = computeRetrievalMetrics(result, new Set([fixture.positive.material_id]));

    assert.equal(result.hits.length > 0, true);
    assert.equal(result.hits[0].sourceId, fixture.positive.material_id);
    assert.equal(result.hits.some((hit) => hit.sourceId === fixture.unrelated.material_id), false);
    assert.equal(metrics.recallAt20, 1);
    assert.ok(metrics.precisionAt5 >= 1 / 3, `Precision@5 should include the positive source for ${fixture.mode}`);
    assert.equal(metrics.noRelevantUploadedMaterial, false);
  });
}

test('material retrieval reports no_relevant_uploaded_material when no candidates are returned', async () => {
  const service = new KnowledgeMaterialService(createEmptyDbStub(), null);

  const result = await service.searchWithDiagnostics(`mode:general
intent:general_explain
language:zh
latestTurn:请根据上传资料解释一个不存在的内部流程`, { limit: 3, candidateLimit: 25 });
  const metrics = computeRetrievalMetrics(result, new Set(['missing-positive']));

  assert.deepEqual(result.hits, []);
  assert.equal(metrics.recallAt20, 0);
  assert.equal(metrics.precisionAt5, 0);
  assert.equal(metrics.noRelevantUploadedMaterial, true);
});
