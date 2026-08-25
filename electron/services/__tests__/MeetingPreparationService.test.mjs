import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const serviceModule = () =>
  require('../../../dist-electron/electron/services/meeting-preparation/MeetingPreparationService.js');

const validContext = {
  topic: { value: '产品交流', state: 'confirmed' },
  customer: { value: '启明机器人', state: 'confirmed' },
  participants: [{ name: '', role: '研发总监' }],
  goal: { value: '需求发现', state: 'confirmed' },
  agenda: ['案例'],
  background: '',
};

const baseRecord = {
  id: 'prep-1',
  status: 'draft',
  rawInput: '会议',
  inputMethod: 'text',
  meetingContext: validContext,
  selectedModeId: 'sales-mode',
  linkedMeetingId: null,
  result: { modeRecommendation: null, historySummary: [], commitments: [] },
  questions: [],
  generatedAt: null,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function jsonLlm(value) {
  return { generateContentStructured: async () => JSON.stringify(value) };
}

function queuedJsonLlm(values) {
  const queue = values.map((value) => JSON.stringify(value));
  return {
    generateContentStructured: async () => {
      if (queue.length === 0) throw new Error('unexpected_llm_call');
      return queue.shift();
    },
  };
}

const predictedQuestionsJson = {
  historySummary: [],
  commitments: [],
  questions: [
    {
      question: '机器人行业案例有哪些？',
      keyMomentType: 'case_request',
      rationale: ['议程包含行业案例'],
      knowledgeRequirements: ['机器人行业案例'],
      requiresInternalEvidence: true,
    },
  ],
};

function pendingEvidenceRecord() {
  return {
    ...structuredClone(baseRecord),
    questions: [{
      id: 'q1',
      sortOrder: 0,
      question: '机器人行业案例有哪些？',
      keyMomentType: 'case_request',
      rationale: ['议程包含行业案例'],
      evidenceStatus: null,
      evidence: {
        knowledgeRequirements: ['机器人行业案例'],
        supported: [],
        missing: [],
        limitations: [],
        citations: [],
        handlingScript: '',
        followupQuestions: [],
      },
      checkedAt: null,
    }],
  };
}

function recheckDb(record, onSave = () => {}) {
  return {
    getMeetingPreparation: () => structuredClone(record),
    getRecentMeetings: () => [],
    getMeetingDetails: () => null,
    saveMeetingPreparation: (input) => {
      onSave(input);
      return { ...structuredClone(record), ...input };
    },
    saveMeetingPreparationResult: () => structuredClone(record),
  };
}

function makeService(overrides = {}) {
  const { MeetingPreparationService } = serviceModule();
  const db = overrides.db ?? {
    getMeetingPreparation: () => structuredClone(baseRecord),
    getRecentMeetings: () => [],
    getMeetingDetails: () => null,
    saveMeetingPreparation: (input) => ({ ...structuredClone(baseRecord), ...input }),
    saveMeetingPreparationResult: (_id, result, questions) => ({
      ...structuredClone(baseRecord),
      status: 'ready',
      result,
      questions,
    }),
  };
  const modes = overrides.modes ?? {
    getModes: () => [
      { id: 'sales-mode', name: '销售', templateType: 'sales' },
      { id: 'fde-mode', name: 'FDE', templateType: 'fde' },
      { id: 'recruiting-mode', name: '招聘', templateType: 'recruiting' },
      { id: 'team-meet-mode', name: '团队会议', templateType: 'team-meet' },
      { id: 'general-mode', name: '通用', templateType: 'general' },
    ],
    setActiveMode: () => {},
  };
  const materials = overrides.materials ?? { searchWithDiagnostics: async () => ({ hits: [] }) };
  return new MeetingPreparationService({
    db,
    llm: overrides.llm ?? jsonLlm(validContext),
    modes,
    materials,
  });
}

test('parseInput declares transcript scope and returns validated context', async () => {
  const calls = [];
  const service = makeService({
    llm: {
      async generateContentStructured(prompt, options) {
        calls.push({ prompt, options });
        return JSON.stringify(validContext);
      },
    },
  });

  const result = await service.parseInput('prep-1', '和机器人客户做产品技术交流');

  assert.equal(result.customer.value, '启明机器人');
  assert.deepEqual(calls[0].options.dataScopes, ['transcript']);
  assert.equal(calls[0].options.providerStrategy, 'selected_model_only');
  const prompt = calls[0].prompt;
  assert.match(prompt, /只返回一个 JSON 对象/);
  assert.ok(prompt.includes('"topic":{"value":"产品技术交流","state":"confirmed"}'));
  assert.ok(prompt.includes('"participants":[{"name":"张三","role":"研发总监"}]'));
  assert.ok(prompt.includes('"agenda":["机器人行业案例","产品集成"]'));
  assert.ok(prompt.includes('"background":"首次交流"'));
  assert.match(prompt, /confirmed 或 needs_confirmation/);
});

test('parseInput preserves valid fields when other context fields are missing or invalid', async () => {
  const service = makeService({
    llm: {
      async generateContentStructured() {
        return JSON.stringify({
          topic: { value: '产品技术交流', state: 'confirmed' },
          customer: '启明机器人',
          participants: [{ name: '张三', role: 42 }],
          goal: { value: '确认产品集成方案', state: 'confirmed' },
        });
      },
    },
  });

  const result = await service.parseInput('prep-1', '和启明机器人讨论产品集成方案');

  assert.deepEqual(result.topic, { value: '产品技术交流', state: 'confirmed' });
  assert.deepEqual(result.customer, { value: '启明机器人', state: 'needs_confirmation' });
  assert.deepEqual(result.participants, []);
  assert.deepEqual(result.goal, { value: '确认产品集成方案', state: 'confirmed' });
  assert.deepEqual(result.agenda, []);
  assert.equal(result.background, '');
});

test('parseInput falls back to the original description when JSON is malformed', async () => {
  const rawInput = '和机器人客户讨论产品生命周期管理方案';
  const service = makeService({
    llm: {
      async generateContentStructured() {
        return '无法生成结构化结果';
      },
    },
  });

  const result = await service.parseInput('prep-1', rawInput);

  assert.deepEqual(result.topic, { value: rawInput, state: 'needs_confirmation' });
  assert.deepEqual(result.customer, { value: '', state: 'needs_confirmation' });
  assert.deepEqual(result.participants, []);
  assert.deepEqual(result.goal, { value: '', state: 'needs_confirmation' });
  assert.deepEqual(result.agenda, []);
  assert.equal(result.background, '');
});

test('prepareContext recommends only Sales or FDE and returns at most five meetings', async () => {
  const meetings = Array.from({ length: 8 }, (_, index) => ({
    id: `meeting-${index}`,
    title: index < 2 ? `启明机器人第 ${index + 1} 次沟通` : `其他会议 ${index}`,
    date: new Date(Date.UTC(2026, 7, 23 - index)).toISOString(),
    duration: '10:00',
    summary: index === 2 ? '讨论启明机器人案例' : '',
  }));
  const service = makeService({
    llm: jsonLlm({ templateType: 'sales', reason: '产品价值沟通', focus: '案例和需求' }),
    db: {
      getMeetingPreparation: () => structuredClone(baseRecord),
      getRecentMeetings: () => meetings,
      getMeetingDetails: () => null,
      saveMeetingPreparation: (input) => ({ ...structuredClone(baseRecord), ...input }),
      saveMeetingPreparationResult: () => structuredClone(baseRecord),
    },
  });

  const result = await service.prepareContext('prep-1', validContext);

  assert.equal(result.modeRecommendation.templateType, 'sales');
  assert.ok(result.historyCandidates.length <= 5);
  assert.deepEqual(result.historyCandidates.slice(0, 3).map(({ id }) => id), [
    'meeting-0',
    'meeting-1',
    'meeting-2',
  ]);
});

test('mode prompt prioritizes meeting intent and locks Sales/FDE boundary examples', async () => {
  let prompt = '';
  const service = makeService({
    llm: {
      async generateContentStructured(value) {
        prompt = value;
        return JSON.stringify({
          templateType: 'fde',
          reason: '技术与交付型客户会议',
          focus: '技术需求、集成约束和成功标准',
        });
      },
    },
  });

  await service.prepareContext('prep-1', validContext);

  assert.match(prompt, /会议目标 > 议程 > 参会人 > 主题名称/);
  assert.match(prompt, /售前技术交流.*fde/);
  assert.match(prompt, /首次向客户管理层做解决方案.*sales/);
  assert.match(prompt, /CTO.*技术方案评审.*fde/);
  assert.match(prompt, /报价异议.*采购流程.*sales/);
  assert.match(prompt, /会议结束时希望达成的主要结果/);
});

test('prepareContext keeps mode recommendation usable when history lookup fails', async () => {
  const service = makeService({
    llm: jsonLlm({ templateType: 'fde', reason: '技术约束沟通', focus: '集成风险' }),
    db: {
      getMeetingPreparation: () => structuredClone(baseRecord),
      getRecentMeetings: () => {
        throw new Error('database unavailable');
      },
      getMeetingDetails: () => null,
      saveMeetingPreparation: (input) => ({ ...structuredClone(baseRecord), ...input }),
      saveMeetingPreparationResult: () => structuredClone(baseRecord),
    },
  });

  const result = await service.prepareContext('prep-1', validContext);

  assert.equal(result.modeRecommendation.templateType, 'fde');
  assert.equal(result.historyUnavailable, true);
  assert.deepEqual(result.historyCandidates, []);
});

test('prepareContext accepts recruiting and team-meet while excluding other templates', async () => {
  for (const templateType of ['recruiting', 'team-meet']) {
    const calls = [];
    const service = makeService({
      llm: {
        async generateContentStructured(prompt) {
          calls.push(prompt);
          return JSON.stringify({ templateType, reason: '匹配会议性质', focus: '准备重点' });
        },
      },
    });

    const result = await service.prepareContext('prep-1', validContext);
    assert.equal(result.modeRecommendation.templateType, templateType);
    assert.match(calls[0], /sales、fde、recruiting 与 team-meet/);
    assert.match(calls[0], /外部客户会议不得推荐 team-meet/);
    assert.doesNotMatch(calls[0], /"templateType":"general"/);
  }

  const invalidService = makeService({
    llm: jsonLlm({ templateType: 'general', reason: '通用会议', focus: '摘要' }),
  });
  await assert.rejects(
    invalidService.prepareContext('prep-1', validContext),
    /invalid|templateType|meeting_preparation/i,
  );
});

test('rejects a second AI operation for the same preparation', async () => {
  const gate = deferred();
  const service = makeService({ llm: { generateContentStructured: () => gate.promise } });
  const first = service.parseInput('prep-1', '会议');

  await assert.rejects(service.parseInput('prep-1', '会议'), /meeting_preparation_busy/);
  gate.resolve(JSON.stringify(validContext));
  await first;
});

test('generate returns no more than three base questions with the prediction contract', async () => {
  const calls = [];
  const service = makeService({
    llm: {
      async generateContentStructured(prompt, options) {
        calls.push({ prompt, options });
        return JSON.stringify(predictedQuestionsJson);
      },
    },
  });

  const result = await service.generate('prep-1');

  assert.ok(result.questions.length <= 3);
  assert.equal(calls.length, 1);
  assert.equal(result.questions[0].evidenceStatus, null);
  assert.deepEqual(result.questions[0].evidence.knowledgeRequirements, ['机器人行业案例']);
  const predictionPrompt = calls[0].prompt;
  assert.match(predictionPrompt, /只返回一个 JSON 对象/);
  assert.ok(predictionPrompt.includes('"historySummary":["上次会议讨论了集成范围"]'));
  assert.ok(predictionPrompt.includes('"commitments":[{"text":"会后补充机器人案例"}]'));
  assert.ok(predictionPrompt.includes('"rationale":["议程包含机器人行业案例"]'));
  assert.ok(predictionPrompt.includes('"knowledgeRequirements":["机器人行业案例"]'));
  assert.ok(predictionPrompt.includes('"requiresInternalEvidence":true'));
  assert.match(predictionPrompt, /没有历史会议时，historySummary 和 commitments 必须为空数组/);
  assert.match(predictionPrompt, /公司掌握或提供的事实/);
  assert.match(predictionPrompt, /同时涉及公司事实与客户现场信息时，requiresInternalEvidence 必须为 true/);
  assert.match(predictionPrompt, /对方参会者向当前用户提出/);
  assert.match(predictionPrompt, /不得生成当前用户应该向对方提出的问题/);
  assert.match(predictionPrompt, /贵公司当前在图纸、物料和变更管理方面存在哪些痛点.*不得生成/);
  assert.match(predictionPrompt, /你们的产品如何解决机器人企业在图纸、物料和变更管理方面的痛点/);
  assert.match(predictionPrompt, /本次会议需要交流的具体机器人行业案例有哪些？.*requiresInternalEvidence=true/);
  assert.match(predictionPrompt, /你们的产品如何接入我们的现有控制系统？.*requiresInternalEvidence=true/);
  assert.match(predictionPrompt, /你们理解的本次会议目标是什么？.*requiresInternalEvidence=false/);
  assert.doesNotMatch(predictionPrompt, /客户当前使用什么控制系统？.*requiresInternalEvidence=false/);
});

test('generate gives recruiting and team-meet distinct key moments under one counterpart-question contract', async () => {
  const cases = [
    ['recruiting-mode', /岗位职责与成功标准/, /候选人/],
    ['team-meet-mode', /项目进展/, /其他参会同事/],
  ];

  for (const [selectedModeId, keyMoment, counterpart] of cases) {
    const prompts = [];
    const record = { ...structuredClone(baseRecord), selectedModeId };
    const service = makeService({
      db: {
        getMeetingPreparation: () => structuredClone(record),
        getRecentMeetings: () => [],
        getMeetingDetails: () => null,
        saveMeetingPreparation: (input) => ({ ...structuredClone(record), ...input }),
        saveMeetingPreparationResult: (_id, result, questions) => ({ ...record, result, questions }),
      },
      llm: {
        async generateContentStructured(prompt) {
          prompts.push(prompt);
          return JSON.stringify({ historySummary: [], commitments: [], questions: [] });
        },
      },
    });

    await service.generate('prep-1');
    assert.match(prompts[0], keyMoment);
    assert.match(prompts[0], counterpart);
    assert.match(prompts[0], /对方参会者向当前用户提出/);
    assert.match(prompts[0], /不得生成当前用户应该向对方提出的问题/);
  }
});

test('generate saves base questions without waiting for evidence retrieval', async () => {
  let llmCalls = 0;
  let retrievalCalls = 0;
  const service = makeService({
    llm: {
      async generateContentStructured() {
        llmCalls += 1;
        return JSON.stringify({
          ...predictedQuestionsJson,
          questions: [
            predictedQuestionsJson.questions[0],
            {
              question: '贵方希望优先验证哪个业务场景？',
              keyMomentType: 'discovery',
              rationale: ['需要明确现场优先级'],
              knowledgeRequirements: [],
              requiresInternalEvidence: false,
            },
          ],
        });
      },
    },
    materials: {
      async searchWithDiagnostics() {
        retrievalCalls += 1;
        return { hits: [] };
      },
    },
  });

  const result = await service.generate('prep-1');

  assert.equal(llmCalls, 1);
  assert.equal(retrievalCalls, 0);
  assert.equal(result.questions[0].evidenceStatus, null);
  assert.equal(result.questions[0].checkedAt, null);
  assert.deepEqual(result.questions[0].evidence.knowledgeRequirements, ['机器人行业案例']);
  assert.equal(result.questions[0].evidence.checkError, undefined);
  assert.equal(result.questions[1].evidenceStatus, 'not_needed');
  assert.ok(result.questions[1].checkedAt);
  assert.deepEqual(result.questions.map((question) => question.sortOrder), [0, 1]);
});

test('uncited support is normalized to missing evidence', async () => {
  const record = pendingEvidenceRecord();
  const calls = [];
  const queue = [
    { knowledgeRequirements: ['机器人行业案例'], requiresInternalEvidence: true },
    {
      coverage: 'partial',
      supported: ['暂无明确对应机器人行业案例的信息'],
      missing: ['具体机器人行业案例'],
      limitations: [],
      citedChunkIds: [],
      handlingScript: '当前资料未覆盖该问题。',
      followupQuestions: [],
    },
  ].map((value) => JSON.stringify(value));
  const service = makeService({
    db: recheckDb(record),
    llm: {
      async generateContentStructured(prompt, options) {
        calls.push({ prompt, options });
        return queue.shift();
      },
    },
    materials: {
      searchWithDiagnostics: async () => ({
        hits: [{
          sourceType: 'uploaded_material',
          sourceId: 'mat-1',
          chunkId: 18,
          score: 0.8,
          title: '产品概述',
          text: '通用产品介绍',
          parentText: '产品介绍详情',
        }],
      }),
    },
  });

  const result = await service.recheckQuestion('prep-1', 'q1');

  assert.equal(result.questions[0].evidenceStatus, 'missing');
  assert.deepEqual(result.questions[0].evidence.supported, []);
  assert.deepEqual(result.questions[0].evidence.missing, ['具体机器人行业案例']);
  assert.deepEqual(result.questions[0].evidence.citations, []);
  assert.deepEqual(calls[1].options.dataScopes, ['reference_files']);
  const evidencePrompt = calls[1].prompt;
  assert.match(evidencePrompt, /必须只返回一个 JSON 对象/);
  assert.match(evidencePrompt, /supported、missing、limitations、followupQuestions 都是 string\[\]/);
  assert.match(evidencePrompt, /citedChunkIds 是非负整数数组/);
  assert.match(evidencePrompt, /handlingScript 是 string/);
  assert.match(evidencePrompt, /没有内容时使用空数组或空字符串，不得省略字段/);
  assert.match(evidencePrompt, /任何“未知”“暂无”“未提供”“无法确认”或不支持的内容必须放入 missing，不得放入 supported/);
  assert.ok(evidencePrompt.includes('"coverage":"partial"'));
  assert.ok(evidencePrompt.includes('"citedChunkIds":[123]'));
});

test('evidence validation logs only safe issue metadata', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const record = pendingEvidenceRecord();
    const service = makeService({
      db: recheckDb(record),
      llm: queuedJsonLlm([
        { knowledgeRequirements: ['机器人行业案例'], requiresInternalEvidence: true },
        {
          coverage: 'partial',
          supported: 'secretx',
          missing: [],
          limitations: [],
          citedChunkIds: [18],
          handlingScript: '',
          followupQuestions: [],
        },
      ]),
      materials: {
        searchWithDiagnostics: async () => ({
          hits: [{
            sourceType: 'uploaded_material',
            sourceId: 'private-source-id',
            chunkId: 18,
            score: 0.8,
            title: 'private material title',
            text: 'private material text',
            parentText: 'private parent text',
          }],
        }),
      },
    });

    const result = await service.recheckQuestion('prep-1', 'q1');

    assert.equal(result.questions[0].evidenceStatus, null);
    assert.equal(result.questions[0].evidence.checkError, 'check_failed');
    assert.deepEqual(warnings, [[
      '[MeetingPreparation] Evidence check failed',
      { errorType: 'ZodError', issues: [{ path: 'supported', code: 'invalid_type' }] },
    ]]);
    const serializedWarnings = JSON.stringify(warnings);
    assert.ok(!serializedWarnings.includes('secretx'));
    assert.ok(!serializedWarnings.includes('private material'));
    assert.ok(!serializedWarnings.includes('机器人行业案例'));
  } finally {
    console.warn = originalWarn;
  }
});

