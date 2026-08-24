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
      { id: 'sales-mode', name: 'Sales', templateType: 'sales' },
      { id: 'fde-mode', name: 'FDE', templateType: 'fde' },
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

test('rejects a second AI operation for the same preparation', async () => {
  const gate = deferred();
  const service = makeService({ llm: { generateContentStructured: () => gate.promise } });
  const first = service.parseInput('prep-1', '会议');

  await assert.rejects(service.parseInput('prep-1', '会议'), /meeting_preparation_busy/);
  gate.resolve(JSON.stringify(validContext));
  await first;
});

test('generate returns no more than three questions and cites only retrieved chunks', async () => {
  const calls = [];
  const queue = [
    predictedQuestionsJson,
    {
      coverage: 'sufficient',
      supported: ['装配案例'],
      missing: [],
      limitations: [],
      citedChunkIds: [18, 999],
      handlingScript: '可以先分享已核对的装配案例。',
      followupQuestions: ['您更关注哪类装配场景？'],
    },
  ].map((value) => JSON.stringify(value));
  const service = makeService({
    llm: {
      async generateContentStructured(_prompt, options) {
        calls.push(options);
        return queue.shift();
      },
    },
    materials: {
      async searchWithDiagnostics() {
        return {
          hits: [
            {
              sourceType: 'uploaded_material',
              sourceId: 'mat-1',
              chunkId: 18,
              score: 0.8,
              title: '机器人案例',
              text: '装配案例',
              parentText: '装配案例详情',
            },
          ],
        };
      },
    },
  });

  const result = await service.generate('prep-1');

  assert.ok(result.questions.length <= 3);
  assert.deepEqual(result.questions[0].evidence.citations.map(({ chunkId }) => chunkId), [18]);
  assert.equal(result.questions[0].evidence.handlingScript, '可以先分享已核对的装配案例。');
  assert.deepEqual(calls[1].dataScopes, ['reference_files']);
});

test('missing evidence never becomes sufficient', async () => {
  const service = makeService({
    llm: queuedJsonLlm([predictedQuestionsJson]),
    materials: { searchWithDiagnostics: async () => ({ hits: [] }) },
  });

  const result = await service.generate('prep-1');

  assert.equal(result.questions[0].evidenceStatus, 'missing');
  assert.deepEqual(result.questions[0].evidence.citations, []);
});

test('material retrieval failure stays outside business evidence states', async () => {
  const service = makeService({
    llm: queuedJsonLlm([predictedQuestionsJson]),
    materials: {
      searchWithDiagnostics: async () => {
        throw new Error('rag_failed');
      },
    },
  });

  const result = await service.generate('prep-1');

  assert.equal(result.questions[0].evidenceStatus, null);
  assert.equal(result.questions[0].evidence.checkError, 'check_failed');
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
