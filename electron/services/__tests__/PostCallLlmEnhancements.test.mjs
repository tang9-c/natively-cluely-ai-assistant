import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/post-call/PostCallLlmEnhancements.js');
const { generatePostCallLlmEnhancements } = await import(pathToFileURL(modulePath).href);

const emptyDeterministicEnhancements = {
  actionItemsStructured: [],
  acceptedActionItems: [],
  acceptedDecisionRecords: [],
  acceptedBlockerRecords: [],
  acceptedCapabilityFitRecords: [],
  acceptedFdeRecords: [],
  acceptedRecruitingRecords: [],
};

test('generatePostCallLlmEnhancements returns Chinese insights with evidence and follow-up draft', async () => {
  const llmHelper = {
    generateMeetingSummary: async () => JSON.stringify({
      coachingInsights: [
        {
          type: 'fde_validation_gap',
          title: '验证材料需要明确',
          detail: '客户已经提到测试数据，但验收口径还需要补充。',
          severity: 'opportunity',
          evidence: '客户下周提供测试数据',
        },
      ],
      followUpDraft: '您好，我们会根据今天确认的只读接入范围准备验证材料。',
    }),
  };

  const result = await generatePostCallLlmEnhancements({
    llmHelper,
    transcript: [{ speaker: '客户', text: '客户下周提供测试数据', timestamp: 1 }],
    modeTemplateType: 'fde',
    summaryData: {
      overview: '客户确认测试数据安排。',
      keyPoints: [],
      actionItems: ['客户下周提供测试数据'],
      decisions: ['第一阶段只读接入 PLM'],
      openQuestions: [],
    },
    deterministicEnhancements: emptyDeterministicEnhancements,
  });

  assert.equal(result.coachingInsights.length, 1);
  assert.equal(result.coachingInsights[0].title, '验证材料需要明确');
  assert.equal(result.coachingInsights[0].evidence, '客户下周提供测试数据');
  assert.match(result.followUpDraft, /只读接入范围/);
});

test('generatePostCallLlmEnhancements drops insights without evidence', async () => {
  const llmHelper = {
    generateMeetingSummary: async () => JSON.stringify({
      coachingInsights: [
        { type: 'bad', title: '无证据', detail: '不能显示', severity: 'warning' },
      ],
      followUpDraft: '',
    }),
  };

  const result = await generatePostCallLlmEnhancements({
    llmHelper,
    transcript: [],
    modeTemplateType: 'fde',
    summaryData: { overview: '摘要', keyPoints: [], actionItems: [], decisions: [], openQuestions: [] },
    deterministicEnhancements: emptyDeterministicEnhancements,
  });

  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
});

test('generatePostCallLlmEnhancements keeps meeting content out of system prompt', async () => {
  const calls = [];
  const llmHelper = {
    generateMeetingSummary: async (prompt, context) => {
      calls.push({ prompt, context });
      return JSON.stringify({ coachingInsights: [], followUpDraft: '' });
    },
  };

  await generatePostCallLlmEnhancements({
    llmHelper,
    transcript: [{ speaker: '客户', text: '客户敏感原文证据', timestamp: 1 }],
    modeTemplateType: 'fde',
    summaryData: {
      overview: '客户敏感摘要',
      keyPoints: ['客户敏感要点'],
      actionItems: [],
      decisions: [],
      openQuestions: [],
    },
    deterministicEnhancements: { acceptedFdeRecords: [{ summary: '客户敏感确定性记录' }] },
  });

  assert.equal(calls.length, 1);
  assert.ok(!calls[0].prompt.includes('客户敏感原文证据'));
  assert.ok(!calls[0].prompt.includes('客户敏感摘要'));
  assert.ok(!calls[0].prompt.includes('客户敏感确定性记录'));
  assert.ok(calls[0].context.includes('客户敏感原文证据'));
  assert.ok(calls[0].context.includes('客户敏感摘要'));
  assert.ok(calls[0].context.includes('客户敏感确定性记录'));
});

test('generatePostCallLlmEnhancements drops fabricated evidence not present in transcript', async () => {
  const llmHelper = {
    generateMeetingSummary: async () => JSON.stringify({
      coachingInsights: [
        {
          type: 'fde_validation_gap',
          title: '不能显示',
          detail: '证据并不存在。',
          severity: 'warning',
          evidence: '客户已经承诺明天签合同',
        },
      ],
      followUpDraft: '',
    }),
  };

  const result = await generatePostCallLlmEnhancements({
    llmHelper,
    transcript: [{ speaker: '客户', text: '客户只说下周再确认测试数据', timestamp: 1 }],
    modeTemplateType: 'fde',
    summaryData: { overview: '摘要', keyPoints: [], actionItems: [], decisions: [], openQuestions: [] },
    deterministicEnhancements: emptyDeterministicEnhancements,
  });

  assert.deepEqual(result.coachingInsights, []);
});

test('generatePostCallLlmEnhancements returns empty fallback on malformed JSON or provider error', async () => {
  for (const generateMeetingSummary of [
    async () => 'not json',
    async () => { throw new Error('provider unavailable'); },
  ]) {
    const result = await generatePostCallLlmEnhancements({
      llmHelper: { generateMeetingSummary },
      transcript: [],
      modeTemplateType: 'fde',
      summaryData: { overview: '摘要', keyPoints: [], actionItems: [], decisions: [], openQuestions: [] },
      deterministicEnhancements: emptyDeterministicEnhancements,
    });

    assert.deepEqual(result.coachingInsights, []);
    assert.equal(result.followUpDraft, '');
  }
});