test('material retrieval failure stays outside business evidence states', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const record = pendingEvidenceRecord();
    const service = makeService({
      db: recheckDb(record),
      llm: queuedJsonLlm([
        { knowledgeRequirements: ['机器人行业案例'], requiresInternalEvidence: true },
      ]),
      materials: {
        searchWithDiagnostics: async () => {
          throw new Error('rag_failed');
        },
      },
    });

    const result = await service.recheckQuestion('prep-1', 'q1');

    assert.equal(result.questions[0].evidenceStatus, null);
    assert.equal(result.questions[0].evidence.checkError, 'check_failed');
    assert.deepEqual(warnings, [[
      '[MeetingPreparation] Evidence check failed',
      { errorType: 'Error' },
    ]]);
    assert.ok(!JSON.stringify(warnings).includes('rag_failed'));
  } finally {
    console.warn = originalWarn;
  }
});

test('recheck persists check_failed when evidence requirement refresh fails', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const record = pendingEvidenceRecord();
    let savedQuestions;
    const service = makeService({
      db: recheckDb(record, (input) => { savedQuestions = input.questions; }),
      llm: {
        async generateContentStructured() {
          throw new Error('provider_timeout');
        },
      },
    });

    const result = await service.recheckQuestion('prep-1', 'q1');

    assert.equal(savedQuestions[0].id, 'q1');
    assert.equal(savedQuestions[0].evidenceStatus, null);
    assert.equal(savedQuestions[0].evidence.checkError, 'check_failed');
    assert.ok(savedQuestions[0].checkedAt);
    assert.equal(result.questions[0].evidence.checkError, 'check_failed');
    assert.deepEqual(warnings, [[
      '[MeetingPreparation] Evidence requirement refresh failed',
      { errorType: 'Error' },
    ]]);
    assert.ok(!JSON.stringify(warnings).includes('provider_timeout'));
    assert.ok(!JSON.stringify(warnings).includes('机器人行业案例'));
  } finally {
    console.warn = originalWarn;
  }
});

