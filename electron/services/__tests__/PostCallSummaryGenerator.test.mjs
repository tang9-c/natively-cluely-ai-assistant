import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/post-call/PostCallSummaryGenerator.js');
const {
  chunkTranscriptForSummary,
  generateFullTranscriptSummary,
} = await import(pathToFileURL(modulePath).href);

test('chunkTranscriptForSummary covers head middle and tail instead of a single leading truncation', () => {
  const head = '头部客户确认 SRM 现状。';
  const middle = '中部讨论 PLM QMS ERP 集成边界。';
  const tail = '尾部决定下周提供测试数据。';
  const context = `${head}\n${'中间填充内容。'.repeat(300)}\n${middle}\n${'更多填充内容。'.repeat(300)}\n${tail}`;

  const chunks = chunkTranscriptForSummary(context, 1000);

  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].includes(head));
  assert.ok(chunks.some((chunk) => chunk.includes(middle)));
  assert.ok(chunks.at(-1).includes(tail));
});

test('generateFullTranscriptSummary summarizes every chunk before final merge', async () => {
  const calls = [];
  const llmHelper = {
    generateMeetingSummary: async (prompt, context) => {
      calls.push({ prompt, context });
      if (prompt.includes('归并')) {
        return JSON.stringify({
          overview: '完整会议覆盖头中尾',
          keyPoints: ['头部 SRM 现状', '中部集成边界', '尾部测试数据'],
          actionItems: ['客户下周提供测试数据'],
          decisions: ['第一阶段先确认集成边界'],
          openQuestions: [],
        });
      }
      return JSON.stringify({
        overview: `局部摘要 ${calls.length}`,
        keyPoints: [`片段 ${calls.length}`],
        actionItems: [],
        decisions: [],
        openQuestions: [],
      });
    },
  };

  const context = [
    '头部 SRM 现状。',
    '中段 '.repeat(900),
    '中部 PLM QMS ERP 集成边界。',
    '尾段 '.repeat(900),
    '尾部 客户下周提供测试数据。',
  ].join('\n');

  const summary = await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context,
    modeTemplateType: 'fde',
    modeNoteSections: [],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.ok(calls.length >= 4, 'expected multiple chunk calls plus one merge call');
  assert.equal(summary.overview, '完整会议覆盖头中尾');
  assert.deepEqual(summary.actionItems, ['客户下周提供测试数据']);
  assert.deepEqual(summary.decisions, ['第一阶段先确认集成边界']);
});

test('generateFullTranscriptSummary preserves mode section order during final merge', async () => {
  const llmHelper = {
    generateMeetingSummary: async (prompt) => {
      if (prompt.includes('归并')) {
        return JSON.stringify({
          overview: 'FDE 会议摘要',
          sections: {
            '客户目标': ['降低手工追溯成本'],
            '集成边界': ['第一阶段只读接入 PLM'],
          },
          actionItems: ['FDE 团队准备验证材料'],
          decisions: ['第一阶段只读接入 PLM'],
          openQuestions: ['写回边界待确认'],
        });
      }
      return JSON.stringify({ overview: '局部', sections: {}, actionItems: [], decisions: [], openQuestions: [] });
    },
  };

  const summary = await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context: '客户目标 '.repeat(500) + '集成边界 '.repeat(500),
    modeTemplateType: 'fde',
    modeNoteSections: [
      { title: '客户目标', description: '客户希望达到的业务结果' },
      { title: '集成边界', description: '系统和读写边界' },
    ],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.deepEqual(summary.sections.map((section) => section.title), ['客户目标', '集成边界']);
  assert.deepEqual(summary.sections[0].bullets, ['降低手工追溯成本']);
  assert.deepEqual(summary.openQuestions, ['写回边界待确认']);
});

test('generateFullTranscriptSummary returns empty compatible structure when all LLM calls fail', async () => {
  const llmHelper = {
    generateMeetingSummary: async () => {
      throw new Error('provider unavailable');
    },
  };

  const summary = await generateFullTranscriptSummary({
    llmHelper,
    transcript: [],
    context: '有效会议内容 '.repeat(50),
    modeTemplateType: 'fde',
    modeNoteSections: [{ title: '客户目标', description: '' }],
    modeContextBlock: '',
    baseRules: '规则：只基于会议内容。',
    groqSummaryPrompt: 'fallback',
    maxChunkChars: 1000,
  });

  assert.deepEqual(summary.actionItems, []);
  assert.deepEqual(summary.keyPoints, []);
  assert.deepEqual(summary.decisions, []);
  assert.deepEqual(summary.openQuestions, []);
  assert.deepEqual(summary.sections, [{ title: '客户目标', bullets: [] }]);
});