test('recheck updates only the latest selected question', async () => {
  const firstQuestion = {
    id: 'q1',
    sortOrder: 0,
    question: '最新编辑后的案例问题？',
    keyMomentType: 'case_request',
    rationale: [],
    evidenceStatus: 'partial',
    evidence: {
      knowledgeRequirements: ['行业案例'],
      supported: [],
      missing: ['行业案例'],
      limitations: [],
      citations: [],
      handlingScript: '',
      followupQuestions: [],
    },
    checkedAt: null,
  };
  const untouched = { ...structuredClone(firstQuestion), id: 'q2', sortOrder: 1, question: '集成周期？' };
  let savedQuestions;
  const record = { ...structuredClone(baseRecord), questions: [firstQuestion, untouched] };
  const service = makeService({
    llm: queuedJsonLlm([{
      knowledgeRequirements: ['行业案例'],
      requiresInternalEvidence: true,
    }]),
    db: {
      getMeetingPreparation: () => structuredClone(record),
      getRecentMeetings: () => [],
      getMeetingDetails: () => null,
      saveMeetingPreparation: (input) => {
        savedQuestions = input.questions;
        return { ...structuredClone(record), ...input };
      },
      saveMeetingPreparationResult: () => structuredClone(record),
    },
    materials: { searchWithDiagnostics: async () => ({ hits: [] }) },
  });

  await service.recheckQuestion('prep-1', 'q1');

  assert.equal(savedQuestions[0].question, '最新编辑后的案例问题？');
  assert.deepEqual(savedQuestions[1], untouched);
});

test('recheck refreshes evidence requirements before running material retrieval', async () => {
  const question = {
    id: 'q1',
    sortOrder: 0,
    question: '产品如何接入客户现有控制系统？',
    keyMomentType: 'integration',
    rationale: [],
    evidenceStatus: 'not_needed',
    evidence: {
      knowledgeRequirements: ['客户当前使用的控制系统'],
      supported: [],
      missing: [],
      limitations: ['该问题主要依赖现场信息'],
      citations: [],
      handlingScript: '',
      followupQuestions: [],
    },
    checkedAt: null,
  };
  const record = { ...structuredClone(baseRecord), questions: [question] };
  const queries = [];
  let savedQuestions;
  const service = makeService({
    llm: queuedJsonLlm([
      {
        knowledgeRequirements: ['产品接口能力', '集成兼容性'],
        requiresInternalEvidence: true,
      },
      {
        coverage: 'partial',
        supported: ['支持标准接口集成'],
        missing: ['客户控制系统的具体兼容性'],
        limitations: [],
        citedChunkIds: [18],
        handlingScript: '可以先介绍已确认的标准接口能力。',
        followupQuestions: ['客户当前使用哪种控制系统？'],
      },
    ]),
    db: {
      getMeetingPreparation: () => structuredClone(record),
      getRecentMeetings: () => [],
      getMeetingDetails: () => null,
      saveMeetingPreparation: (input) => {
        savedQuestions = input.questions;
        return { ...structuredClone(record), ...input };
      },
      saveMeetingPreparationResult: () => structuredClone(record),
    },
    materials: {
      searchWithDiagnostics: async (query) => {
        queries.push(query);
        return {
          hits: [{
            sourceType: 'uploaded_material',
            sourceId: 'mat-1',
            chunkId: 18,
            score: 0.8,
            title: '产品接口说明',
            text: '支持标准接口集成',
            parentText: '产品接口与集成能力',
          }],
        };
      },
    },
  });

  await service.recheckQuestion('prep-1', 'q1');

  assert.equal(queries.length, 1);
  assert.match(queries[0], /产品如何接入客户现有控制系统/);
  assert.match(queries[0], /产品接口能力/);
  assert.doesNotMatch(queries[0], /客户当前使用的控制系统/);
  assert.deepEqual(savedQuestions[0].evidence.knowledgeRequirements, ['产品接口能力', '集成兼容性']);
  assert.equal(savedQuestions[0].evidenceStatus, 'partial');
});

test('recheck skips material retrieval when the edited question only needs onsite information', async () => {
  const question = {
    id: 'q1',
    sortOrder: 0,
    question: '客户当前使用什么控制系统？',
    keyMomentType: 'discovery',
    rationale: [],
    evidenceStatus: 'partial',
    evidence: {
      knowledgeRequirements: ['产品接口能力'],
      supported: ['支持标准接口集成'],
      missing: [],
      limitations: [],
      citations: [{ sourceType: 'uploaded_material', sourceId: 'mat-1', title: '产品接口说明', chunkId: 18 }],
      handlingScript: '',
      followupQuestions: [],
    },
    checkedAt: null,
  };
  const record = { ...structuredClone(baseRecord), questions: [question] };
  let retrievalCalls = 0;
  let savedQuestions;
  const service = makeService({
    llm: queuedJsonLlm([{
      knowledgeRequirements: ['产品接口能力'],
      requiresInternalEvidence: false,
    }]),
    db: {
      getMeetingPreparation: () => structuredClone(record),
      getRecentMeetings: () => [],
      getMeetingDetails: () => null,
      saveMeetingPreparation: (input) => {
        savedQuestions = input.questions;
        return { ...structuredClone(record), ...input };
      },
      saveMeetingPreparationResult: () => structuredClone(record),
    },
    materials: {
      searchWithDiagnostics: async () => {
        retrievalCalls += 1;
        return { hits: [] };
      },
    },
  });

  await service.recheckQuestion('prep-1', 'q1');

  assert.equal(retrievalCalls, 0);
  assert.equal(savedQuestions[0].evidenceStatus, 'not_needed');
  assert.deepEqual(savedQuestions[0].evidence.knowledgeRequirements, []);
});
